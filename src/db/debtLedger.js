import { db } from "./db.js";
import { upsertCustomer } from "./customers.js";
import { runTransactionWithTimeout } from "./runTransactionWithTimeout.js";
import { createId } from "../lib/ids.js";
import { isValidGhanaCardNumber, normalizeGhanaCardNumber } from "../lib/ghanaCardNumber.js";
import { normalizeWhatsAppPhone } from "../utils/whatsapp.js";
import {
  isValidDateString,
  isValidInstallmentPlanForBalance,
  reconcileInstallmentBalanceCorrection,
  reconcileInstallmentPlanChange
} from "../utils/installments.js";
import {
  calculateLedgerEventBalance,
  getCustomerLedgerRecords,
  getCreditEventAmount
} from "../utils/debtLedgerMath.js";

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

export const DEBT_ADJUSTMENT_REASON_CODES = [
  "wrong_amount",
  "customer_dispute",
  "returned_goods",
  "debt_forgiven",
  "other"
];

function getCustomerName(record) {
  return (record?.customerName ?? record?.customer_name ?? "").trim();
}

function getDebtBalance(debt) {
  return debt?.amountPesewas ?? debt?.total_owed;
}

function assertPesewasAmount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer number of pesewas.`);
  }
}

function assertCorrectionReason(reasonCode, reasonNote) {
  if (!DEBT_ADJUSTMENT_REASON_CODES.includes(reasonCode)) {
    throw new TypeError("Choose a valid reason for the debt correction.");
  }
  if (reasonCode === "other" && !reasonNote?.trim()) {
    throw new TypeError("Add a note when the correction reason is Other.");
  }
}

async function assertDebtBalanceMatchesEvents({
  customerId,
  customerName,
  expectedBalancePesewas,
  database = db
}) {
  const [debts, transactions, payments] = await Promise.all([
    database.debts.toArray(),
    database.transactions.toArray(),
    database.payments.toArray()
  ]);
  const ledgerRecords = getCustomerLedgerRecords({
    customerId,
    customerName,
    debts,
    transactions,
    payments
  });
  const creditEvents = ledgerRecords.transactions.filter((record) => getCreditEventAmount(record) > 0);

  // Legacy debts may have no source credit event. They remain valid until
  // migrated, but there is no event-based baseline to reconcile yet.
  if (!creditEvents.length && !ledgerRecords.payments.length) return;

  const eventBalancePesewas = calculateLedgerEventBalance(
    ledgerRecords.transactions,
    ledgerRecords.payments
  );

  if (!Number.isSafeInteger(eventBalancePesewas) || eventBalancePesewas !== expectedBalancePesewas) {
    throw new Error("The debt events do not reconcile with the corrected balance.");
  }
}

async function findCustomer({ customerId, name }, database = db) {
  if (customerId) {
    const linkedCustomer = await database.customers.get(customerId);
    if (linkedCustomer) return linkedCustomer;
  }
  const normalizedName = (name ?? "").trim().toLowerCase();
  if (!normalizedName) return null;
  return database.customers.where("nameLower").equals(normalizedName).first();
}

export async function resolveCustomer({
  customerId,
  name,
  phone = "",
  ghanaCardNumber = "",
  now = Date.now()
}, database = db) {
  const cleanName = name.trim();
  if (!cleanName) throw new TypeError("A customer name is required.");

  const existingCustomer = await findCustomer({ customerId, name: cleanName }, database);
  if (existingCustomer) return existingCustomer;

  return upsertCustomer({
    name: cleanName,
    phone,
    ghanaCardNumber,
    now
  });
}

export async function recalculateCustomerDebtBalance({
  customerId,
  name,
  now = Date.now()
}, database = db) {
  const customer = await findCustomer({ customerId, name }, database);
  if (!customer) throw new Error("The customer could not be found.");

  const normalizedName = customer.nameLower ?? customer.name.trim().toLowerCase();
  const debts = await database.debts.toArray();
  const totalDebtPesewas = debts
    .filter((debt) => debt.status === "unpaid" && (
      (customer.id && debt.customerId === customer.id) ||
      (!debt.customerId && getCustomerName(debt).toLowerCase() === normalizedName)
    ))
    .reduce((total, debt) => {
      const balance = getDebtBalance(debt);
      assertPesewasAmount(balance, `Debt ${debt.id} balance`);
      if (!Number.isSafeInteger(total + balance)) {
        throw new RangeError("The customer debt exceeds the supported amount.");
      }

      return total + balance;
    }, 0);

  await database.customers.update(customer.id, { totalDebtPesewas, updatedAt: now });
  return { ...customer, totalDebtPesewas, updatedAt: now };
}

function assertManualDebtPlan(plan, balancePesewas) {
  if (plan === null || plan === undefined) return;
  if (!isValidInstallmentPlanForBalance(plan, balancePesewas)) {
    throw new TypeError("The manual debt installment plan is invalid.");
  }
}

export async function recordManualDebt({
  customerId,
  name,
  phone = "",
  ghanaCardNumber = "",
  debtId,
  amountPesewas,
  initialPaymentPesewas = 0,
  initialPaymentParts = null,
  paymentMethod = "cash",
  note = "",
  dueDate = "",
  installmentPlan = null,
  now = Date.now()
}) {
  const cleanName = name.trim();
  const cleanNote = note.trim();
  const cleanGhanaCardNumber = normalizeGhanaCardNumber(ghanaCardNumber);
  if (!cleanName) throw new TypeError("A customer name is required.");
  assertPesewasAmount(amountPesewas, "The manual debt amount");
  if (amountPesewas <= 0) throw new TypeError("The manual debt amount must be greater than zero.");
  if (!Number.isSafeInteger(initialPaymentPesewas) || initialPaymentPesewas < 0) {
    throw new TypeError("Initial payment must be a non-negative whole-pesewa amount.");
  }
  if (initialPaymentPesewas > amountPesewas) {
    throw new TypeError("Initial payment cannot exceed the manual debt amount.");
  }
  if (!["cash", "momo"].includes(paymentMethod)) {
    throw new TypeError("Choose cash or MoMo for the initial payment.");
  }
  if (!isValidGhanaCardNumber(cleanGhanaCardNumber)) {
    throw new TypeError("Enter a valid Ghana Card number.");
  }
  if (dueDate && !isValidDateString(dueDate)) throw new TypeError("Choose a valid debt due date.");

  const normalizedPaymentParts = normalizeInitialPaymentParts(
    initialPaymentParts,
    initialPaymentPesewas,
    paymentMethod
  );

  return runTransactionWithTimeout(db, [db.debts, db.customers, db.transactions, db.payments], async () => {
    const customer = await resolveCustomer({
      customerId,
      name: cleanName,
      phone,
      ghanaCardNumber: cleanGhanaCardNumber,
      now
    });
    const debts = await db.debts.where("status").equals("unpaid").toArray();
    const matchingDebts = debts.filter((debt) => (
      (customer.id && debt.customerId === customer.id) ||
      (!debt.customerId && getCustomerName(debt).toLowerCase() === customer.nameLower)
    ));
    const existingDebt = debtId
      ? matchingDebts.find((debt) => debt.id === debtId)
      : matchingDebts[0];
    if (debtId && !existingDebt) throw new Error("The selected unpaid debt could not be found.");

    const previousBalancePesewas = existingDebt ? getDebtBalance(existingDebt) : 0;
    assertPesewasAmount(previousBalancePesewas, "The current debt balance");
    const netAddedDebtPesewas = amountPesewas - initialPaymentPesewas;
    const newBalancePesewas = previousBalancePesewas + netAddedDebtPesewas;
    if (!Number.isSafeInteger(newBalancePesewas)) {
      throw new RangeError("The combined debt exceeds the supported amount.");
    }
    assertManualDebtPlan(installmentPlan, newBalancePesewas);

    const debt = existingDebt
      ? {
          ...existingDebt,
          customerId: customer.id,
          customerName: customer.name,
          customer_name: customer.name,
          phone: phone.trim() || existingDebt.phone || customer.phone || "",
          customer_phone: phone.trim() || existingDebt.customer_phone || customer.phone || "",
          ghanaCardNumber: cleanGhanaCardNumber || existingDebt.ghanaCardNumber || customer.ghanaCardNumber || "",
          amountPesewas: newBalancePesewas,
          total_owed: newBalancePesewas,
          ...(newBalancePesewas === 0 ? { status: "paid", dueDate: "" } : {}),
          ...(installmentPlan
            ? existingDebt.isInstallmentPlan
              ? reconcileInstallmentPlanChange(existingDebt, newBalancePesewas, installmentPlan, initialPaymentPesewas)
              : {
                  ...installmentPlan,
                  installmentsRemaining: Math.ceil(newBalancePesewas / installmentPlan.installmentAmount),
                  totalInstallments: Math.ceil(newBalancePesewas / installmentPlan.installmentAmount) + (initialPaymentPesewas > 0 ? 1 : 0)
                }
            : existingDebt.isInstallmentPlan
              ? reconcileInstallmentBalanceCorrection(existingDebt, newBalancePesewas)
              : {}),
          ...(!installmentPlan && !existingDebt.isInstallmentPlan && dueDate ? { dueDate } : {}),
          note: cleanNote || existingDebt.note || "",
          updatedAt: now,
          synced: false,
          syncStatus: "pending"
        }
      : {
          id: createId(),
          customerId: customer.id,
          customerName: customer.name,
          customer_name: customer.name,
          phone: phone.trim() || customer.phone || "",
          customer_phone: phone.trim() || customer.phone || "",
          ghanaCardNumber: cleanGhanaCardNumber || customer.ghanaCardNumber || "",
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
          amountPesewas: newBalancePesewas,
          total_owed: newBalancePesewas,
          note: cleanNote,
          status: newBalancePesewas === 0 ? "paid" : "unpaid",
          createdAt: now,
          created_at: now,
          last_reminder_date: null,
          updatedAt: now,
          synced: false,
          syncStatus: "pending"
        };

    const initialIncomeTransactionId = initialPaymentPesewas > 0 ? createId() : null;
    if (initialIncomeTransactionId) {
      for (const method of ["cash", "momo"]) {
        const methodParts = normalizedPaymentParts.filter((part) => part.paymentMethod === method);
        const methodTotal = methodParts.reduce((sum, part) => sum + part.amountPesewas, 0);
        if (methodTotal === 0) continue;
        const incomeTxId = methodParts.length === 1 && normalizedPaymentParts.length === 1
          ? initialIncomeTransactionId
          : createId();
        await db.transactions.add({
          id: incomeTxId,
          ...(customer?.id && { customerId: customer.id }),
          debtId: debt.id,
          type: "income",
          amountPesewas: methodTotal,
          total_amount: methodTotal,
          payment_method: method,
          customer_name: customer.name,
          customer_phone: phone.trim() || customer.phone || "",
          items_json: "[]",
          note: `Debt payment from ${customer.name}`,
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
            debtId: debt.id,
            amountPesewas: part.amountPesewas,
            paymentMethod: method,
            customer_name: customer.name,
            createdAt: now,
            updatedAt: now,
            transactionId: incomeTxId
          });
        }
      }
    }

    const event = {
      id: createId(),
      type: "manual_debt",
      debtId: debt.id,
      customerId: customer.id,
      amountPesewas: 0,
      total_amount: 0,
      creditExtendedPesewas: amountPesewas,
      previousBalancePesewas,
      newBalancePesewas,
      note: cleanNote,
      itemDescription: "",
      customer_name: customer.name,
      createdAt: now,
      timestamp: now,
      updatedAt: now,
      payment_method: null,
      items_json: "[]",
      synced: false,
      syncStatus: "pending"
    };

    if (existingDebt) await db.debts.put(debt);
    else await db.debts.add(debt);
    await db.transactions.add(event);
    const updatedCustomer = await recalculateCustomerDebtBalance({
      customerId: customer.id,
      now
    }, db);
    return {
      debt,
      customer: updatedCustomer,
      event,
      initialPaymentPesewas,
      initialPaymentParts: normalizedPaymentParts
    };
  });
}

export async function updateCustomerProfile({
  customerId,
  name,
  phone,
  ghanaCardNumber,
  expectedUpdatedAt,
  now = Date.now()
}) {
  const cleanName = name.trim();
  const cleanPhone = phone === undefined ? undefined : phone.trim();
  const cleanGhanaCardNumber = ghanaCardNumber === undefined
    ? undefined
    : normalizeGhanaCardNumber(ghanaCardNumber);

  if (!cleanName) throw new TypeError("A customer name is required.");
  if (cleanPhone !== undefined && cleanPhone && !normalizeWhatsAppPhone(cleanPhone)) {
    throw new TypeError("Enter a valid Ghana mobile number, such as 024 123 4567.");
  }
  if (cleanGhanaCardNumber !== undefined && !isValidGhanaCardNumber(cleanGhanaCardNumber)) {
    throw new TypeError("Enter a valid Ghana Card number.");
  }
  const normalizedPhone = cleanPhone === undefined
    ? undefined
    : normalizeWhatsAppPhone(cleanPhone) || "";

  return runTransactionWithTimeout(db, [db.customers, db.debts], async () => {
    const customer = await resolveCustomer({ customerId, name: cleanName, now });
    if (expectedUpdatedAt !== undefined && customer.updatedAt !== expectedUpdatedAt) {
      throw new Error("The customer changed before the profile could be updated.");
    }

    const customerUpdates = {
      name: cleanName,
      nameLower: cleanName.toLowerCase(),
      ...(cleanPhone !== undefined && { phone: normalizedPhone }),
      ...(cleanGhanaCardNumber !== undefined && { ghanaCardNumber: cleanGhanaCardNumber }),
      updatedAt: now
    };
    await db.customers.update(customer.id, customerUpdates);

    const debts = await db.debts.toArray();
    const matchingDebts = debts.filter((debt) => (
      debt.status === "unpaid" && (
        debt.customerId === customer.id ||
        (!debt.customerId && getCustomerName(debt).toLowerCase() === customer.nameLower)
      )
    ));
    await Promise.all(matchingDebts.map((debt) => db.debts.update(debt.id, {
      customerId: customer.id,
      customerName: cleanName,
      customer_name: cleanName,
      ...(cleanPhone !== undefined && { phone: normalizedPhone, customer_phone: normalizedPhone }),
      ...(cleanGhanaCardNumber !== undefined && { ghanaCardNumber: cleanGhanaCardNumber }),
      updatedAt: now,
      synced: false,
      syncStatus: "pending"
    })));

    return { ...customer, ...customerUpdates };
  });
}

export async function correctDebtBalance({
  debtId,
  expectedUpdatedAt,
  newBalancePesewas,
  reasonCode,
  reasonNote = "",
  actorId = null,
  now = Date.now()
}) {
  assertPesewasAmount(newBalancePesewas, "The corrected balance");
  assertCorrectionReason(reasonCode, reasonNote);
  if (!Number.isFinite(expectedUpdatedAt)) {
    throw new TypeError("A debt version is required to correct the balance.");
  }

  return runTransactionWithTimeout(db, [db.debts, db.customers, db.transactions, db.payments], async () => {
    const debt = await db.debts.get(debtId);
    const previousBalancePesewas = getDebtBalance(debt);
    if (!debt || debt.status !== "unpaid" || !Number.isSafeInteger(previousBalancePesewas)) {
      throw new Error("Only a valid unpaid debt can be corrected.");
    }
    if (debt.updatedAt !== expectedUpdatedAt) {
      throw new Error("The debt changed before the balance could be corrected.");
    }
    if (newBalancePesewas === previousBalancePesewas) {
      throw new TypeError("The corrected balance must be different from the current balance.");
    }
    if (newBalancePesewas > previousBalancePesewas) {
      throw new TypeError("A correction cannot increase the balance. Use Add to debt instead.");
    }

    const customerName = getCustomerName(debt);
    const customer = await resolveCustomer({
      customerId: debt.customerId,
      name: customerName,
      phone: debt.phone ?? debt.customer_phone ?? "",
      ghanaCardNumber: debt.ghanaCardNumber ?? "",
      now
    });
    const deltaPesewas = newBalancePesewas - previousBalancePesewas;
    const installmentUpdates = reconcileInstallmentBalanceCorrection(debt, newBalancePesewas);
    const debtUpdates = {
      customerId: customer.id,
      amountPesewas: newBalancePesewas,
      total_owed: newBalancePesewas,
      ...installmentUpdates,
      updatedAt: now,
      synced: false,
      syncStatus: "pending"
    };
    const debtBefore = {
      amountPesewas: previousBalancePesewas,
      total_owed: debt.total_owed ?? previousBalancePesewas,
      status: debt.status,
      isInstallmentPlan: debt.isInstallmentPlan ?? false,
      installmentAmount: debt.installmentAmount ?? 0,
      frequency: debt.frequency ?? "",
      nextDueDate: debt.nextDueDate ?? "",
      installmentsRemaining: debt.installmentsRemaining ?? 0,
      totalInstallments: debt.totalInstallments ?? 0,
      installmentPaymentCarryPesewas: debt.installmentPaymentCarryPesewas ?? 0
    };
    const debtAfter = { ...debtBefore, ...debtUpdates };
    const adjustment = {
      id: createId(),
      type: "debt_adjustment",
      debtId,
      customerId: customer.id,
      previousBalancePesewas,
      newBalancePesewas,
      deltaPesewas,
      reasonCode,
      reasonNote: reasonNote.trim(),
      actorId: typeof actorId === "string" && actorId.trim() ? actorId.trim() : null,
      debtBefore,
      debtAfter,
      customer_name: customerName,
      customer_phone: debt.phone ?? debt.customer_phone ?? customer.phone ?? "",
      amountPesewas: 0,
      total_amount: 0,
      payment_method: null,
      items_json: "[]",
      createdAt: now,
      timestamp: now,
      updatedAt: now,
      synced: false,
      syncStatus: "pending"
    };

    await db.transactions.add(adjustment);
    const allDebts = await db.debts.toArray();
    const customerBalanceBefore = allDebts
      .filter((item) => item.status === "unpaid" && (
        item.customerId === customer.id ||
        (!item.customerId && getCustomerName(item).toLowerCase() === customer.nameLower)
      ))
      .reduce((total, item) => total + getDebtBalance(item), 0);
    await assertDebtBalanceMatchesEvents({
      customerId: customer.id,
      customerName: customer.name,
      expectedBalancePesewas: customerBalanceBefore + deltaPesewas,
      database: db
    });
    await db.debts.update(debtId, debtUpdates);
    const updatedCustomer = await recalculateCustomerDebtBalance({
      customerId: customer.id,
      now
    }, db);

    return {
      debt: { ...debt, ...debtUpdates },
      customer: updatedCustomer,
      adjustment
    };
  });
}

// Temporary compatibility wrappers for the legacy UI until its editor is
// migrated to correctDebtBalance and updateCustomerProfile.
export async function updateCustomerPhone({
  debt,
  phone,
  updateAllMatching = false,
  now = Date.now()
}) {
  const normalizedPhone = normalizeWhatsAppPhone(phone);
  if (!normalizedPhone) throw new TypeError("Enter a valid Ghana WhatsApp number.");
  if (updateAllMatching) {
    const customerName = getCustomerName(debt);
    const customer = await resolveCustomer({ customerId: debt.customerId, name: customerName, now });
    return updateCustomerProfile({
      customerId: customer.id,
      name: customer.name,
      phone: normalizedPhone,
      now
    }).then(() => db.debts.where("customerId").equals(customer.id).toArray());
  }
  const updated = await updateCustomerProfile({
    customerId: debt.customerId,
    name: getCustomerName(debt),
    phone: normalizedPhone,
    now
  });
  return db.debts.where("customerId").equals(updated.id).toArray();
}
