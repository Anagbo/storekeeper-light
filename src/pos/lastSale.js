import { db as defaultDb } from "../db/db.js";
import { getFinancialDateRange } from "../utils/financials.js";
import { createPosTransactionRows } from "./transactionFeed.js";

// wide_layout.approved_additions (2) and wiring 15 "Last sale box wording" (23 Nov 2026): the most
// recent saved sale today, read-only. One indexed query per sale type on [type+createdAt], newest
// first, one record each; nothing is written. The method comes from the same row maths as Today’s
// transactions (createPosTransactionRows), so the box and the table always agree.
export const LAST_SALE_TYPES = Object.freeze(["sale", "installment_sale", "installment_addon"]);

export async function loadLastSaleToday(database = defaultDb, now = new Date()) {
  const { start, end } = getFinancialDateRange("day", "", "", now);
  const newest = await Promise.all(LAST_SALE_TYPES.map((type) => database.transactions
    .where("[type+createdAt]")
    .between([type, start], [type, end], true, false)
    .reverse()
    .first()));
  const sale = newest.filter(Boolean).sort((a, b) => b.createdAt - a.createdAt)[0];
  return sale ? describeLastSale(sale) : null;
}

// { amountPesewas (the sale total), method: "cash" | "momo" | "split" | "credit" | "part_paid", timestamp }
export function describeLastSale(transaction) {
  const [row] = createPosTransactionRows([transaction]);
  const totalPesewas = transaction.amountPesewas ?? transaction.total_amount;
  if (!row || !Number.isSafeInteger(totalPesewas)) return null;
  const method = row.owedPesewas > 0
    ? row.cashReceivedPesewas > 0 ? "part_paid" : "credit"
    : row.cashPesewas > 0 && row.momoPesewas > 0 ? "split" : row.momoPesewas > 0 ? "momo" : "cash";
  return { amountPesewas: totalPesewas, method, timestamp: row.timestamp };
}
