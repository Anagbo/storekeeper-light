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
  if (period === "day") {
    const start = startOfDay(now);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start: start.getTime(), end: end.getTime() };
  }

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

export function getPreviousFinancialDateRange(period, now = new Date()) {
  const current = getFinancialDateRange(period, "", "", now);
  if (!current) throw new TypeError("Choose a day, week, or month reporting period.");
  if (period === "month") {
    const previousStart = new Date(current.start);
    previousStart.setMonth(previousStart.getMonth() - 1);
    return { start: previousStart.getTime(), end: current.start };
  }
  const duration = current.end - current.start;
  return { start: current.start - duration, end: current.start };
}

function amountInPesewas(transaction) {
  const amount = transaction.amountPesewas ?? transaction.total_amount;
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError(`Transaction ${transaction.id ?? "(unknown)"} has an invalid pesewa amount.`);
  }
  return amount;
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

function addTotal(totals, field, amount) {
  const value = totals[field] + amount;
  if (!Number.isSafeInteger(value)) throw new RangeError(`The ${field} total exceeds the safe integer range.`);
  totals[field] = value;
}

function optionalAmount(value, fallback, description) {
  const amount = value ?? fallback;
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError(`${description} must be a non-negative integer number of pesewas.`);
  }
  return amount;
}

export function getDebtBalancePesewas(debt) {
  const amount = debt.amountPesewas ?? debt.total_owed;
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError(`Debt ${debt.id ?? "(unknown)"} has an invalid pesewa balance.`);
  }
  return amount;
}

export function getOutstandingDebtPesewas(debts) {
  return debts.reduce((sum, debt) => {
    if (debt.status !== "unpaid") return sum;
    const amount = getDebtBalancePesewas(debt);
    const next = sum + amount;
    if (!Number.isSafeInteger(next)) throw new RangeError("Outstanding debt total exceeds the safe integer range.");
    return next;
  }, 0);
}

function validateSaleParts(amount, cashReceived, creditExtended, description) {
  const total = cashReceived + creditExtended;
  if (!Number.isSafeInteger(total) || total !== amount) {
    throw new RangeError(`${description} cash and credit parts do not match the recorded sale amount.`);
  }
}

/**
 * Aggregate app transaction records into cash-based and accrued report totals.
 * All returned amounts are integer pesewas.
 * Accrued profit is modeled as cash profit plus new credit extended in-period.
 */
