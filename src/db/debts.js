import { db } from "./db.js";
import { upsertCustomer } from "./customers.js";
import { runTransactionWithTimeout } from "./runTransactionWithTimeout.js";
import { createId } from "../lib/ids.js";
import { isValidGhanaCardNumber } from "../lib/ghanaCardNumber.js";
import { formatGhs } from "../lib/money.js";
import { normalizeSaleItems, totalSaleItemsPesewas } from "../lib/saleItems.js";
import { addDueCycles, assertInstallmentAmountWithinBalance, getCreditBalanceAfterSale, isValidDateString, PAYMENT_FREQUENCIES, reconcileInstallmentPayment } from "../utils/installments.js";

export const COLLECTION_UNDO_WINDOW_MS = 10_000;

const DEBT_STATE_FIELDS = [
  "amountPesewas",
  "total_owed",
  "status",
  "dueDate",
  "isInstallmentPlan",
  "installmentAmount",
  "frequency",
  "nextDueDate",
  "installmentsRemaining",
  "totalInstallments",
  "installmentPaymentCarryPesewas"
];

function getDebtState(debt) {
  return Object.fromEntries(DEBT_STATE_FIELDS.map((field) => [field, debt[field]]));
}

function normalizeInitialPaymentParts(parts, totalPesewas, defaultMethod) {
  const paymentParts = parts ?? (totalPesewas > 0
    ? [{ paymentMethod: defaultMethod, amountPesewas: totalPesewas }]
    : []);
  if (!Array.isArray(paymentParts)) {
    throw new TypeError("Initial payment parts must be a list.");
  }
  const amounts = { cash: 0, momo: 0 };
  for (const part of paymentParts) {
    if (!["cash", "momo"].includes(part?.paymentMethod) ||
      !Number.isSafeInteger(part.amountPesewas) ||
      part.amountPesewas <= 0) {
      throw new TypeError("Each initial payment part needs a valid method and positive amount.");
    }
    amounts[part.paymentMethod] += part.amountPesewas;
    if (!Number.isSafeInteger(amounts[part.paymentMethod])) {
      throw new RangeError("The initial payment exceeds the supported amount.");
    }
  }
  const normalizedTotalPesewas = amounts.cash + amounts.momo;
  if (!Number.isSafeInteger(normalizedTotalPesewas) || normalizedTotalPesewas !== totalPesewas) {
    throw new TypeError("Initial payment parts must add up to the initial payment amount.");
  }
  return ["cash", "momo"]
    .filter((method) => amounts[method] > 0)
    .map((paymentMethod) => ({ paymentMethod, amountPesewas: amounts[paymentMethod] }));
}

async function getUnpaidCustomerBalance(name) {
  const normalizedName = name.trim().toLowerCase();
  const debts = await db.debts
    .where("status")
    .equals("unpaid")
    .and((debt) => (debt.customer_name ?? debt.customerName ?? "").trim().toLowerCase() === normalizedName)
    .toArray();
  return debts.reduce((total, debt) => {
    const amount = debt.amountPesewas ?? debt.total_owed;
    if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(total + amount)) {
      throw new RangeError("The customer's current debt has an invalid or unsupported amount.");
    }
    return total + amount;
  }, 0);
}

export async function refreshCustomerDebtBalance(customer, name, now = Date.now()) {
  if (!customer?.id) return customer;
  const totalDebtPesewas = await getUnpaidCustomerBalance(name);
  await db.customers.update(customer.id, { totalDebtPesewas, updatedAt: now });
  return { ...customer, totalDebtPesewas, updatedAt: now };
}

function isSameDebtState(left, right) {
  return DEBT_STATE_FIELDS.every((field) => left[field] === right[field]);
}

export function normalizeCollectionParts(parts) {
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new TypeError("Add at least one payment part.");
  }
  let totalPesewas = 0;
  const normalizedParts = parts.map((part) => {
    if (!["cash", "momo"].includes(part?.paymentMethod) ||
      !Number.isSafeInteger(part.amountPesewas) ||
      part.amountPesewas <= 0) {
      throw new TypeError("Each collection part needs a valid payment method and positive amount.");
    }
    totalPesewas += part.amountPesewas;
    if (!Number.isSafeInteger(totalPesewas)) {
      throw new RangeError("The collection total exceeds the supported amount.");
    }
    return { paymentMethod: part.paymentMethod, amountPesewas: part.amountPesewas };
  });
  return { normalizedParts, totalPesewas };
}

