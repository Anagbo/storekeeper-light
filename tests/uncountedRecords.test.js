import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { getFinancialSummary, summarizeFinancialTransactions, summarizeFinancialTransactionsSafely, summarizePosMoney, summarizePosMoneySafely } from "../src/lib/money.js";
import { posText } from "../src/pos/i18n.js";
import { loadMyMoneyReport, summarizeMyMoney } from "../src/pos/myMoneyReport.js";
import { loadJsx, render, setLiveQuery, textOf } from "./helpers/renderJsx.js";

// One inconsistent record must never stop a money screen. The real case: a credit sale of GH₵120.00
// written by an older version of the app, with GH₵100.00 stored as credit and no cash part
// (the GH₵20.00 first payment was saved as a separate income record). Its parts do not add up, so
// the strict check threw "Credit sale cash and credit parts do not match the recorded sale amount"
// and the whole of My money failed to load. Now the sale is left out of the totals, logged with its
// id, and counted on screen 33. The strict check stays for saving a new sale.
const DAY = 86400000;
const BAD_ID = "cba3849a-e73f-4b54-b7fd-f7f9e7305708";

function badCreditSale(createdAt = Date.now() - DAY) {
  return {
    id: BAD_ID, type: "sale", paymentType: "credit", payment_method: null,
    amountPesewas: 12000, total_amount: 12000, creditExtendedPesewas: 10000,
    note: "Debt added", createdAt, timestamp: createdAt, updatedAt: createdAt, items_json: "[]"
  };
}
function normal(id, createdAt, extra = {}) {
  return { id, type: "sale", amountPesewas: 5000, total_amount: 5000, paymentType: "cash", cashReceivedPesewas: 5000, momoReceivedPesewas: 0, createdAt, timestamp: createdAt, updatedAt: createdAt, items_json: "[]", ...extra };
}

function captureWarnings() {
  const calls = [];
  const original = console.warn;
  console.warn = (...args) => calls.push(args.map(String).join(" "));
  return { calls, restore: () => { console.warn = original; } };
}

beforeEach(async () => {
  await Promise.all(["transactions", "debts", "suppliers", "settings", "customers", "payments"].map((name) => db.table(name).clear()));
});

// ---- the summaries -----------------------------------------------------------------------------

test("the strict check still refuses the record (it guards saving and the consistency check)", () => {
  assert.throws(() => summarizeFinancialTransactions([badCreditSale()]), /do not match the recorded sale amount/);
  assert.throws(() => summarizePosMoney([badCreditSale()]), /do not match the recorded sale amount/);
});

test("the safe summary leaves the bad sale out of the totals, names it, and warns with its id", () => {
  const warnings = captureWarnings();
  try {
    const { totals, skipped } = summarizeFinancialTransactionsSafely([normal("n1", 1), badCreditSale(2), normal("n2", 3, { amountPesewas: 3000, total_amount: 3000, cashReceivedPesewas: 0, momoReceivedPesewas: 3000, payment_method: "momo" })]);
    assert.equal(totals.totalSales, 8000, "the bad sale is not in the sales");
    assert.equal(totals.newCreditExtended, 0, "its credit is not counted either");
    assert.equal(totals.cashInflow, 8000);
    assert.deepEqual(skipped.map((record) => record.id), [BAD_ID]);
    assert.match(skipped[0].message, /do not match the recorded sale amount/);
    const pos = summarizePosMoneySafely([normal("n1", 1), badCreditSale(2)]);
    assert.deepEqual(pos.totals, { moneyIn: 5000, cashIn: 5000, momoIn: 0, moneySpent: 0, cashLeft: 5000, sales: 5000 });
    assert.deepEqual(pos.skipped.map((record) => record.id), [BAD_ID]);
  } finally {
    warnings.restore();
  }
  assert.ok(warnings.calls.some((line) => line.includes(BAD_ID)), "the console warning has the sale id");
});

