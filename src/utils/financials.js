import { db as defaultDb } from "../db/db.js";

function startOfDay(date) {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

/**
 * Return an inclusive-start, exclusive-end range for a reporting period.
 * The week starts on Monday and all boundaries use the device's local time.
 */
export function getFinancialDateRange(period, customStart, customEnd, now = new Date()) {
  if (period === "week") {
    const start = startOfDay(now);
    const daysSinceMonday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - daysSinceMonday);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start: start.getTime(), end: end.getTime() };
  }

  if (period === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { start: start.getTime(), end: end.getTime() };
  }

  if (period !== "custom" || !customStart || !customEnd) return null;
  const startDate = new Date(`${customStart}T00:00:00`);
  const endDate = new Date(`${customEnd}T00:00:00`);
  if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime()) || startDate > endDate) {
    return null;
  }
  endDate.setDate(endDate.getDate() + 1);
  return { start: startDate.getTime(), end: endDate.getTime() };
}

function amountInPesewas(transaction) {
  const amount = transaction.amountPesewas ?? transaction.total_amount ?? 0;
  return Number.isSafeInteger(amount) && amount > 0 ? amount : 0;
}

function isDebtPayment(transaction) {
  return transaction.type === "debt_payment" ||
    (transaction.type === "income" && transaction.note?.startsWith("Debt payment"));
}

function isCreditSale(transaction) {
  return transaction.type === "credit_sale" ||
    (transaction.type === "sale" && transaction.paymentType === "credit");
}

function isDirectCashSale(transaction) {
  return transaction.type === "cash_sale" ||
    (transaction.type === "sale" && transaction.paymentType !== "credit");
}

function getPaymentMethod(transaction) {
  const method = transaction.payment_method ?? transaction.paymentType;
  return method === "momo" || method === "telecel_cash" ? "momo" : "cash";
}

/**
 * Aggregate app transaction records into cash-based and accrued report totals.
 * All returned amounts are integer pesewas.
 * Accrued profit is modeled as cash profit plus new credit extended in-period.
 */
export function summarizeFinancialTransactions(transactions) {
  const totals = {
    directCashSales: 0,
    debtPaymentsCollected: 0,
    cashInflow: 0,
    cashReceived: 0,
    momoReceived: 0,
    expenses: 0,
    realCashProfit: 0,
    newCreditExtended: 0,
    accruedProfit: 0
  };

  for (const transaction of transactions) {
    const amount = amountInPesewas(transaction);
    if (transaction.type === "expense") totals.expenses += amount;
    else if (isDebtPayment(transaction)) {
      totals.debtPaymentsCollected += amount;
      totals[getPaymentMethod(transaction) === "momo" ? "momoReceived" : "cashReceived"] += amount;
    }
    else if (isCreditSale(transaction)) totals.newCreditExtended += amount;
    else if (isDirectCashSale(transaction)) {
      totals.directCashSales += amount;
      totals[getPaymentMethod(transaction) === "momo" ? "momoReceived" : "cashReceived"] += amount;
    }
  }

  totals.cashInflow = totals.cashReceived + totals.momoReceived;
  totals.realCashProfit = totals.cashInflow - totals.expenses;
  totals.accruedProfit = totals.realCashProfit + totals.newCreditExtended;
  return totals;
}

/**
 * Load and summarize transactions within an inclusive-start, exclusive-end range.
 * Dexie's IndexedDB query keeps the report available offline.
 */
export async function getFinancialSummary(range, database = defaultDb) {
  if (!range || !Number.isFinite(range.start) || !Number.isFinite(range.end) || range.end <= range.start) {
    throw new TypeError("A valid financial reporting date range is required.");
  }

  const transactions = await database.transactions
    .where("createdAt")
    .between(range.start, range.end, true, false)
    .toArray();
  return summarizeFinancialTransactions(transactions);
}