export async function addDebtToCustomer({
  name,
  phone = "",
  ghanaCardNumber = "",
  customerId,
  amountPesewas,
  note = "",
  installmentPlan = null,
  dueDate = "",
  transactionId,
  now = Date.now()
}) {
  const customerName = name.trim();
  const normalizedName = customerName.toLowerCase();
  const cleanGhanaCardNumber = ghanaCardNumber.trim().toUpperCase();
  if (!normalizedName) throw new TypeError("A customer name is required to record debt.");
  if (!Number.isSafeInteger(amountPesewas) || amountPesewas < 0) {
    throw new TypeError("Debt amount must be a non-negative integer number of pesewas.");
  }

  const existingDebts = await db.debts
    .where("status")
    .equals("unpaid")
    .and((debt) => (debt.customer_name ?? debt.customerName ?? "").trim().toLowerCase() === normalizedName)
    .toArray();

  const existingDebt = existingDebts[0];
  if (existingDebt) {
    const existingAmount = existingDebt.amountPesewas ?? existingDebt.total_owed ?? 0;
    if (!Number.isSafeInteger(existingAmount) || existingAmount < 0) {
      throw new RangeError("The customer's current debt has an invalid amount.");
    }
    const combinedAmount = existingAmount + amountPesewas;
    if (!Number.isSafeInteger(combinedAmount)) {
      throw new RangeError("The combined customer debt exceeds the supported amount.");
    }
    if (installmentPlan?.installmentAmount > 0) {
      if (!Number.isSafeInteger(installmentPlan.installmentAmount) ||
        !PAYMENT_FREQUENCIES.some(({ value }) => value === installmentPlan.frequency) ||
        installmentPlan.installmentAmount > combinedAmount ||
        (installmentPlan.nextDueDate && !isValidDateString(installmentPlan.nextDueDate))) {
        throw new TypeError("The installment plan does not fit the remaining customer debt.");
      }
    }

    const combinedNote = [
      existingDebt.note?.trim(),
      amountPesewas > 0 ? note.trim() : ""
    ].filter(Boolean).join(", ");
    let updatedInstallmentData = {};
    if (installmentPlan?.installmentAmount > 0 && installmentPlan.frequency) {
      const installmentsRemaining = Math.ceil(combinedAmount / installmentPlan.installmentAmount);
      const existingRemaining = existingDebt.installmentsRemaining ??
        (existingDebt.installmentAmount > 0 ? Math.ceil(existingAmount / existingDebt.installmentAmount) : 0);
      const paidInstallments = Math.max(
        0,
        (existingDebt.totalInstallments ?? existingRemaining) - existingRemaining
      );
      updatedInstallmentData = {
        isInstallmentPlan: combinedAmount > 0,
        installmentAmount: installmentPlan.installmentAmount,
        frequency: installmentPlan.frequency,
        installmentPaymentCarryPesewas: 0,
        nextDueDate: combinedAmount > 0
          ? installmentPlan.nextDueDate || existingDebt.nextDueDate || ""
          : "",
        installmentsRemaining: combinedAmount > 0 ? installmentsRemaining : 0,
        totalInstallments: combinedAmount > 0 ? installmentsRemaining + paidInstallments : paidInstallments
      };
    } else if (existingDebt.isInstallmentPlan && existingDebt.installmentAmount > 0) {
      const previousRemaining = existingDebt.installmentsRemaining ?? Math.ceil(existingAmount / existingDebt.installmentAmount);
      const nextRemaining = Math.ceil(combinedAmount / existingDebt.installmentAmount);
      updatedInstallmentData = {
        installmentsRemaining: nextRemaining,
        totalInstallments: (existingDebt.totalInstallments ?? previousRemaining) + nextRemaining - previousRemaining
      };
    }
    const updatedDebt = {
      customerName: existingDebt.customerName ?? existingDebt.customer_name ?? customerName,
      customer_name: existingDebt.customer_name ?? existingDebt.customerName ?? customerName,
      ...(customerId && { customerId }),
      phone: phone.trim() || existingDebt.phone || existingDebt.customer_phone || "",
      customer_phone: phone.trim() || existingDebt.customer_phone || existingDebt.phone || "",
      ghanaCardNumber: cleanGhanaCardNumber || existingDebt.ghanaCardNumber || "",
      amountPesewas: combinedAmount,
      total_owed: combinedAmount,
      ...(!existingDebt.isInstallmentPlan && !installmentPlan && dueDate ? { dueDate } : {}),
      ...updatedInstallmentData,
      note: combinedNote,
      updatedAt: now,
      synced: false,
      syncStatus: "pending"
    };
    await db.debts.update(existingDebt.id, updatedDebt);
    const customer = customerId
      ? await db.customers.get(customerId)
      : await db.customers.where("nameLower").equals(normalizedName).first();
    await refreshCustomerDebtBalance(customer, customerName, now);
    return { ...existingDebt, ...updatedDebt, isAddon: true };
  }

  if (amountPesewas === 0) return null;
  if (installmentPlan?.isInstallmentPlan &&
    (!Number.isSafeInteger(installmentPlan.installmentAmount) ||
      installmentPlan.installmentAmount <= 0 ||
      installmentPlan.installmentAmount > amountPesewas ||
      !PAYMENT_FREQUENCIES.some(({ value }) => value === installmentPlan.frequency) ||
      !isValidDateString(installmentPlan.nextDueDate))) {
    throw new TypeError("The installment plan does not fit the remaining customer debt.");
  }

  const newDebt = {
    id: createId(),
    ...(transactionId && { transactionId }),
    ...(customerId && { customerId }),
    customerName,
    customer_name: customerName,
    phone: phone.trim(),
    customer_phone: phone.trim(),
    ghanaCardNumber: cleanGhanaCardNumber,
    ...(installmentPlan ?? {
      isInstallmentPlan: false,
      installmentAmount: 0,
      frequency: "",
      nextDueDate: "",
      installmentsRemaining: 0,
      totalInstallments: 0,
      installmentPaymentCarryPesewas: 0
    }),
    dueDate: installmentPlan ? "" : dueDate,
    amountPesewas,
    total_owed: amountPesewas,
    note: note.trim(),
    status: "unpaid",
    createdAt: now,
    created_at: now,
    last_reminder_date: null,
    updatedAt: now,
    synced: false,
    syncStatus: "pending"
  };
  await db.debts.add(newDebt);
  const customer = customerId
    ? await db.customers.get(customerId)
    : await db.customers.where("nameLower").equals(normalizedName).first();
  await refreshCustomerDebtBalance(customer, customerName, now);
  return { ...newDebt, isAddon: false };
}

