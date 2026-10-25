import { db } from "./db.js";
import { upsertCustomer } from "./customers.js";
import { runTransactionWithTimeout } from "./runTransactionWithTimeout.js";
import { createId } from "../lib/ids.js";
import { formatGhs } from "../lib/money.js";
import { reconcileInstallmentPayment } from "../utils/installments.js";

export async function addDebtToCustomer({
  name,
  phone = "",
  ghanaCardNumber = "",
  amountPesewas,
  note = "",
  installmentPlan = null,
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
    const combinedAmount = existingAmount + amountPesewas;
    if (!Number.isSafeInteger(combinedAmount)) {
      throw new RangeError("The combined customer debt exceeds the supported amount.");
    }

    const combinedNote = [existingDebt.note?.trim(), note.trim()].filter(Boolean).join(", ");
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
      phone: phone.trim() || existingDebt.phone || existingDebt.customer_phone || "",
      customer_phone: phone.trim() || existingDebt.customer_phone || existingDebt.phone || "",
      ghanaCardNumber: cleanGhanaCardNumber || existingDebt.ghanaCardNumber || "",
      amountPesewas: combinedAmount,
      total_owed: combinedAmount,
      ...updatedInstallmentData,
      note: combinedNote,
      updatedAt: now,
      synced: false,
      syncStatus: "pending"
    };
    await db.debts.update(existingDebt.id, updatedDebt);
    return { ...existingDebt, ...updatedDebt, isAddon: true };
  }

  if (amountPesewas === 0) return null;

  const newDebt = {
    id: createId(),
    ...(transactionId && { transactionId }),
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
      totalInstallments: 0
    }),
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
  return { ...newDebt, isAddon: false };
}

export async function recordDebtPayment({ debtId, amountPesewas, paymentMethod, now = Date.now() }) {
  if (!debtId || !Number.isSafeInteger(amountPesewas) || amountPesewas <= 0) {
    throw new TypeError("A debt and positive payment amount are required.");
  }
  if (!["cash", "momo"].includes(paymentMethod)) {
    throw new TypeError("Choose a valid payment method.");
  }

  return runTransactionWithTimeout(db, [db.debts, db.payments, db.transactions, db.customers], async () => {
    const currentDebt = await db.debts.get(debtId);
    const currentAmount = currentDebt?.amountPesewas ?? currentDebt?.total_owed;
    if (!currentDebt || currentDebt.status !== "unpaid" || !Number.isSafeInteger(currentAmount) || amountPesewas > currentAmount) {
      throw new Error("The debt changed before the payment could be recorded.");
    }

    const remainingPesewas = currentAmount - amountPesewas;
    const installmentUpdates = reconcileInstallmentPayment(
      { ...currentDebt, amountPesewas: currentAmount },
      amountPesewas,
      remainingPesewas
    );
    const customerName = currentDebt.customerName ?? currentDebt.customer_name ?? "";
    const phone = currentDebt.phone ?? currentDebt.customer_phone ?? "";
    const paymentId = createId();
    const transactionId = createId();

    await db.debts.update(debtId, {
      ...(remainingPesewas === 0 ? { status: "paid" } : {}),
      amountPesewas: remainingPesewas,
      total_owed: remainingPesewas,
      ...installmentUpdates,
      updatedAt: now,
      synced: false,
      syncStatus: "pending"
    });
    await db.payments.add({
      id: paymentId,
      debtId,
      amountPesewas,
      paymentMethod,
      customer_name: customerName,
      createdAt: now,
      updatedAt: now
    });
    await db.transactions.add({
      id: transactionId,
      type: "income",
      amountPesewas,
      total_amount: amountPesewas,
      payment_method: paymentMethod,
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
    await upsertCustomer({
      name: customerName,
      phone,
      debtDeltaPesewas: -amountPesewas,
      now
    });
    return { remainingPesewas };
  });
}
