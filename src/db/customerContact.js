import { db } from "./db.js";
import { upsertCustomer } from "./customers.js";
import { runTransactionWithTimeout } from "./runTransactionWithTimeout.js";
import { isValidGhanaCardNumber, normalizeGhanaCardNumber } from "../lib/ghanaCardNumber.js";
import { normalizeWhatsAppPhone } from "../utils/whatsapp.js";

export async function saveCustomerContact({
  customerId,
  name,
  phone = "",
  ghanaCardNumber = "",
  now = Date.now()
}) {
  const cleanName = name.trim();
  const cleanPhone = phone.trim();
  const cleanGhanaCardNumber = normalizeGhanaCardNumber(ghanaCardNumber);
  if (!cleanName) throw new TypeError("A customer name is required.");
  if (cleanPhone && !normalizeWhatsAppPhone(cleanPhone)) {
    throw new TypeError("Enter a valid Ghana mobile number, such as 024 123 4567.");
  }
  if (!isValidGhanaCardNumber(cleanGhanaCardNumber)) {
    throw new TypeError("Enter a valid Ghana Card number.");
  }

  return runTransactionWithTimeout(db, [db.customers, db.debts], async () => {
    const nameLower = cleanName.toLowerCase();
    const customer = (customerId ? await db.customers.get(customerId) : null) ??
      await db.customers.where("nameLower").equals(nameLower).first();
    const updatedCustomer = customer
      ? {
          ...customer,
          phone: cleanPhone,
          ghanaCardNumber: cleanGhanaCardNumber,
          updatedAt: now
        }
      : await upsertCustomer({
          name: cleanName,
          phone: cleanPhone,
          ghanaCardNumber: cleanGhanaCardNumber,
          now
        });

    if (customer) await db.customers.update(customer.id, updatedCustomer);
    const debts = await db.debts.toArray();
    const matchingDebts = debts.filter((debt) =>
      (debt.customerId === updatedCustomer?.id) ||
      (debt.customer_name ?? debt.customerName ?? "").trim().toLowerCase() === nameLower
    );
    for (const debt of matchingDebts) {
      await db.debts.update(debt.id, {
        phone: cleanPhone,
        customer_phone: cleanPhone,
        ghanaCardNumber: cleanGhanaCardNumber,
        updatedAt: now,
        synced: false,
        syncStatus: "pending"
      });
    }

    return {
      customerId: updatedCustomer?.id ?? customerId ?? "",
      name: updatedCustomer?.name ?? cleanName,
      phone: cleanPhone,
      ghanaCardNumber: cleanGhanaCardNumber
    };
  });
}