export function summarizeFinancialTransactions(transactions) {
  const reversedTransactionIds = new Set(
    transactions
      .filter((transaction) => transaction.type === "income_reversal")
      .map((transaction) => transaction.reversalOfTransactionId)
      .filter(Boolean)
  );
  const reversedCollectionIds = new Set(
    transactions
      .filter((transaction) => transaction.type === "income_reversal")
      .map((transaction) => transaction.reversalOfCollectionId)
      .filter(Boolean)
  );
  const totals = {
    directCashSales: 0,
    debtPaymentsCollected: 0,
    cashInflow: 0,
    cashReceived: 0,
    momoReceived: 0,
    expenses: 0,
    totalSales: 0,
    realCashProfit: 0,
    newCreditExtended: 0,
    manualDebtAdded: 0,
    creditGiven: 0,
    accruedProfit: 0
  };

  for (const transaction of transactions) {
    if (
      reversedTransactionIds.has(transaction.id) ||
      reversedCollectionIds.has(transaction.collectionId) ||
      transaction.type === "income_reversal"
    ) continue;
    const amount = amountInPesewas(transaction);
    if (transaction.type === "expense") {
      addTotal(totals, "expenses", optionalAmount(transaction.paidAmountPesewas, amount, "Expense payment"));
    }
    else if (transaction.type === "supplier_payment") {
      addTotal(totals, "expenses", amount);
    }
    else if (transaction.type === "manual_debt") {
      // "Added to debt": credit given with no sale. Not profit, so it stays out of newCreditExtended.
      addTotal(totals, "manualDebtAdded", optionalAmount(transaction.creditExtendedPesewas, amount, "Added to debt"));
    }
    else if (isDebtPayment(transaction)) {
      addTotal(totals, "debtPaymentsCollected", amount);
      addTotal(totals, getPaymentMethod(transaction) === "momo" ? "momoReceived" : "cashReceived", amount);
    }
    else if (transaction.type === "installment_sale" || transaction.type === "installment_addon") {
      const legacyPayment = optionalAmount(transaction.installmentPaymentPesewas, 0, "Installment payment");
      const legacyIsMomo = transaction.payment_method === "momo" || transaction.payment_method === "telecel_cash";
      const cashReceived = optionalAmount(
        transaction.cashReceivedPesewas,
        legacyIsMomo ? 0 : legacyPayment,
        "Installment cash payment"
      );
      const momoReceived = optionalAmount(
        transaction.momoReceivedPesewas,
        legacyIsMomo ? legacyPayment : 0,
        "Installment MoMo payment"
      );
      const salePayment = cashReceived + momoReceived;
      if (!Number.isSafeInteger(salePayment)) throw new RangeError("Installment payment exceeds the supported amount.");
      const creditExtended = optionalAmount(transaction.creditExtendedPesewas, Math.max(0, amount - salePayment), "Installment credit");
      validateSaleParts(amount, salePayment, creditExtended, "Installment");
      if (cashReceived > 0) {
        addTotal(totals, "directCashSales", cashReceived);
        addTotal(totals, "cashReceived", cashReceived);
      }
      if (momoReceived > 0) {
        addTotal(totals, "directCashSales", momoReceived);
        addTotal(totals, "momoReceived", momoReceived);
      }
      addTotal(totals, "newCreditExtended", creditExtended);
      addTotal(totals, "totalSales", amount);
    }
    else if (isCreditSale(transaction)) {
      const cashReceived = optionalAmount(transaction.cashReceivedPesewas, 0, "Credit sale payment");
      const creditExtended = optionalAmount(transaction.creditExtendedPesewas, Math.max(0, amount - cashReceived), "Credit extended");
      validateSaleParts(amount, cashReceived, creditExtended, "Credit sale");
      if (cashReceived > 0) {
        addTotal(totals, "directCashSales", cashReceived);
        addTotal(totals, getPaymentMethod(transaction) === "momo" ? "momoReceived" : "cashReceived", cashReceived);
      }
      addTotal(totals, "newCreditExtended", creditExtended);
      addTotal(totals, "totalSales", amount);
    }
    else if (isDirectCashSale(transaction)) {
      addTotal(totals, "directCashSales", amount);
      if (transaction.cashReceivedPesewas !== undefined || transaction.momoReceivedPesewas !== undefined) {
        const cashReceived = optionalAmount(transaction.cashReceivedPesewas, 0, "Sale cash payment");
        const momoReceived = optionalAmount(transaction.momoReceivedPesewas, 0, "Sale MoMo payment");
        validateSaleParts(amount, cashReceived + momoReceived, 0, "Sale");
        addTotal(totals, "cashReceived", cashReceived);
        addTotal(totals, "momoReceived", momoReceived);
      } else {
        addTotal(totals, getPaymentMethod(transaction) === "momo" ? "momoReceived" : "cashReceived", amount);
      }
      addTotal(totals, "totalSales", amount);
    }
  }

  // Screen 24 "Given on credit": the owed part of sales plus Added to debt rows. Payments,
  // corrections and stock bought on credit are not part of it.
  totals.creditGiven = totals.newCreditExtended + totals.manualDebtAdded;
  totals.cashInflow = totals.cashReceived + totals.momoReceived;
  totals.realCashProfit = totals.cashInflow - totals.expenses;
  totals.accruedProfit = totals.realCashProfit + totals.newCreditExtended;
  if (![totals.cashInflow, totals.realCashProfit, totals.accruedProfit, totals.creditGiven].every(Number.isSafeInteger)) {
    throw new RangeError("A financial report total exceeds the safe integer range.");
  }
  return totals;
}