test("nothing is skipped, and nothing warns, when every record is fine", () => {
  const warnings = captureWarnings();
  try {
    const { totals, skipped } = summarizeFinancialTransactionsSafely([normal("n1", 1)]);
    assert.equal(totals.totalSales, 5000);
    assert.deepEqual(skipped, []);
  } finally {
    warnings.restore();
  }
  assert.deepEqual(warnings.calls, []);
});

test("a bad sale that was reversed is not flagged (the strict check already ignores it)", () => {
  const { skipped, totals } = summarizeFinancialTransactionsSafely([normal("n1", 1), badCreditSale(2), { id: "rev", type: "income_reversal", reversalOfTransactionId: BAD_ID, amountPesewas: 12000, createdAt: 3 }]);
  assert.deepEqual(skipped, []);
  assert.equal(totals.totalSales, 5000);
});

test("other malformed records are left out too, and counted (an amount that is not whole pesewas)", () => {
  const warnings = captureWarnings();
  try {
    const { totals, skipped } = summarizeFinancialTransactionsSafely([normal("n1", 1), { id: "odd", type: "expense", amountPesewas: 2.5, createdAt: 2 }]);
    assert.equal(totals.expenses, 0);
    assert.deepEqual(skipped.map((record) => [record.id, record.type]), [["odd", "expense"]]);
  } finally {
    warnings.restore();
  }
});

// ---- My money (33) -----------------------------------------------------------------------------

test("33: a month with one bad credit sale plus normal sales loads; totals exclude it; the report counts it", async () => {
  const now = new Date();
  const at = (days) => now.getTime() - days * DAY * 0.01; // all inside this month and this week
  await db.transactions.bulkPut([normal("n1", at(1)), normal("n2", at(2), { amountPesewas: 3000, total_amount: 3000, cashReceivedPesewas: 0, momoReceivedPesewas: 3000, payment_method: "momo" }), badCreditSale(at(3))]);
  const warnings = captureWarnings();
  let report;
  try {
    report = await loadMyMoneyReport({ period: "month", now });
  } finally {
    warnings.restore();
  }
  assert.equal(report.summary.sales, 8000);
  assert.equal(report.summary.moneyIn, 8000);
  assert.equal(report.summary.profit, 8000);
  assert.deepEqual(report.uncounted, { sales: 1, other: 0 });
  assert.ok(warnings.calls.some((line) => line.includes(BAD_ID)), "the warning has the sale id");
});

test("33: the real case, the bad sale is in the month before: This month still loads and says so", async () => {
  const now = new Date(2026, 10, 10, 12);
  await db.transactions.bulkPut([normal("this", new Date(2026, 10, 9, 10).getTime()), { ...badCreditSale(new Date(2026, 9, 25, 13).getTime()) }, normal("last", new Date(2026, 9, 20, 10).getTime(), { amountPesewas: 2000, total_amount: 2000, cashReceivedPesewas: 2000 })]);
  const warnings = captureWarnings();
  let report;
  try {
    report = await loadMyMoneyReport({ period: "month", now });
  } finally {
    warnings.restore();
  }
  assert.equal(report.summary.sales, 5000);
  assert.deepEqual(report.uncounted, { sales: 1, other: 0 });
  assert.deepEqual(report.comparison, { kind: "more", amountPesewas: 3000 }, "last month is compared without the bad sale");
  const week = await loadMyMoneyReport({ period: "week", now });
  assert.deepEqual(week.uncounted, { sales: 0, other: 0 }, "a week that does not touch the bad sale says nothing");
});

test("33: a month with no bad record counts nothing", async () => {
  await db.transactions.put(normal("n1", Date.now() - 1000));
  const report = await loadMyMoneyReport({ period: "month", now: new Date() });
  assert.deepEqual(report.uncounted, { sales: 0, other: 0 });
});

test("33: summarizeMyMoney no longer throws for the bad sale", () => {
  const warnings = captureWarnings();
  try {
    const summary = summarizeMyMoney([normal("n1", 1), badCreditSale(2)]);
    assert.equal(summary.sales, 5000);
  } finally {
    warnings.restore();
  }
});

