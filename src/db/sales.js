import { createId } from "../lib/ids.js";
import { normalizeSaleItems, totalSaleItemsPesewas } from "../lib/saleItems.js";
import { getMomoVerification, MOMO_VERIFICATION } from "../pos/momoMapping.js";
import { runTransactionWithTimeout } from "./runTransactionWithTimeout.js";
import { db } from "./db.js";

export async function recordCashSale({
  amountPesewas,
  cashReceivedPesewas = amountPesewas,
  momoReceivedPesewas = 0,
  saleItems = [],
  parts = null,
  now = Date.now()
}) {
  const items = normalizeSaleItems(saleItems);
  if (!Number.isSafeInteger(amountPesewas) || amountPesewas <= 0) {
    throw new TypeError("Sale amount must be a positive whole-pesewa amount.");
  }
  if (!Number.isSafeInteger(cashReceivedPesewas) || cashReceivedPesewas < 0 ||
    !Number.isSafeInteger(momoReceivedPesewas) || momoReceivedPesewas < 0 ||
    cashReceivedPesewas + momoReceivedPesewas !== amountPesewas) {
    throw new TypeError("Cash and MoMo payments must add up to the sale amount.");
  }
  if (items.length && totalSaleItemsPesewas(items) !== amountPesewas) {
    throw new TypeError("Item totals must match the sale amount.");
  }
  const paymentMethod = cashReceivedPesewas > 0 && momoReceivedPesewas > 0
    ? "split"
    : momoReceivedPesewas > 0 ? "momo" : "cash";
  const momoVerification = momoReceivedPesewas > 0
    ? getMomoVerification(parts) || MOMO_VERIFICATION.merchantConfirmed
    : "";
  const transaction = {
    id: createId(),
    type: "sale",
    amountPesewas,
    total_amount: amountPesewas,
    payment_method: paymentMethod,
    paymentType: paymentMethod,
    cashReceivedPesewas,
    momoReceivedPesewas,
    ...(momoVerification && { momoVerification }),
    customer_name: "",
    customer_phone: "",
    items_json: JSON.stringify(items),
    note: "",
    createdAt: now,
    timestamp: now,
    updatedAt: now,
    synced: false,
    syncStatus: "pending"
  };
  await runTransactionWithTimeout(db, [db.transactions], () => db.transactions.add(transaction));
  return transaction;
}
