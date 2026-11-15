import { createId } from "../lib/ids.js";
import { runTransactionWithTimeout } from "./runTransactionWithTimeout.js";
import { db } from "./db.js";
import { getSupplierBalances, validateSupplierExpense } from "../utils/suppliers.js";
import { isValidDateString } from "../utils/installments.js";

const CATEGORIES = new Set(["stock", "transport", "rent", "utilities", "other"]);
// Wiring 44/45/46 "Paid with": how the money that left was paid. Stored as paidWith on the expense
// (for the part paid now) and on a supplier payment. Records saved before this have no paidWith;
// My money (33) shows them as "Method not recorded". payment_method stays as it always was.
export const PAID_WITH = new Set(["cash", "momo"]);

function checkPaidWith(paidWith) {
  if (paidWith !== undefined && !PAID_WITH.has(paidWith)) throw new TypeError("Choose Cash or MoMo.");
}

export async function recordExpense({
  amountPesewas,
  paidAmountPesewas,
  category,
  note = "",
  supplierId,
  payBy = "",
  newSupplier,
  paidWith,
  now = Date.now()
}) {
  checkPaidWith(paidWith);
  validateSupplierExpense({
    amountPesewas,
    paidAmountPesewas,
    category,
    supplierId: supplierId ?? (newSupplier ? "__new__" : undefined)
  });
  if (!CATEGORIES.has(category)) throw new TypeError("Choose a valid expense category.");
  if (payBy && !isValidDateString(payBy)) throw new TypeError("Choose a valid supplier due date.");
  if (newSupplier && !(typeof newSupplier.name === "string" && newSupplier.name.trim())) {
    throw new TypeError("A supplier name is required.");
  }
  const owedAmountPesewas = amountPesewas - paidAmountPesewas;
  return runTransactionWithTimeout(db, [db.suppliers, db.transactions], async () => {
    let linkedSupplierId = supplierId;
    if (newSupplier) {
      const cleanName = newSupplier.name.trim();
      const nameLower = cleanName.toLowerCase();
      const existing = await db.suppliers.where("nameLower").equals(nameLower).first();
      if (existing) {
        linkedSupplierId = existing.id;
      } else {
        linkedSupplierId = createId();
        await db.suppliers.add({
          id: linkedSupplierId,
          name: cleanName,
          nameLower,
          phone: newSupplier.phone?.trim() ?? "",
          createdAt: now,
          updatedAt: now
        });
      }
    }
    if (owedAmountPesewas > 0 && linkedSupplierId && !await db.suppliers.get(linkedSupplierId)) {
      throw new Error("The selected supplier could not be found.");
    }
    const transaction = {
      id: createId(),
      type: "expense",
      category,
      amountPesewas,
      total_amount: amountPesewas,
      paidAmountPesewas,
      owedAmountPesewas,
      ...(owedAmountPesewas > 0 && { supplierId: linkedSupplierId, payBy }),
      // Only money that left now has a method; nothing paid now (all owed) has none.
      ...(paidAmountPesewas > 0 && paidWith && { paidWith }),
      note: note.trim(),
      payment_method: "cash",
      customer_name: "",
      customer_phone: "",
      items_json: "[]",
      createdAt: now,
      timestamp: now,
      updatedAt: now,
      synced: false,
      syncStatus: "pending"
    };
    await db.transactions.add(transaction);
    return transaction;
  });
}

export async function recordSupplierPayment({ supplierId, amountPesewas, paidWith, now = Date.now() }) {
  checkPaidWith(paidWith);
  if (!supplierId) throw new TypeError("Choose a supplier.");
  if (!Number.isSafeInteger(amountPesewas) || amountPesewas <= 0) {
    throw new TypeError("Enter a positive supplier payment.");
  }
  return runTransactionWithTimeout(db, [db.suppliers, db.transactions], async () => {
    const supplier = await db.suppliers.get(supplierId);
    if (!supplier) throw new Error("The selected supplier could not be found.");
    const [suppliers, transactions] = await Promise.all([
      db.suppliers.toArray(),
      db.transactions.toArray()
    ]);
    const balance = getSupplierBalances(transactions, suppliers)
      .find((record) => record.id === supplierId)?.balancePesewas ?? 0;
    if (amountPesewas > balance) throw new RangeError("The payment is higher than this supplier's balance.");
    const transaction = {
      id: createId(),
      type: "supplier_payment",
      supplierId,
      amountPesewas,
      total_amount: amountPesewas,
      payment_method: "cash",
      ...(paidWith && { paidWith }),
      customer_name: "",
      customer_phone: "",
      items_json: "[]",
      note: `Payment to ${supplier.name}`,
      createdAt: now,
      timestamp: now,
      updatedAt: now,
      synced: false,
      syncStatus: "pending"
    };
    await db.transactions.add(transaction);
    return transaction;
  });
}
