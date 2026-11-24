import { db as defaultDb } from "../db/db.js";
import { HIDE_AMOUNTS_PREFERENCE } from "../db/preferences.js";
import { getFinancialTransactions, isSaleRecord, splitCountableTransactions, summarizeFinancialTransactions, summarizePosMoney } from "../lib/money.js";
import { getMoneyPeriodRange, getOutstandingDebtPesewas } from "./money.js";
import { getSupplierBalances } from "../utils/suppliers.js";

// Brief 3.11 / wiring screen 33: the numbers behind My money. All amounts are integer pesewas.

export const SHOW_PROFIT_PREFERENCE = "showEstimatedProfit";

const AVERAGE_WEEKS = 4;

function expenseAmountPesewas(transaction) {
  const amount = transaction.amountPesewas ?? transaction.total_amount;
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError(`Expense ${transaction.id ?? "(unknown)"} has an invalid pesewa amount.`);
  }
  return amount;
}

/**
 * Money in, Money spent (split into Stock and Other), Money left and the estimated profit for the
 * transactions of one period. Stock and Other come from the Spent money categories: a supplier
 * payment pays for stock bought earlier, so it is Stock. Profit is Sales − stock bought − other
 * costs, where a credit sale counts once, when it is sold, and stock bought counts the whole
 * purchase (paid or still owed). Money spent is cash out, so on a stock purchase made on credit the
 * two differ until the supplier is paid.
 */
export function summarizeMyMoney(transactions) {
  return summarizeMyMoneyChecked(transactions).summary;
}

/**
 * The same figures, and the records that were left out because their amounts do not match (see
 * splitCountableTransactions). A bad record never throws out of the screen: it is not counted, it is
 * logged with its id, and the caller says so.
 */
export function summarizeMyMoneyChecked(allTransactions) {
  const { countable: transactions, skipped } = splitCountableTransactions(allTransactions);
  // The one shared core (22, 24 and 33 read the same rows through it).
  const core = summarizeFinancialTransactions(transactions);
  const totals = summarizePosMoney(transactions);
  const isReversal = (transaction) => transaction.type === "income_reversal";
  const stockOut = summarizePosMoney(transactions.filter((transaction) => isReversal(transaction) ||
    transaction.type === "supplier_payment" ||
    (transaction.type === "expense" && transaction.category === "stock")));
  const otherOut = summarizePosMoney(transactions.filter((transaction) => isReversal(transaction) ||
    (transaction.type === "expense" && transaction.category !== "stock")));

  const reversedIds = new Set(transactions.filter(isReversal).map((transaction) => transaction.reversalOfTransactionId).filter(Boolean));
  let stockBought = 0;
  let otherCosts = 0;
  for (const transaction of transactions) {
    if (transaction.type !== "expense" || reversedIds.has(transaction.id)) continue;
    const amount = expenseAmountPesewas(transaction);
    if (transaction.category === "stock") stockBought += amount;
    else otherCosts += amount;
  }
  const profit = totals.sales - stockBought - otherCosts;
  // What you should have left (wiring 33): cash in minus cash spent, MoMo in minus MoMo spent, this
  // period only. With spending whose method was not recorded: cash + MoMo − that = Money left.
  const cashShouldHave = core.cashReceived - core.spentCash;
  const momoShouldHave = core.momoReceived - core.spentMomo;
  if (![stockBought, otherCosts, profit, cashShouldHave, momoShouldHave].every(Number.isSafeInteger)) {
    throw new RangeError("A My money total exceeds the safe integer range.");
  }
  return {
    summary: {
      moneyIn: totals.moneyIn,
      cashIn: totals.cashIn,
      momoIn: totals.momoIn,
      // Money in that came from customers paying what they owed (not a sale).
      collectedIn: core.debtPaymentsCollected,
      // The owed part of sales plus Added to debt: the Given on credit figure of 24.
      givenOnCredit: core.creditGiven,
      moneySpent: totals.moneySpent,
      spentCash: core.spentCash,
      spentMomo: core.spentMomo,
      spentUnrecorded: core.spentUnrecorded,
      cashShouldHave,
      momoShouldHave,
      spentStock: stockOut.moneySpent,
      spentOther: otherOut.moneySpent,
      moneyLeft: totals.cashLeft,
      sales: totals.sales,
      stockBought,
      otherCosts,
      profit
    },
    skipped
  };
}