export async function recordCreditSale({
  amountPesewas,
  name,
  phone = "",
  ghanaCardNumber = "",
  dueDate = "",
  installmentPlan = null,
  initialPaymentPesewas = 0,
  initialPaymentParts = null,
  paymentMethod = "cash",
  note = "Sale",
  itemDescription = note,
  quantity = 1,
  transactionNote = "",
  saleItems = [],
  now = Date.now()
}) {
  const cleanName = name.trim();
  const cleanPhone = phone.trim();
  const cleanNote = note.trim() || "Sale";
  const cleanItemDescription = itemDescription.trim() || cleanNote;
  const cleanTransactionNote = transactionNote.trim() || `${cleanNote} · ${cleanName}`;
  const cleanGhanaCardNumber = ghanaCardNumber.trim().toUpperCase();
  const cleanSaleItems = normalizeSaleItems(saleItems);
  if (!cleanName) throw new TypeError("A customer name is required to record a credit sale.");
  if (!Number.isSafeInteger(amountPesewas) || amountPesewas <= 0) {
    throw new TypeError("Sale amount must be a positive integer number of pesewas.");
  }
  if (cleanSaleItems.length && totalSaleItemsPesewas(cleanSaleItems) !== amountPesewas) {
    throw new TypeError("Item totals must match the sale amount.");
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new TypeError("Sale quantity must be greater than zero.");
  }
  if (!Number.isSafeInteger(initialPaymentPesewas) || initialPaymentPesewas < 0) {
    throw new TypeError("Initial payment must be a non-negative whole-pesewa amount.");
  }
  if (installmentPlan?.isInstallmentPlan && (
    !Number.isSafeInteger(installmentPlan.installmentAmount) ||
    installmentPlan.installmentAmount <= 0 ||
    !PAYMENT_FREQUENCIES.some(({ value }) => value === installmentPlan.frequency) ||
    !isValidDateString(installmentPlan.nextDueDate) ||
    !Number.isSafeInteger(installmentPlan.installmentsRemaining) ||
    installmentPlan.installmentsRemaining <= 0
  )) {
    throw new TypeError("The installment plan has invalid schedule details.");
  }
  if (!["cash", "momo"].includes(paymentMethod)) {
    throw new TypeError("Choose cash or MoMo for the initial payment.");
  }
  if (!isValidGhanaCardNumber(cleanGhanaCardNumber)) {
    throw new TypeError("Enter a valid Ghana Card number.");
  }
  if (dueDate && !isValidDateString(dueDate)) {
    throw new TypeError("Choose a valid credit due date.");
  }
  const transactionId = createId();

  return runTransactionWithTimeout(db, [db.debts, db.customers, db.transactions, db.payments], async () => {
    const previousDebtPesewas = await getUnpaidCustomerBalance(cleanName);
    const existingDebtsBeforeSale = await db.debts
      .where("status")
      .equals("unpaid")
      .and((debt) => (debt.customer_name ?? debt.customerName ?? "").trim().toLowerCase() === cleanName.toLowerCase())
      .toArray();
    const existingDebtBeforeSale = existingDebtsBeforeSale[0] ?? null;
    const maximumCreditPesewas = getCreditBalanceAfterSale(previousDebtPesewas, amountPesewas);
    if (initialPaymentPesewas > maximumCreditPesewas) {
      throw new TypeError("Initial payment cannot exceed the customer's total credit balance.");
    }
    const normalizedPaymentParts = normalizeInitialPaymentParts(
      initialPaymentParts,
      initialPaymentPesewas,
      paymentMethod
    );
    const remainingCreditPesewas = maximumCreditPesewas - initialPaymentPesewas;
    if (installmentPlan && !installmentPlan.isInstallmentPlan && remainingCreditPesewas > 0) {
      throw new TypeError("An installment sale needs a valid installment plan.");
    }
    if (installmentPlan?.isInstallmentPlan) {
      if (!Number.isSafeInteger(installmentPlan.installmentAmount) ||
        installmentPlan.installmentAmount <= 0 ||
        !PAYMENT_FREQUENCIES.some(({ value }) => value === installmentPlan.frequency) ||
        !isValidDateString(installmentPlan.nextDueDate) ||
        !Number.isSafeInteger(installmentPlan.installmentsRemaining) ||
        installmentPlan.installmentsRemaining <= 0) {
        throw new TypeError("The installment plan has invalid schedule details.");
      }
      assertInstallmentAmountWithinBalance(installmentPlan.installmentAmount, remainingCreditPesewas);
      if (installmentPlan.installmentsRemaining !== Math.ceil(
        remainingCreditPesewas / installmentPlan.installmentAmount
      )) {
        throw new TypeError("The installment schedule does not match the remaining credit balance.");
      }
    }
    const customer = await upsertCustomer({
      name: cleanName,
      phone: cleanPhone,
      ghanaCardNumber: cleanGhanaCardNumber,
      debtDeltaPesewas: 0,
      now
    });
    const debtResult = await addDebtToCustomer({
      name: cleanName,
      phone: cleanPhone,
      ghanaCardNumber: cleanGhanaCardNumber,
      customerId: customer?.id,
      amountPesewas,
      note: cleanNote,
      dueDate,
      transactionId,
      now
    });
    const salePaymentPesewas = Math.min(initialPaymentPesewas, amountPesewas);
    let remainingPaymentPesewas = initialPaymentPesewas;
    let remainingSalePaymentPesewas = salePaymentPesewas;
    const remainingPaymentParts = normalizedPaymentParts.map((part) => ({ ...part }));
    const salePaymentByMethod = { cash: 0, momo: 0 };
    const excessPaymentParts = [];
    let paymentAppliedToExistingDebtPesewas = 0;
    const unpaidDebts = await db.debts
      .where("status")
      .equals("unpaid")
      .and((debt) => (debt.customer_name ?? debt.customerName ?? "").trim().toLowerCase() === cleanName.toLowerCase())
      .toArray();
    unpaidDebts.sort((left, right) =>
      Number(right.id === debtResult.id) - Number(left.id === debtResult.id) ||
      (left.createdAt ?? 0) - (right.createdAt ?? 0)
    );
    for (const debt of unpaidDebts) {
      const currentAmount = debt.amountPesewas ?? debt.total_owed;
      if (!Number.isSafeInteger(currentAmount) || currentAmount < 0) {
        throw new RangeError("The customer's current debt has an invalid amount.");
      }
      const paidPesewas = Math.min(currentAmount, remainingPaymentPesewas);
      const remainingAmountPesewas = currentAmount - paidPesewas;
      let paymentToAllocatePesewas = paidPesewas;
      const saleAllocations = [];
      for (const part of remainingPaymentParts) {
        if (paymentToAllocatePesewas === 0) break;
        const allocatedPesewas = Math.min(part.amountPesewas, paymentToAllocatePesewas);
        const salePartPesewas = Math.min(allocatedPesewas, remainingSalePaymentPesewas);
        const excessPartPesewas = allocatedPesewas - salePartPesewas;
        part.amountPesewas -= allocatedPesewas;
        paymentToAllocatePesewas -= allocatedPesewas;
        remainingPaymentPesewas -= allocatedPesewas;
        remainingSalePaymentPesewas -= salePartPesewas;
        salePaymentByMethod[part.paymentMethod] += salePartPesewas;
        if (salePartPesewas > 0) {
          saleAllocations.push({ paymentMethod: part.paymentMethod, amountPesewas: salePartPesewas });
        }
        if (excessPartPesewas > 0) {
          if (debt.id === debtResult.id) {
            paymentAppliedToExistingDebtPesewas += excessPartPesewas;
          }
          excessPaymentParts.push({
            debtId: debt.id,
            paymentMethod: part.paymentMethod,
            amountPesewas: excessPartPesewas
          });
        }
      }

      if (paidPesewas === 0 && !(debt.id === debtResult.id && installmentPlan)) continue;

      let installmentUpdates = {};
      if (debt.id === debtResult.id && installmentPlan) {
        if (installmentPlan.isInstallmentPlan && remainingCreditPesewas > 0) {
          const previousInstallmentsRemaining = existingDebtBeforeSale?.isInstallmentPlan
            ? existingDebtBeforeSale.installmentsRemaining ??
              Math.ceil((existingDebtBeforeSale.amountPesewas ?? existingDebtBeforeSale.total_owed) / existingDebtBeforeSale.installmentAmount)
            : 0;
          const previousPaidInstallments = existingDebtBeforeSale?.isInstallmentPlan
            ? Math.max(0, (existingDebtBeforeSale.totalInstallments ?? previousInstallmentsRemaining) - previousInstallmentsRemaining)
            : 0;
          const previousPaymentCarryPesewas = existingDebtBeforeSale?.isInstallmentPlan
            ? existingDebtBeforeSale.installmentPaymentCarryPesewas ?? 0
            : 0;
          if (!Number.isSafeInteger(previousPaymentCarryPesewas) || previousPaymentCarryPesewas < 0) {
            throw new TypeError("The existing installment plan has an invalid partial payment balance.");
          }
          const accumulatedPaymentProgressPesewas = previousPaymentCarryPesewas + paymentAppliedToExistingDebtPesewas;
          if (!Number.isSafeInteger(accumulatedPaymentProgressPesewas)) {
            throw new RangeError("The installment payment progress exceeds the supported amount.");
          }
          const completedExistingCycles = Math.floor(
            accumulatedPaymentProgressPesewas / installmentPlan.installmentAmount
          );
          const existingPaymentCarryPesewas =
            accumulatedPaymentProgressPesewas % installmentPlan.installmentAmount;
          installmentUpdates = {
            isInstallmentPlan: true,
            installmentAmount: installmentPlan.installmentAmount,
            frequency: installmentPlan.frequency,
            nextDueDate: addDueCycles(
              installmentPlan.nextDueDate,
              installmentPlan.frequency,
              completedExistingCycles
            ),
            installmentsRemaining: installmentPlan.installmentsRemaining,
            totalInstallments: installmentPlan.totalInstallments + previousPaidInstallments + completedExistingCycles,
            installmentPaymentCarryPesewas: existingPaymentCarryPesewas
          };
        } else {
          installmentUpdates = {
            isInstallmentPlan: false,
            installmentsRemaining: 0,
            nextDueDate: "",
            installmentPaymentCarryPesewas: 0
          };
        }
      } else if (paidPesewas > 0 && debt.isInstallmentPlan) {
        installmentUpdates = reconcileInstallmentPayment(debt, paidPesewas, remainingAmountPesewas);
      }
      await db.debts.update(debt.id, {
        amountPesewas: remainingAmountPesewas,
        total_owed: remainingAmountPesewas,
        ...(remainingAmountPesewas === 0 ? { status: "paid", dueDate: "" } : {}),
        ...installmentUpdates,
        updatedAt: now,
        synced: false,
        syncStatus: "pending"
      });

      for (const part of saleAllocations) {
        await db.payments.add({
          id: createId(),
          ...(customer?.id && { customerId: customer.id }),
          debtId: debt.id,
          amountPesewas: part.amountPesewas,
          paymentMethod: part.paymentMethod,
          customer_name: cleanName,
          createdAt: now,
          updatedAt: now,
          transactionId
        });
      }
    }
    if (remainingPaymentPesewas > 0 || remainingSalePaymentPesewas > 0) {
      throw new Error("The customer's debt changed before the installment payment could be recorded.");
    }

    const excessPaymentCollectionId = excessPaymentParts.length > 0 ? createId() : "";
    for (const method of ["cash", "momo"]) {
      const methodParts = excessPaymentParts.filter((part) => part.paymentMethod === method);
      const methodTotalPesewas = methodParts.reduce((sum, part) => sum + part.amountPesewas, 0);
      if (methodTotalPesewas === 0) continue;
      const excessPaymentTransactionId = createId();
      const firstDebt = unpaidDebts.find((debt) => debt.id === methodParts[0].debtId);
      await db.transactions.add({
        id: excessPaymentTransactionId,
        ...(customer?.id && { customerId: customer.id }),
        ...(firstDebt?.id && { debtId: firstDebt.id }),
        collectionId: excessPaymentCollectionId,
        collectionType: "debt_collection",
        type: "income",
        amountPesewas: methodTotalPesewas,
        total_amount: methodTotalPesewas,
        payment_method: method,
        customer_name: cleanName,
        customer_phone: cleanPhone,
        items_json: "[]",
        note: `Debt payment from ${cleanName}`,
        createdAt: now,
        timestamp: now,
        updatedAt: now,
        synced: false,
        syncStatus: "pending"
      });
      for (const part of methodParts) {
        await db.payments.add({
          id: createId(),
          ...(customer?.id && { customerId: customer.id }),
          debtId: part.debtId,
          amountPesewas: part.amountPesewas,
          paymentMethod: method,
          customer_name: cleanName,
          collectionId: excessPaymentCollectionId,
          collectionType: "debt_collection",
          createdAt: now,
          updatedAt: now,
          transactionId: excessPaymentTransactionId
        });
      }
    }

    const salePaymentMethod = salePaymentByMethod.cash > 0 && salePaymentByMethod.momo > 0
      ? null
      : salePaymentByMethod.momo > 0 ? "momo" : salePaymentByMethod.cash > 0 ? "cash" : null;
    const transaction = {
      id: transactionId,
      ...(customer?.id && { customerId: customer.id }),
      ...(salePaymentPesewas < amountPesewas && debtResult?.id && { debtId: debtResult.id }),
      type: salePaymentPesewas < amountPesewas && debtResult?.isAddon
        ? "installment_addon"
        : salePaymentPesewas > 0 ? "installment_sale" : "sale",
      amountPesewas,
      total_amount: amountPesewas,
      payment_method: salePaymentMethod,
      cashReceivedPesewas: salePaymentByMethod.cash,
      momoReceivedPesewas: salePaymentByMethod.momo,
      ...(salePaymentPesewas > 0 && { installmentPaymentPesewas: salePaymentPesewas }),
      paymentType: "credit",
      customer_name: cleanName,
      customer_phone: cleanPhone,
      ghanaCardNumber: cleanGhanaCardNumber,
      customerName: cleanName,
      phone: cleanPhone,
      items_json: JSON.stringify(cleanSaleItems.length
        ? cleanSaleItems
        : [{ name: cleanItemDescription, quantity, total_amount: amountPesewas }]),
      itemDescription: cleanItemDescription,
      quantity,
      pricePesewas: amountPesewas,
      note: cleanTransactionNote,
      ...(dueDate && !installmentPlan && { dueDate }),
      ...(salePaymentPesewas < amountPesewas && debtResult?.isAddon && { addonAmountPesewas: amountPesewas }),
      creditExtendedPesewas: amountPesewas - salePaymentPesewas,
      createdAt: now,
      timestamp: now,
      updatedAt: now,
      synced: false,
      syncStatus: "pending"
    };
    await db.transactions.add(transaction);
    const updatedCustomer = await refreshCustomerDebtBalance(customer, cleanName, now);

    return {
      customerId: updatedCustomer?.id ?? "",
      customerName: updatedCustomer?.name ?? cleanName,
      phone: updatedCustomer?.phone ?? cleanPhone,
      debtId: debtResult?.id ?? "",
      amountPesewas,
      initialPaymentPesewas,
      addedDebtPesewas: amountPesewas,
      previousDebtPesewas,
      totalDebtPesewas: updatedCustomer?.totalDebtPesewas ?? remainingCreditPesewas,
      dueDate: installmentPlan?.nextDueDate || dueDate,
      installmentPlan,
      initialPaymentParts: normalizedPaymentParts,
      transactionId
    };
  });
}