async function mountMyMoney(report) {
  const { default: MyMoney } = await loadJsx("src/pos/MyMoney.jsx");
  setLiveQuery(() => report);
  const view = render({ type: MyMoney, props: { onNavigate() {} } });
  setLiveQuery(null);
  return view;
}
function baseReport(uncounted) {
  return {
    summary: { moneyIn: 8000, cashIn: 5000, momoIn: 3000, moneySpent: 0, spentStock: 0, spentOther: 0, moneyLeft: 8000, sales: 8000, stockBought: 0, otherCosts: 0, profit: 8000 },
    comparison: null, showProfit: true, averageProfitPesewas: null, debtPesewas: 0, supplierBalancePesewas: 0, uncounted
  };
}

test("33: shows one quiet line for one bad sale, and the plural for more", async () => {
  const one = textOf((await mountMyMoney(baseReport({ sales: 1, other: 0 }))).tree);
  assert.ok(one.includes("1 sale is not counted because its amounts do not match."));
  const many = textOf((await mountMyMoney(baseReport({ sales: 3, other: 0 }))).tree);
  assert.ok(many.includes("3 sales are not counted because their amounts do not match."));
  assert.doesNotMatch(many, /1 sale is not counted/);
});

test("33: no line when nothing is left out, and a line for other records that are left out", async () => {
  for (const uncounted of [{ sales: 0, other: 0 }, undefined]) {
    assert.doesNotMatch(textOf((await mountMyMoney(baseReport(uncounted))).tree), /not counted/);
  }
  const other = textOf((await mountMyMoney(baseReport({ sales: 0, other: 2 }))).tree);
  assert.ok(other.includes("2 records are not counted because their amounts do not match."));
});

test("33: the strings are in the strings file", () => {
  assert.equal(posText("money.uncountedSale"), "1 sale is not counted because its amounts do not match.");
  assert.equal(posText("money.uncountedSales", { n: 2 }), "2 sales are not counted because their amounts do not match.");
});

// ---- every other caller ------------------------------------------------------------------------

test("22 Home: Money left today loads with a bad sale today and leaves it out", async () => {
  await db.transactions.bulkPut([normal("n1", Date.now() - 1000), badCreditSale(Date.now() - 2000)]);
  const { default: Home } = await loadJsx("src/pos/Home.jsx");
  let query = null;
  setLiveQuery((_deps, run) => { query = run; return null; });
  render({ type: Home, props: { onNavigate() {} } });
  setLiveQuery(null);
  const warnings = captureWarnings();
  let data;
  try {
    data = await query();
  } finally {
    warnings.restore();
  }
  assert.equal(data.totals.moneyIn, 5000);
  assert.equal(data.totals.sales, 5000);
  assert.ok(warnings.calls.some((line) => line.includes(BAD_ID)));
});

test("24 Today's transactions: the totals load with a bad sale today", async () => {
  await db.transactions.bulkPut([normal("n1", Date.now() - 1000), badCreditSale(Date.now() - 2000)]);
  const { default: TodaysTransactions } = await loadJsx("src/pos/TodaysTransactions.jsx");
  let query = null;
  setLiveQuery((_deps, run) => { query = run; return undefined; });
  render({ type: TodaysTransactions, props: { onBack() {}, onNavigate() {} } });
  setLiveQuery(null);
  const warnings = captureWarnings();
  let data;
  try {
    data = await query();
  } finally {
    warnings.restore();
  }
  assert.equal(data.status, "ready");
  assert.equal(data.totals.totalSales, 5000);
});

test("the report totals used by the old dashboard and the summary pop-up load too", async () => {
  await db.transactions.bulkPut([normal("n1", Date.now() - 1000), badCreditSale(Date.now() - 2000)]);
  const warnings = captureWarnings();
  try {
    const totals = await getFinancialSummary({ start: Date.now() - DAY, end: Date.now() + DAY });
    assert.equal(totals.totalSales, 5000);
  } finally {
    warnings.restore();
  }
});
