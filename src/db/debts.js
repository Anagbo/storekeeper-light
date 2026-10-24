import { db } from "./db.js";
import { createId } from "../lib/ids.js";

export async function addDebtToCustomer({
  name,
  phone = "",
  ghanaCardNumber = "",
  amountPesewas,
  note = "",
  transactionId,
  now = Date.now()
}) {
  const customerName = name.trim();
  const normalizedName = customerName.toLowerCase();
  const cleanGhanaCardNumber = ghanaCardNumber.trim().toUpperCase();
  if (!normalizedName) throw new TypeError("A customer name is required to record debt.");
  if (!Number.isSafeInteger(amountPesewas) || amountPesewas <= 0) {
    throw new TypeError("Debt amount must be a positive integer number of pesewas.");
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
    const updatedDebt = {
      customerName: existingDebt.customerName ?? existingDebt.customer_name ?? customerName,
      customer_name: existingDebt.customer_name ?? existingDebt.customerName ?? customerName,
      phone: phone.trim() || existingDebt.phone || existingDebt.customer_phone || "",
      customer_phone: phone.trim() || existingDebt.customer_phone || existingDebt.phone || "",
      ghanaCardNumber: cleanGhanaCardNumber || existingDebt.ghanaCardNumber || "",
      amountPesewas: combinedAmount,
      total_owed: combinedAmount,
      note: combinedNote,
      updatedAt: now,
      synced: false,
      syncStatus: "pending"
    };
    await db.debts.update(existingDebt.id, updatedDebt);
    return { ...existingDebt, ...updatedDebt };
  }

  const newDebt = {
    id: createId(),
    ...(transactionId && { transactionId }),
    customerName,
    customer_name: customerName,
    phone: phone.trim(),
    customer_phone: phone.trim(),
    ghanaCardNumber: cleanGhanaCardNumber,
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
  return newDebt;
}