export function buildMyMoneyReport({ currentTransactions, debts, allTransactions, suppliers, showProfit, averageProfitPesewas = null }) {
  const { summary, skipped: skippedNow } = summarizeMyMoneyChecked(currentTransactions);
  // What is left out of the figures shown (this period only).
  const skipped = skippedNow;
  const uncounted = {
    sales: skipped.filter((record) => isSaleRecord(record)).length,
    other: skipped.filter((record) => !isSaleRecord(record)).length
  };
  return {
    summary,
    uncounted,
    showProfit: showProfit !== false,
    averageProfitPesewas,
    debtPesewas: getOutstandingDebtPesewas(debts),
    supplierBalancePesewas: getSupplierBalances(allTransactions, suppliers)
      .reduce((sum, supplier) => sum + supplier.balancePesewas, 0)
  };
}

/**
 * The average estimated profit of the four weeks before the current week, or null while there is
 * less than four weeks of data (the oldest record must be from the Monday of the first of those four
 * weeks, or older). A quiet week inside the span counts as zero.
 */
/**
 * Everything the My money screen shows for today, a week or a month, read from the database. `now` is a
 * parameter so the first week of a month, the year start and the days the clock changes can be tested.
 */
export async function loadMyMoneyReport({ period, now = new Date(), database = defaultDb }) {
  const current = getMoneyPeriodRange(period, now);
  // rules_global.hide_amounts: the setting is read with the figures, so 33 never shows them before it is known.
  const [currentTransactions, debts, allTransactions, suppliers, profitSetting, hideSetting] = await Promise.all([
    getFinancialTransactions(current, database),
    database.debts.where("status").equals("unpaid").toArray(),
    database.transactions.toArray(),
    database.suppliers.toArray(),
    database.settings.get(SHOW_PROFIT_PREFERENCE),
    database.settings.get(HIDE_AMOUNTS_PREFERENCE)
  ]);
  const showProfit = profitSetting?.value !== false;
  const averageProfitPesewas = showProfit && period === "week" ? await loadAverageWeeklyProfit(current, database) : null;
  return { ...buildMyMoneyReport({ currentTransactions, debts, allTransactions, suppliers, showProfit, averageProfitPesewas }), hideAmounts: hideSetting?.value === true };
}

export async function loadAverageWeeklyProfit(currentRange, database = defaultDb) {
  const oldest = await database.transactions.orderBy("createdAt").first();
  const oldestAt = oldest?.createdAt ?? oldest?.timestamp;
  if (!Number.isFinite(oldestAt)) return null;
  const weeks = [];
  let end = currentRange.start;
  for (let index = 0; index < AVERAGE_WEEKS; index += 1) {
    const start = new Date(end);
    start.setDate(start.getDate() - 7);
    weeks.push({ start: start.getTime(), end });
    end = start.getTime();
  }
  // Four weeks of data: the oldest record is from the first day (Monday) of the earliest of the four weeks, or older.
  const firstDayEnd = new Date(weeks[weeks.length - 1].start);
  firstDayEnd.setDate(firstDayEnd.getDate() + 1);
  if (oldestAt >= firstDayEnd.getTime()) return null;
  const profits = await Promise.all(weeks.map(async (range) => summarizeMyMoney(await getFinancialTransactions(range, database)).profit));
  const total = profits.reduce((sum, profit) => sum + profit, 0);
  return Math.round(total / AVERAGE_WEEKS);
}
