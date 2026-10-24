import { db } from "./db.js";
import { createId } from "../lib/ids.js";

export function normalizeCustomerName(name) {
  return name.trim().toLowerCase();
}

export async function upsertCustomer({
  name,
  phone = "",
  ghanaCardNumber = "",
  replaceGhanaCardNumber = false,
  debtDeltaPesewas = 0,
  now = Date.now()
}) {
  const cleanName = name.trim();
  const nameLower = normalizeCustomerName(cleanName);
  if (!nameLower) return null;
  const cleanGhanaCardNumber = ghanaCardNumber.trim().toUpperCase();

  const customer = await db.customers.where("nameLower").equals(nameLower).first();
  if (customer) {
    const updatedCustomer = {
      name: cleanName,
      nameLower,
      phone: phone.trim() || customer.phone || "",
      ghanaCardNumber: replaceGhanaCardNumber
        ? cleanGhanaCardNumber
        : cleanGhanaCardNumber || customer.ghanaCardNumber || "",
      totalDebtPesewas: Math.max(0, (customer.totalDebtPesewas ?? 0) + debtDeltaPesewas),
      updatedAt: now
    };
    await db.customers.update(customer.id, updatedCustomer);
    return { ...customer, ...updatedCustomer };
  }

  const newCustomer = {
    id: createId(),
    name: cleanName,
    nameLower,
    phone: phone.trim(),
    ghanaCardNumber: cleanGhanaCardNumber,
    totalDebtPesewas: Math.max(0, debtDeltaPesewas),
    createdAt: now,
    updatedAt: now
  };
  await db.customers.add(newCustomer);
  return newCustomer;
}