export async function recordDebtCollection({ debtId, parts, now = Date.now() }) {
  if (!debtId) throw new TypeError("A debt is required to record a collection.");
  const { normalizedParts, totalPesewas } = normalizeCollectionParts(parts);
  const collectionId = createId();

  return runTransactionWithTimeout(db, [db.debts, db.payments, db.transactions, db.customers], async () => {
    const currentDebt = await db.debts.get(debtId);
    const currentAmount = currentDebt?.amountPesewas ?? currentDebt?.total_owed;
    if (!currentDebt || currentDebt.status !== "unpaid" ||
      !Number.isSafeInteger(currentAmount) || currentAmount < 0 || totalPesewas > currentAmount) {
      throw new Error("The debt changed before the payment could be recorded.");
    }

    const remainingPesewas = currentAmount - totalPesewas;
    const installmentUpdates = reconcileInstallmentPayment(
      { ...currentDebt, amountPesewas: currentAmount },
      totalPesewas,
      remainingPesewas
    );
    const customerName = currentDebt.customerName ?? currentDebt.customer_name ?? "";
    const linkedCustomer = currentDebt.customerId
      ? await db.customers.get(currentDebt.customerId)
      : null;
    const namedCustomer = linkedCustomer ??
      await db.customers.where("nameLower").equals(customerName.trim().toLowerCase()).first();
    const phone = currentDebt.phone || currentDebt.customer_phone || namedCustomer?.phone || "";
    const customer = namedCustomer ?? await upsertCustomer({ name: customerName, phone, now });
    const customerId = currentDebt.customerId ?? customer?.id;
    const debtBefore = getDebtState(currentDebt);
    const debtAfter = {
      ...debtBefore,
      amountPesewas: remainingPesewas,
      total_owed: remainingPesewas,
      ...(remainingPesewas === 0 ? { dueDate: "" } : {}),
      ...(remainingPesewas === 0 ? { status: "paid" } : {}),
      ...installmentUpdates
    };

    await db.debts.update(debtId, {
      ...debtAfter,
      ...(customerId && { customerId }),
      updatedAt: now,
      synced: false,
      syncStatus: "pending"
    });

    const transactionIds = [];
    for (const part of normalizedParts) {
      const paymentId = createId();
      const transactionId = createId();
      transactionIds.push(transactionId);
      await db.payments.add({
        id: paymentId,
        ...(customerId && { customerId }),
        debtId,
        amountPesewas: part.amountPesewas,
        paymentMethod: part.paymentMethod,
        customer_name: customerName,
        collectionId,
        collectionType: "debt_collection",
        createdAt: now,
        updatedAt: now,
        transactionId
      });
      await db.transactions.add({
        id: transactionId,
        ...(customerId && { customerId }),
        paymentId,
        debtId,
        collectionId,
        collectionType: "debt_collection",
        debtBefore,
        debtAfter,
        type: "income",
        amountPesewas: part.amountPesewas,
        total_amount: part.amountPesewas,
        payment_method: part.paymentMethod,
        customer_name: customerName,
        customer_phone: phone,
        items_json: "[]",
        note: `Debt payment from ${customerName}${remainingPesewas ? ` · ${formatGhs(remainingPesewas)} remaining` : ""}`,
        createdAt: now,
        timestamp: now,
        updatedAt: now,
        synced: false,
        syncStatus: "pending"
      });
    }
    const updatedCustomer = await refreshCustomerDebtBalance(customer, customerName, now);
    return {
      collectionId,
      debtId,
      amountPesewas: totalPesewas,
      parts: normalizedParts,
      remainingPesewas,
      customerName,
      customerId: updatedCustomer?.id ?? customerId,
      phone,
      ghanaCardNumber: customer?.ghanaCardNumber ?? currentDebt.ghanaCardNumber ?? "",
      debtBefore,
      debtAfter,
      createdAt: now,
      undoExpiresAt: now + COLLECTION_UNDO_WINDOW_MS,
      transactionIds
    };
  });
}