function toPosMoney(totals) {
  return {
    moneyIn: totals.cashInflow,
    cashIn: totals.cashReceived,
    momoIn: totals.momoReceived,
    moneySpent: totals.expenses,
    cashLeft: totals.realCashProfit,
    sales: totals.totalSales
  };
}

export function summarizePosMoney(transactions) {
  return toPosMoney(summarizeFinancialTransactions(transactions));
}

const SALE_TYPES = new Set(["sale", "cash_sale", "credit_sale", "installment_sale", "installment_addon"]);

export function isSaleRecord(record) {
  return SALE_TYPES.has(record?.type);
}

/**
 * Reading old records. The strict summary above refuses a record whose parts do not add up (it guards
 * saving a new sale and the consistency check). A screen that only reads must not fail because of one
 * bad record that an older version of the app saved. This splits the records into the ones that can be
 * counted and the ones that cannot. Nothing is changed or reclassified: a record left out is named
 * (id, type and the message) and logged to the console with its id, so the screen can say so.
 * Problems that are not about one record (a total out of range) are still thrown.
 */
export function splitCountableTransactions(transactions, { warn = true } = {}) {
  try {
    summarizeFinancialTransactions(transactions);
    return { countable: transactions, skipped: [] };
  } catch (error) {
    const reversals = transactions.filter((record) => record.type === "income_reversal");
    const countable = [];
    const skipped = [];
    for (const record of transactions) {
      if (record.type === "income_reversal") {
        countable.push(record);
        continue;
      }
      try {
        // With the reversals, so a bad record that was reversed is not flagged.
        summarizeFinancialTransactions([record, ...reversals]);
        countable.push(record);
      } catch (recordError) {
        skipped.push({
          id: record.id,
          type: record.type,
          message: recordError.message,
          amountPesewas: record.amountPesewas ?? record.total_amount,
          cashReceivedPesewas: record.cashReceivedPesewas,
          creditExtendedPesewas: record.creditExtendedPesewas
        });
      }
    }
    if (skipped.length === 0) throw error;
    if (warn) {
      for (const record of skipped) {
        console.warn(`A record is not counted in the money totals: ${record.id} (${record.type}). ${record.message}`, {
          amountPesewas: record.amountPesewas,
          cashReceivedPesewas: record.cashReceivedPesewas,
          creditExtendedPesewas: record.creditExtendedPesewas
        });
      }
    }
    return { countable, skipped };
  }
}

export function summarizeFinancialTransactionsSafely(transactions, options) {
  const { countable, skipped } = splitCountableTransactions(transactions, options);
  return { totals: summarizeFinancialTransactions(countable), skipped };
}

export function summarizePosMoneySafely(transactions, options) {
  const { totals, skipped } = summarizeFinancialTransactionsSafely(transactions, options);
  return { totals: toPosMoney(totals), skipped };
}

export async function getFinancialTransactions(range, database = defaultDb) {
  if (!range || !Number.isFinite(range.start) || !Number.isFinite(range.end) || range.end <= range.start) {
    throw new TypeError("A valid financial reporting date range is required.");
  }
  const [periodTransactions, reversalTransactions] = await Promise.all([
    database.transactions
      .where("createdAt")
      .between(range.start, range.end, true, false)
      .toArray(),
    database.transactions.where("type").equals("income_reversal").toArray()
  ]);
  return [...new Map(
    [...periodTransactions, ...reversalTransactions].map((transaction) => [transaction.id, transaction])
  ).values()];
}

/**
 * Load and summarize transactions within an inclusive-start, exclusive-end range.
 * Dexie's IndexedDB query keeps the report available offline.
 */
export async function getFinancialSummary(range, database = defaultDb) {
  const transactions = await getFinancialTransactions(range, database);
  return summarizeFinancialTransactionsSafely(transactions).totals;
}
