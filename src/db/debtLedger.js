import { db } from "./db.js";
import { upsertCustomer } from "./customers.js";
import { runTransactionWithTimeout } from "./runTransactionWithTimeout.js";
import { runIdempotentSave } from "./saveAttempts.js";
import { createId } from "../lib/ids.js";
import { PLAN_ERROR, planError } from "../lib/planErrors.js";
import { isValidGhanaCardNumber, normalizeGhanaCardNumber } from "../lib/ghanaCardNumber.js";
import { normalizeWhatsAppPhone } from "../utils/whatsapp.js";
import { getMomoConfirmedPesewas, getMomoDetails, getMomoVerification, MOMO_VERIFICATION } from "../pos/momoMapping.js";
import {
  isValidDateString,
  isValidInstallmentPlanForBalance,
  localDateString,
  reconcileInstallmentBalanceCorrection,
  reconcileInstallmentPayment,
  reconcileInstallmentPlanChange
} from "../utils/installments.js";
import {
  calculateLedgerEventBalance,
  getCustomerLedgerRecords,
  getCreditEventAmount,
  matchSaleTimePayments
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
    throw planError(PLAN_ERROR.paymentPartsMismatch, "Initial payment parts must add up to the initial payment amount.");
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
  const saleTimePayments = matchSaleTimePayments(ledgerRecords.transactions, ledgerRecords.payments);
  const creditEvents = ledgerRecords.transactions.filter((record) => getCreditEventAmount(record, saleTimePayments) > 0);

  // Legacy debts may have no source credit event. They remain valid until
  // migrated, but there is no event-based baseline to reconcile yet.
  if (!creditEvents.length && !ledgerRecords.payments.length) return;

  const { balancePesewas: eventBalancePesewas } = calculateLedgerEventBalance(
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

  // A restored customer may have no name; match such a customer by id only.
  const normalizedName = customer.nameLower ?? (typeof customer.name === "string" ? customer.name.trim().toLowerCase() : "");
  const debts = await database.debts.toArray();
  const totalDebtPesewas = debts
    .filter((debt) => debt.status === "unpaid" && (
      (customer.id && debt.customerId === customer.id) ||
      (normalizedName && !debt.customerId && getCustomerName(debt).toLowerCase() === normalizedName)
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
    const eachTimeTooHigh = plan.isInstallmentPlan && Number.isSafeInteger(plan.installmentAmount) &&
      plan.installmentAmount > balancePesewas;
    throw eachTimeTooHigh
      ? planError(PLAN_ERROR.eachTimeTooHigh, "The manual debt installment plan is invalid.")
      : new TypeError("The manual debt installment plan is invalid.");
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
  takenOn = "",
  attemptId,
  now = Date.now()
}) {
  const cleanName = name.trim();
  const cleanNote = note.trim();
  // Taken on (53): the day the debt was taken, today or earlier. The record times stay
  // the time it was entered; history orders the debt by this date.
  if (takenOn && (!isValidDateString(takenOn) || takenOn > localDateString(new Date(now)))) {
    throw new TypeError("Taken on must be today or an earlier date.");
  }
  const cleanGhanaCardNumber = normalizeGhanaCardNumber(ghanaCardNumber);
  if (!cleanName) throw new TypeError("A customer name is required.");
  assertPesewasAmount(amountPesewas, "The manual debt amount");
  if (amountPesewas <= 0) throw new TypeError("The manual debt amount must be greater than zero.");
  if (!Number.isSafeInteger(initialPaymentPesewas) || initialPaymentPesewas < 0) {
    throw new TypeError("Initial payment must be a non-negative whole-pesewa amount.");
  }
  // The payment today may be more than the amount added: 19's "Maximum today" is the whole balance
  // (older debt + amount added). The limit is checked below, once the older balance is known.
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
  // Read from the raw parts: normalizing keeps only method and amount (F1, Batch 4b).
  const momoVerification = getMomoVerification(
    initialPaymentParts ?? [{ paymentMethod, amountPesewas: initialPaymentPesewas }]
  ) || MOMO_VERIFICATION.merchantConfirmed;
  // What 62 confirmed for the MoMo part (refuses a part saved for more than that).
  const momoConfirmedPesewas = getMomoConfirmedPesewas(
    initialPaymentParts ?? [{ paymentMethod, amountPesewas: initialPaymentPesewas }]
  );

  // D11: the same attemptId with the same details returns the first save, never a second one.
  const attemptContent = {
    momoConfirmedPesewas, customerId, name: cleanName, phone, ghanaCardNumber: cleanGhanaCardNumber, debtId, amountPesewas, initialPaymentPesewas,
    initialPaymentParts: normalizedPaymentParts, paymentMethod, note: cleanNote, dueDate, installmentPlan, takenOn
  };
  return runIdempotentSave({ db, tables: [db.debts, db.customers, db.transactions, db.payments], attemptId, content: attemptContent, now }, async () => {
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
    if (debtId && !existingDebt) throw planError(PLAN_ERROR.debtChanged, "The selected unpaid debt could not be found.");

    const previousBalancePesewas = existingDebt ? getDebtBalance(existingDebt) : 0;
    assertPesewasAmount(previousBalancePesewas, "The current debt balance");
    // The customer's other open entries (older data can have more than one). A payment larger than
    // the amount added pays the entry added to first, then the others, oldest first (as recordCreditSale does).
    const otherDebts = matchingDebts
      .filter((candidate) => candidate !== existingDebt)
      .sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0));
    const otherBalances = otherDebts.map((candidate) => getDebtBalance(candidate));
    otherBalances.forEach((balance) => assertPesewasAmount(balance, "The current debt balance"));
    const owedBeforePesewas = previousBalancePesewas + otherBalances.reduce((sum, balance) => sum + balance, 0);
    if (!Number.isSafeInteger(owedBeforePesewas + amountPesewas)) {
      throw new RangeError("The combined debt exceeds the supported amount.");
    }
    if (initialPaymentPesewas > owedBeforePesewas + amountPesewas) {
      throw planError(PLAN_ERROR.paymentTooHigh, "Initial payment cannot exceed the customer's total debt after this addition.", { maximumPesewas: owedBeforePesewas + amountPesewas });
    }
    // The part of the payment that pays the amount added is recorded as before; the rest pays
    // older debt and is recorded as a real debt collection.
    const addedPaymentPesewas = Math.min(initialPaymentPesewas, amountPesewas);
    let extraLeftPesewas = initialPaymentPesewas - addedPaymentPesewas;
    const extraToTargetPesewas = Math.min(extraLeftPesewas, previousBalancePesewas);
    extraLeftPesewas -= extraToTargetPesewas;
    const extraToOthers = [];
    otherDebts.forEach((candidate, index) => {
      const paidPesewas = Math.min(extraLeftPesewas, otherBalances[index]);
      if (paidPesewas > 0) extraToOthers.push({ debt: candidate, balancePesewas: otherBalances[index], paidPesewas });
      extraLeftPesewas -= paidPesewas;
    });
    const netAddedDebtPesewas = amountPesewas - addedPaymentPesewas - extraToTargetPesewas;
    const newBalancePesewas = previousBalancePesewas + netAddedDebtPesewas;
    if (!Number.isSafeInteger(newBalancePesewas)) {
      throw new RangeError("The combined debt exceeds the supported amount.");
    }
    // A settled debt carries no plan: 19 sends a "no plan" object when everything is paid today.
    const appliedPlan = newBalancePesewas === 0 && installmentPlan && !installmentPlan.isInstallmentPlan
      ? null
      : installmentPlan;
    assertManualDebtPlan(appliedPlan, newBalancePesewas);
    // Progress toward the new plan: as before, the payment today. When it is more than the amount
    // added, only what pays older debt counts (recordCreditSale does the same), so the first
    // payment date chosen on 19 is not pushed out by the payment made today.
    const planProgressPesewas = initialPaymentPesewas > amountPesewas ? extraToTargetPesewas : initialPaymentPesewas;

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
          ...(appliedPlan
            ? existingDebt.isInstallmentPlan
              ? reconcileInstallmentPlanChange(existingDebt, newBalancePesewas, appliedPlan, planProgressPesewas)
              : {
                  ...appliedPlan,
                  installmentsRemaining: Math.ceil(newBalancePesewas / appliedPlan.installmentAmount),
                  totalInstallments: Math.ceil(newBalancePesewas / appliedPlan.installmentAmount) + (initialPaymentPesewas > 0 ? 1 : 0)
                }
            : existingDebt.isInstallmentPlan
              ? reconcileInstallmentBalanceCorrection(existingDebt, newBalancePesewas)
              : {}),
          ...(!appliedPlan && !existingDebt.isInstallmentPlan && dueDate ? { dueDate } : {}),
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
          ...(appliedPlan ?? {
            isInstallmentPlan: false,
            installmentAmount: 0,
            frequency: "",
            nextDueDate: "",
            installmentsRemaining: 0,
            totalInstallments: 0,
            installmentPaymentCarryPesewas: 0
          }),
          dueDate: appliedPlan ? "" : dueDate,
          amountPesewas: newBalancePesewas,
          total_owed: newBalancePesewas,
          note: cleanNote,
          ...(takenOn && { takenOn }),
          status: newBalancePesewas === 0 ? "paid" : "unpaid",
          createdAt: now,
          created_at: now,
          last_reminder_date: null,
          updatedAt: now,
          synced: false,
          syncStatus: "pending"
        };

    // Split each method's payment into the part that pays the amount added and the rest (older debt).
    let addedLeftPesewas = addedPaymentPesewas;
    const addedParts = [];
    const extraParts = [];
    for (const part of normalizedPaymentParts) {
      const toAdded = Math.min(part.amountPesewas, addedLeftPesewas);
      addedLeftPesewas -= toAdded;
      if (toAdded > 0) addedParts.push({ paymentMethod: part.paymentMethod, amountPesewas: toAdded });
      if (part.amountPesewas - toAdded > 0) extraParts.push({ paymentMethod: part.paymentMethod, amountPesewas: part.amountPesewas - toAdded });
    }
    const addedMomoPesewas = addedParts.filter((part) => part.paymentMethod === "momo").reduce((sum, part) => sum + part.amountPesewas, 0);

    const initialIncomeTransactionId = addedPaymentPesewas > 0 ? createId() : null;
    if (initialIncomeTransactionId) {
      for (const method of ["cash", "momo"]) {
        const methodParts = addedParts.filter((part) => part.paymentMethod === method);
        const methodTotal = methodParts.reduce((sum, part) => sum + part.amountPesewas, 0);
        if (methodTotal === 0) continue;
        const incomeTxId = methodParts.length === 1 && addedParts.length === 1
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
          ...(method === "momo" && getMomoDetails(momoVerification, momoConfirmedPesewas)),
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
            ...(method === "momo" && getMomoDetails(momoVerification)),
            customer_name: customer.name,
            createdAt: now,
            updatedAt: now,
            transactionId: incomeTxId
          });
        }
      }
    }

    // The rest of the payment pays older debt: a real debt collection, as recordCreditSale writes it
    // (income transaction and payment row with a collectionId; counted as a debt payment in Money in).
    if (extraParts.length > 0) {
      const extraTargets = [
        ...(extraToTargetPesewas > 0 ? [{ debtId: debt.id, paidPesewas: extraToTargetPesewas }] : []),
        ...extraToOthers.map((other) => ({ debtId: other.debt.id, paidPesewas: other.paidPesewas }))
      ];
      const remainingExtraParts = extraParts.map((part) => ({ ...part }));
      const extraAllocations = [];
      for (const target of extraTargets) {
        let targetLeft = target.paidPesewas;
        for (const part of remainingExtraParts) {
          if (targetLeft === 0) break;
          const allocated = Math.min(part.amountPesewas, targetLeft);
          if (allocated === 0) continue;
          part.amountPesewas -= allocated;
          targetLeft -= allocated;
          extraAllocations.push({ debtId: target.debtId, paymentMethod: part.paymentMethod, amountPesewas: allocated });
        }
      }
      const extraCollectionId = createId();
      for (const method of ["cash", "momo"]) {
        const methodAllocations = extraAllocations.filter((allocation) => allocation.paymentMethod === method);
        const methodTotal = methodAllocations.reduce((sum, allocation) => sum + allocation.amountPesewas, 0);
        if (methodTotal === 0) continue;
        const extraTxId = createId();
        await db.transactions.add({
          id: extraTxId,
          ...(customer?.id && { customerId: customer.id }),
          debtId: methodAllocations[0].debtId,
          collectionId: extraCollectionId,
          collectionType: "debt_collection",
          type: "income",
          amountPesewas: methodTotal,
          total_amount: methodTotal,
          payment_method: method,
          // The confirmed amount is on the record that holds the MoMo money for the amount added, otherwise here.
          ...(method === "momo" && getMomoDetails(momoVerification, addedMomoPesewas > 0 ? undefined : momoConfirmedPesewas)),
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
        for (const allocation of methodAllocations) {
          await db.payments.add({
            id: createId(),
            ...(customer?.id && { customerId: customer.id }),
            debtId: allocation.debtId,
            amountPesewas: allocation.amountPesewas,
            paymentMethod: method,
            ...(method === "momo" && getMomoDetails(momoVerification)),
            customer_name: customer.name,
            collectionId: extraCollectionId,
            collectionType: "debt_collection",
            createdAt: now,
            updatedAt: now,
            transactionId: extraTxId
          });
        }
      }
    }
    // The customer's other open entries that the extra payment reached.
    for (const { debt: otherDebt, balancePesewas, paidPesewas } of extraToOthers) {
      const remainingPesewas = balancePesewas - paidPesewas;
      const installmentUpdates = otherDebt.isInstallmentPlan
        ? reconcileInstallmentPayment({ ...otherDebt, amountPesewas: balancePesewas }, paidPesewas, remainingPesewas)
        : {};
      await db.debts.update(otherDebt.id, {
        amountPesewas: remainingPesewas,
        total_owed: remainingPesewas,
        ...(remainingPesewas === 0 ? { status: "paid", dueDate: "" } : {}),
        ...installmentUpdates,
        updatedAt: now,
        synced: false,
        syncStatus: "pending"
      });
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
      ...(takenOn && { takenOn }),
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

// 43: the merchant opened a WhatsApp reminder and came back (brief line 286). Stored on each
// of the person's unpaid debts, since the reminder covers their whole balance.
export async function recordDebtReminder({ debtIds, now = Date.now() }) {
  if (!Array.isArray(debtIds) || !Number.isFinite(now)) throw new TypeError("Debts and a time are required.");
  return db.transaction("rw", db.debts, async () => {
    const debts = (await db.debts.bulkGet(debtIds)).filter((debt) => debt?.status === "unpaid");
    await Promise.all(debts.map((debt) => db.debts.update(debt.id, {
      lastReminderAt: now,
      updatedAt: now,
      synced: false,
      syncStatus: "pending"
    })));
    return debts.length;
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