export async function recordDebtPayment({ debtId, amountPesewas, paymentMethod, now = Date.now() }) {
  const result = await recordDebtCollection({
    debtId,
    parts: [{ paymentMethod, amountPesewas }],
    now
  });
  return { remainingPesewas: result.remainingPesewas };
}

export async function undoDebtCollection({ collectionId, now = Date.now() }) {
  if (!collectionId) throw new TypeError("A collection is required to undo a payment.");

  return runTransactionWithTimeout(db, [db.debts, db.payments, db.transactions, db.customers], async () => {
    const transactions = await db.transactions.toCollection().filter((transaction) => (
      transaction.collectionId === collectionId && transaction.collectionType === "debt_collection"
    )).toArray();
    if (transactions.length === 0) throw new Error("The collection could not be found.");
    if (transactions.some((transaction) => (
      now < transaction.createdAt || now - transaction.createdAt > COLLECTION_UNDO_WINDOW_MS
    ))) {
      throw new Error("The collection can no longer be undone.");
    }
    const existingReversal = await db.transactions.toCollection().filter((transaction) => (
      transaction.reversalOfCollectionId === collectionId
    )).first();
    if (existingReversal) throw new Error("This collection has already been undone.");

    const firstTransaction = transactions[0];
    const { debtId, debtBefore, debtAfter, customer_name: customerName, customer_phone: phone } = firstTransaction;
    if (!debtId || !debtBefore || !debtAfter || transactions.some((transaction) => (
      transaction.debtId !== debtId ||
      transaction.createdAt !== firstTransaction.createdAt ||
      !isSameDebtState(transaction.debtBefore ?? {}, debtBefore) ||
      !isSameDebtState(transaction.debtAfter ?? {}, debtAfter)
    ))) {
      throw new Error("The collection history is incomplete and cannot be undone safely.");
    }

    const totalPesewas = transactions.reduce((sum, transaction) => {
      const amount = transaction.amountPesewas ?? transaction.total_amount;
      if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(sum + amount)) {
        throw new RangeError("The collection history has an invalid payment amount.");
      }
      return sum + amount;
    }, 0);
    const currentDebt = await db.debts.get(debtId);
    if (!currentDebt || !isSameDebtState(getDebtState(currentDebt), debtAfter)) {
      throw new Error("The debt changed after this payment; it cannot be undone safely.");
    }

    const linkedCustomer = currentDebt.customerId
      ? await db.customers.get(currentDebt.customerId)
      : null;
    const customer = linkedCustomer ??
      await db.customers.where("nameLower").equals(customerName.trim().toLowerCase()).first() ??
      await upsertCustomer({ name: customerName, phone, now });
    const customerId = currentDebt.customerId ?? customer?.id;
    await db.debts.update(debtId, {
      ...debtBefore,
      ...(customerId && { customerId }),
      updatedAt: now,
      synced: false,
      syncStatus: "pending"
    });

    for (const transaction of transactions) {
      const amountPesewas = transaction.amountPesewas ?? transaction.total_amount;
      await db.transactions.add({
        id: createId(),
        ...(customerId && { customerId }),
        debtId,
        collectionId: createId(),
        collectionType: "debt_collection_reversal",
        reversalOfCollectionId: collectionId,
        reversalOfTransactionId: transaction.id,
        type: "income_reversal",
        amountPesewas,
        total_amount: amountPesewas,
        payment_method: transaction.payment_method,
        customer_name: customerName,
        customer_phone: phone,
        items_json: "[]",
        note: `Reversal of debt payment from ${customerName}`,
        createdAt: now,
        timestamp: now,
        updatedAt: now,
        synced: false,
        syncStatus: "pending"
      });
    }
    const updatedCustomer = await refreshCustomerDebtBalance(customer, customerName, now);
    return {
      collectionId,
      debtId,
      amountPesewas: totalPesewas,
      remainingPesewas: debtBefore.amountPesewas ?? debtBefore.total_owed,
      customerName,
      customerId: updatedCustomer?.id ?? customerId
    };
  });
}
