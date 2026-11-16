import { db as defaultDb } from "../db/db.js";
import { HIDE_AMOUNTS_PREFERENCE } from "../db/preferences.js";
import { getFinancialTransactions, isSaleRecord, splitCountableTransactions, summarizeFinancialTransactions, summarizePosMoney } from "../lib/money.js";
import { getMoneyPeriodRange, getOutstandingDebtPesewas, getPreviousMoneyPeriodRange } from "./money.js";
import { getSupplierBalances } from "../utils/suppliers.js";

// Brief 3.11 / wiring screen 33: the numbers behind My money. All amounts are integer pesewas.

export const SHOW_PROFIT_PREFERENCE = "showEstimatedProfit";

// A money amount above GH₵1,000,000 cannot be a real week for this shop; it is far more likely a
// typing slip or a unit mistake, so the comparison is not shown for it (wiring rule, screen 33).
export const MAX_PLAUSIBLE_PESEWAS = 100_000_000;

const AVERAGE_WEEKS = 4;

function isPlausible(pesewas) {
  return Number.isSafeInteger(pesewas) && Math.abs(pesewas) <= MAX_PLAUSIBLE_PESEWAS;
}

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

/**
 * The one calm line under Money left: more than, less than, or the same as the period before.
 * Returns null (no line) when there is nothing to compare with, or when a value cannot be real.
 */
export function describeComparison({ currentPesewas, previousPesewas, hasPreviousData }) {
  if (!hasPreviousData) return null;
  if (!isPlausible(currentPesewas) || !isPlausible(previousPesewas)) return null;
  const difference = currentPesewas - previousPesewas;
  if (!isPlausible(difference)) return null;
  if (difference === 0) return { kind: "same", amountPesewas: 0 };
  return { kind: difference > 0 ? "more" : "less", amountPesewas: Math.abs(difference) };
}

export function buildMyMoneyReport({ currentTransactions, previousTransactions, debts, allTransactions, suppliers, showProfit, averageProfitPesewas = null }) {
  const { summary, skipped: skippedNow } = summarizeMyMoneyChecked(currentTransactions);
  const { summary: previous, skipped: skippedBefore } = summarizeMyMoneyChecked(previousTransactions);
  // What is left out of the figures shown, this period and the one it is compared with.
  const skipped = [...skippedNow, ...skippedBefore];
  const uncounted = {
    sales: skipped.filter((record) => isSaleRecord(record)).length,
    other: skipped.filter((record) => !isSaleRecord(record)).length
  };
  const comparison = describeComparison({
    currentPesewas: summary.moneyLeft,
    previousPesewas: previous.moneyLeft,
    hasPreviousData: previousTransactions.some((transaction) => transaction.type !== "income_reversal")
  });
  if (!comparison && previousTransactions.length > 0 && (!isPlausible(summary.moneyLeft) || !isPlausible(previous.moneyLeft))) {
    console.warn("My money: a total is above one million cedis, so the comparison is hidden. Check the amounts that were entered.", {
      current: summary.moneyLeft,
      previous: previous.moneyLeft
    });
  }
  return {
    summary,
    comparison,
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
  const previous = getPreviousMoneyPeriodRange(period, now);
  // rules_global.hide_amounts: the setting is read with the figures, so 33 never shows them before it is known.
  const [currentTransactions, previousTransactions, debts, allTransactions, suppliers, profitSetting, hideSetting] = await Promise.all([
    getFinancialTransactions(current, database),
    getFinancialTransactions(previous, database),
    database.debts.where("status").equals("unpaid").toArray(),
    database.transactions.toArray(),
    database.suppliers.toArray(),
    database.settings.get(SHOW_PROFIT_PREFERENCE),
    database.settings.get(HIDE_AMOUNTS_PREFERENCE)
  ]);
  const showProfit = profitSetting?.value !== false;
  const averageProfitPesewas = showProfit && period === "week" ? await loadAverageWeeklyProfit(current, database) : null;
  return { ...buildMyMoneyReport({ currentTransactions, previousTransactions, debts, allTransactions, suppliers, showProfit, averageProfitPesewas }), hideAmounts: hideSetting?.value === true };
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
