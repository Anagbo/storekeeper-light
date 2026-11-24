import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { getPreference } from "../src/db/preferences.js";
import { formatGhs } from "../src/lib/money.js";
import { posText } from "../src/pos/i18n.js";
import {
  MAX_PLAUSIBLE_PESEWAS,
  SHOW_PROFIT_PREFERENCE,
  buildMyMoneyReport,
  describeComparison,
  loadAverageWeeklyProfit,
  summarizeMyMoney
} from "../src/pos/myMoneyReport.js";
import { findButton, loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";
import { waitFor } from "./helpers/waitFor.js";

// Brief 3.11 and wiring screen 33: a calmer My money with Money left, Money in / Money spent with
// breakdowns, an Estimated profit card (Sales − stock − other costs), two white debt tiles.
const tick = () => new Promise((resolve) => setImmediate(resolve));

// A known set: sales 35000 (cash 20000, MoMo 5000, credit 10000 with 2000 paid), a debt payment
// that is not a sale, stock 15000 paid + stock 6000 bought with 1000 paid, transport 3000, and a
// supplier payment of 2000 that pays the credit stock.
const KNOWN = [
  { id: "s1", type: "sale", amountPesewas: 20000, paymentType: "cash" },
  { id: "s2", type: "sale", amountPesewas: 5000, payment_method: "momo" },
  { id: "s3", type: "sale", amountPesewas: 10000, paymentType: "credit", cashReceivedPesewas: 2000 },
  { id: "p1", type: "debt_payment", amountPesewas: 3000, payment_method: "cash" },
  { id: "e1", type: "expense", category: "stock", amountPesewas: 15000, paidAmountPesewas: 15000 },
  { id: "e2", type: "expense", category: "stock", amountPesewas: 6000, paidAmountPesewas: 1000, owedAmountPesewas: 5000 },
  { id: "e3", type: "expense", category: "transport", amountPesewas: 3000, paidAmountPesewas: 3000 },
  { id: "sp1", type: "supplier_payment", amountPesewas: 2000 }
];

// ---- the numbers ---------------------------------------------------------------------------

test("3.11: estimated profit is Sales − stock − other costs for a known set of transactions", () => {
  const summary = summarizeMyMoney(KNOWN);
  assert.equal(summary.sales, 35000);
  assert.equal(summary.stockBought, 21000, "stock bought counts the whole purchase, paid or owed");
  assert.equal(summary.otherCosts, 3000);
  assert.equal(summary.profit, 35000 - 21000 - 3000);
  assert.equal(summary.profit, 11000);
});

test("3.11: Money in, Money spent and Money left keep the existing ledger; Stock and Other add up to Money spent", () => {
  const summary = summarizeMyMoney(KNOWN);
  assert.equal(summary.moneyIn, 30000);
  assert.equal(summary.cashIn, 25000);
  assert.equal(summary.momoIn, 5000);
  assert.equal(summary.moneySpent, 21000);
  assert.equal(summary.spentStock, 18000, "stock paid, plus the supplier payment");
  assert.equal(summary.spentOther, 3000);
  assert.equal(summary.spentStock + summary.spentOther, summary.moneySpent);
  assert.equal(summary.moneyLeft, summary.moneyIn - summary.moneySpent);
});

test("3.11: a reversed expense is not counted as a cost", () => {
  const summary = summarizeMyMoney([
    { id: "s", type: "sale", amountPesewas: 9000, paymentType: "cash" },
    { id: "e", type: "expense", category: "stock", amountPesewas: 4000, paidAmountPesewas: 4000 },
    { id: "r", type: "income_reversal", reversalOfTransactionId: "e", amountPesewas: 4000 }
  ]);
  assert.equal(summary.stockBought, 0);
  assert.equal(summary.spentStock, 0);
  assert.equal(summary.profit, 9000);
});

test("3.11: a credit sale is counted once in the profit (when it is sold), with its payment and later payments left out", async () => {
  await db.transactions.clear();
  await db.debts.clear();
  await recordCreditSale({ amountPesewas: 800, name: "Esi Profit", initialPaymentPesewas: 300, paymentMethod: "cash" });
  const sold = summarizeMyMoney(await db.transactions.toArray());
  assert.equal(sold.sales, 800);
  assert.equal(sold.profit, 800);
  assert.equal(sold.moneyIn, 300);
  // A later payment on the debt is money in, not a second sale.
  const later = summarizeMyMoney([...(await db.transactions.toArray()), { id: "later", type: "debt_payment", amountPesewas: 500, payment_method: "cash" }]);
  assert.equal(later.sales, 800);
  assert.equal(later.profit, 800);
  assert.equal(later.moneyIn, 800);
});

// ---- the comparison --------------------------------------------------------------------------

test("3.11: the comparison says more or less, never up/down or a drop", () => {
  assert.deepEqual(describeComparison({ currentPesewas: 4000, previousPesewas: 2500, hasPreviousData: true }), { kind: "more", amountPesewas: 1500 });
  assert.deepEqual(describeComparison({ currentPesewas: 2500, previousPesewas: 4000, hasPreviousData: true }), { kind: "less", amountPesewas: 1500 });
  assert.deepEqual(describeComparison({ currentPesewas: 2500, previousPesewas: 2500, hasPreviousData: true }), { kind: "same", amountPesewas: 0 });
});

test("3.11: no comparison when the earlier period has no records", () => {
  assert.equal(describeComparison({ currentPesewas: 4000, previousPesewas: 0, hasPreviousData: false }), null);
});

test("3.11: a value that cannot be real is not compared (a possible unit bug)", () => {
  assert.equal(MAX_PLAUSIBLE_PESEWAS, 100_000_000, "GH₵1,000,000");
  // The reported case: this week GH₵1,091.00 against a week of GH₵1,006,209.00.
  assert.equal(describeComparison({ currentPesewas: 109100, previousPesewas: 100620900 + 0, hasPreviousData: true }), null);
  assert.equal(describeComparison({ currentPesewas: 100_000_001, previousPesewas: 5000, hasPreviousData: true }), null);
  assert.equal(describeComparison({ currentPesewas: 5000, previousPesewas: -100_000_001, hasPreviousData: true }), null);
  assert.equal(describeComparison({ currentPesewas: Number.NaN, previousPesewas: 5000, hasPreviousData: true }), null);
  assert.equal(describeComparison({ currentPesewas: 12.5, previousPesewas: 5000, hasPreviousData: true }), null);
  // Exactly GH₵1,000,000 is still shown.
  assert.deepEqual(describeComparison({ currentPesewas: 100_000_000, previousPesewas: 100_000_000 - 7, hasPreviousData: true }), { kind: "more", amountPesewas: 7 });
});

test("3.11: the report built from the reported data hides the comparison instead of showing GH₵1,005,118.00", () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    const report = buildMyMoneyReport({
      currentTransactions: [{ id: "c", type: "sale", amountPesewas: 109100, paymentType: "cash" }],
      previousTransactions: [{ id: "p", type: "sale", amountPesewas: 100620900, paymentType: "cash" }],
      debts: [],
      allTransactions: [],
      suppliers: [],
      showProfit: true
    });
    assert.equal(report.summary.moneyLeft, 109100);
    assert.equal(report.comparison, null);
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(warnings.length >= 1, "the unrealistic value is logged for the owner");
});

// ---- the 4-week average -----------------------------------------------------------------------

const at = (month, day, hour = 10) => new Date(2026, month, day, hour).getTime();
beforeEach(async () => { await db.transactions.clear(); });

// "Now" is Wednesday 11 Nov 2026; this week starts Monday 9 Nov. The four weeks before it start
// 2 Nov, 26 Oct, 19 Oct and 12 Oct.
function weekRange() {
  return { start: at(10, 9, 0), end: at(10, 16, 0) };
}
async function addWeeklySales(days) {
  await db.transactions.bulkAdd(days.map(([month, day], index) => ({
    id: `w${index}`, type: "sale", amountPesewas: 10000, paymentType: "cash", createdAt: at(month, day), timestamp: at(month, day)
  })));
}

test("3.11: the average of the last 4 weeks shows only with at least 4 weeks of data", async () => {
  // Data from 12 Oct (the start of the 4th week back) in each of the four weeks: 10000 each.
  await addWeeklySales([[9, 12], [9, 20], [9, 27], [10, 3]]);
  assert.equal(await loadAverageWeeklyProfit(weekRange()), 10000);
});

test("3.11: with fewer than 4 weeks of data there is no average", async () => {
  await addWeeklySales([[9, 20], [9, 27], [10, 3]]);
  assert.equal(await loadAverageWeeklyProfit(weekRange()), null);
  await db.transactions.clear();
  assert.equal(await loadAverageWeeklyProfit(weekRange()), null, "no data at all");
});

test("3.11: a quiet week inside the span counts as zero, and the stock and other costs are taken off", async () => {
  await db.transactions.bulkAdd([
    { id: "a", type: "sale", amountPesewas: 20000, paymentType: "cash", createdAt: at(9, 12), timestamp: at(9, 12) },
    { id: "b", type: "expense", category: "stock", amountPesewas: 4000, paidAmountPesewas: 4000, createdAt: at(9, 13), timestamp: at(9, 13) },
    { id: "c", type: "sale", amountPesewas: 8000, paymentType: "cash", createdAt: at(10, 4), timestamp: at(10, 4) }
  ]);
  // Weeks: 12 Oct 16000, 19 Oct 0, 26 Oct 0, 2 Nov 8000 → 24000 / 4.
  assert.equal(await loadAverageWeeklyProfit(weekRange()), 6000);
});

// ---- the screen ------------------------------------------------------------------------------

function reportFor(overrides = {}) {
  return {
    summary: {
      moneyIn: 22000, cashIn: 18000, momoIn: 4000, collectedIn: 3000, givenOnCredit: 8000,
      moneySpent: 18000, spentStock: 15000, spentOther: 3000,
      spentCash: 12000, spentMomo: 4000, spentUnrecorded: 2000, cashShouldHave: 6000, momoShouldHave: 0,
      moneyLeft: 4000, sales: 30000, stockBought: 15000, otherCosts: 3000, profit: 12000
    },
    comparison: { kind: "more", amountPesewas: 2500 },
    hideAmounts: false,
    showProfit: true,
    averageProfitPesewas: 9500,
    debtPesewas: 9300,
    supplierBalancePesewas: 28000,
    ...overrides
  };
}
async function mountMyMoney(report) {
  const { default: MyMoney } = await loadJsx("src/pos/MyMoney.jsx");
  setLiveQuery(() => report);
  const navigations = [];
  const view = render({ type: MyMoney, props: { onNavigate: (...args) => navigations.push(args) } });
  setLiveQuery(null);
  return { view, navigations };
}

test("3.11: the strong block says Money left (never Cash left) with the period", async () => {
  const { view } = await mountMyMoney(reportFor());
  const text = textOf(view.tree);
  // Wiring 33 (15 Nov 2026): the default period is Today.
  assert.match(text, /Money left today/);
  assert.doesNotMatch(text, /Cash left/);
  assert.match(text, new RegExp(formatGhs(4000).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(text, /Money in minus money spent/);
});

test("3.11: no 'Category breakdown unavailable' text, even when a breakdown is missing", async () => {
  const { view } = await mountMyMoney(reportFor());
  assert.doesNotMatch(textOf(view.tree), /Category breakdown unavailable|unavailable/i);
  const empty = await mountMyMoney(reportFor({ summary: { ...reportFor().summary, moneyIn: 0, cashIn: 0, momoIn: 0, moneySpent: 0, spentStock: 0, spentOther: 0 } }));
  assert.doesNotMatch(textOf(empty.view.tree), /unavailable|undefined|NaN/i);
  assert.doesNotMatch(textOf(empty.view.tree), /Cash GH₵0\.00|Stock GH₵0\.00/, "no breakdown line when there is nothing to break down");
  assert.throws(() => posText("money.spendingBreakdownUnavailable"), /Missing English POS string/);
});

test("3.11: Money in and Money spent show their breakdowns through the formatter", async () => {
  const { view } = await mountMyMoney(reportFor());
  const text = textOf(view.tree);
  // Wiring 33 (15 Nov 2026): Cash and MoMo rows, and Paid in cash / Paid by MoMo / Method not recorded.
  assert.match(text, /Money in/);
  assert.ok(text.includes(`Cash${formatGhs(18000)}`));
  assert.ok(text.includes(`MoMo${formatGhs(4000)}`));
  assert.match(text, /Money spent/);
  assert.ok(text.includes(`Paid in cash${formatGhs(12000)}`));
  assert.ok(text.includes(`Paid by MoMo${formatGhs(4000)}`));
  assert.ok(text.includes(`Method not recorded${formatGhs(2000)}`));
  assert.ok(text.includes(formatGhs(22000)));
  assert.ok(text.includes(formatGhs(18000)));
});

test("3.11: the comparison line is calm and neutral for more and for less", async () => {
  // Today is the default period, so the line compares with yesterday (This week: tests/myMoneyThreePeriods).
  const more = textOf((await mountMyMoney(reportFor({ comparison: { kind: "more", amountPesewas: 2500 } }))).view.tree);
  assert.ok(more.includes(`${formatGhs(2500)} more than yesterday`));
  const less = textOf((await mountMyMoney(reportFor({ comparison: { kind: "less", amountPesewas: 2500 } }))).view.tree);
  assert.ok(less.includes(`${formatGhs(2500)} less than yesterday`));
  assert.doesNotMatch(less, /\bDown\b|\bUp\b|drop|fell|lost|worse/i);
  const same = textOf((await mountMyMoney(reportFor({ comparison: { kind: "same", amountPesewas: 0 } }))).view.tree);
  assert.match(same, /Same as yesterday/);
  const none = textOf((await mountMyMoney(reportFor({ comparison: null }))).view.tree);
  assert.doesNotMatch(none, /yesterday|last week|last month/);
  assert.doesNotMatch(none, /NaN|undefined/);
});

test("3.11: the comparison line for the month says last month", async () => {
  const { default: MyMoney } = await loadJsx("src/pos/MyMoney.jsx");
  setLiveQuery(() => reportFor({ comparison: { kind: "less", amountPesewas: 100 } }));
  const view = render({ type: MyMoney, props: { onNavigate() {} } });
  findButton(view.tree, "This month").props.onClick();
  view.rerender();
  setLiveQuery(null);
  const text = textOf(view.tree);
  assert.match(text, /Money left this month/);
  assert.ok(text.includes(`${formatGhs(100)} less than last month`));
});

test("3.11: the Estimated profit card shows the tag, the sum and the average of the last 4 weeks", async () => {
  // The 4-week average shows only for This week (wiring 33, 15 Nov 2026).
  const { default: MyMoney } = await loadJsx("src/pos/MyMoney.jsx");
  setLiveQuery(() => reportFor());
  const view = render({ type: MyMoney, props: { onNavigate() {} } });
  assert.doesNotMatch(textOf(view.tree), /Average of last/, "not for Today");
  findButton(view.tree, "This week").props.onClick();
  view.rerender();
  setLiveQuery(null);
  const text = textOf(view.tree);
  assert.match(text, /Estimated profit/);
  assert.match(text, /Estimate/);
  assert.ok(text.includes(formatGhs(12000)));
  assert.ok(text.includes(`Sales ${formatGhs(30000)} − stock ${formatGhs(15000)} − other costs ${formatGhs(3000)}`));
  assert.ok(text.includes(`Average of last 4 weeks: ${formatGhs(9500)}`));
  const noAverage = textOf((await mountMyMoney(reportFor({ averageProfitPesewas: null }))).view.tree);
  assert.doesNotMatch(noAverage, /Average of last/);
});

test("3.11: with the switch off the profit card is hidden and no nudge shows (and none shows when it is on)", async () => {
  const off = textOf((await mountMyMoney(reportFor({ showProfit: false }))).view.tree);
  assert.doesNotMatch(off, /Estimated profit|Estimate|Sales .* − stock/);
  for (const text of [off, textOf((await mountMyMoney(reportFor())).view.tree)]) {
    assert.doesNotMatch(text, /Want to see your profit|Turn on estimated profit|Open Settings/);
  }
  for (const key of ["money.wantProfit", "money.profitSettingsPrompt", "money.openSettings"]) {
    assert.throws(() => posText(key), /Missing English POS string/);
  }
});

test("3.11: the two debt tiles are white pressed buttons with a border, no coloured edge, neutral amounts, a clear link", async () => {
  const { view, navigations } = await mountMyMoney(reportFor());
  const text = textOf(view.tree);
  assert.ok(text.includes(`Owed to you${formatGhs(9300)}See who`) || (text.includes("Owed to you") && text.includes(formatGhs(9300)) && text.includes("See who")));
  assert.ok(text.includes("You owe suppliers") && text.includes(formatGhs(28000)) && text.includes("See list"));
  const owed = findButton(view.tree, "See who");
  owed.props.onClick();
  findButton(view.tree, "See list").props.onClick();
  assert.deepEqual(navigations.map((entry) => entry[0]), ["PeopleWhoOweYou", "YouOweSuppliers"]);
  assert.match(owed.props.className, /bg-white/);
  assert.match(owed.props.className, /border-2 border-slate-300/);
  assert.doesNotMatch(owed.props.className, /border-l-/, "no coloured left edge (24 Nov 2026)");
  for (const node of [...walk(owed)].filter((child) => typeof child.props?.className === "string")) assert.doesNotMatch(node.props.className, /text-(rose|amber)-/, "neutral amount");
});

test("3.11: Money left and What you should have left are soft tiles; the other cards are white with a thin border", async () => {
  const { view } = await mountMyMoney(reportFor());
  const cards = [...walk(view.tree)].filter((node) => node.type === "section" || (node.type === "button" && /rounded-\[1[68]px\]/.test(node.props.className ?? "")));
  assert.equal(cards.filter((node) => /bg-(emerald|green)-(8|9)00/.test(node.props.className)).length, 0, "no strong colour block");
  const soft = cards.filter((node) => /bg-\[#F1F5F9\]/.test(node.props.className));
  assert.deepEqual(soft.map((node) => node.props["data-block"] ?? node.props["data-card"]), ["money-left", "should-have-left"]);
  for (const node of soft) assert.doesNotMatch(node.props.className, /(^|\s)border|text-white/);
  for (const card of cards.filter((node) => !soft.includes(node))) {
    assert.match(card.props.className, /bg-white/, `card is white: ${textOf(card).slice(0, 30)}`);
    assert.doesNotMatch(card.props.className, /bg-(rose|amber|green|emerald)-\d+/);
  }
});

test("3.11: amounts come from the formatter, not typed in the screen", () => {
  const source = readFileSync(new URL("../src/pos/MyMoney.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /GH₵|toFixed\(|\/ 100/);
  // Every figure goes through the shared Amount / amountText (rules_global.hide_amounts), which
  // format with formatGhs; no figure bypasses the shared hidden rendering.
  assert.match(source, /<Amount |amountText\(/);
  assert.doesNotMatch(source, /formatGhs/);
  assert.match(readFileSync(new URL("../src/pos/HiddenAmount.jsx", import.meta.url), "utf8"), /formatGhs\(pesewas\)/);
});

// ---- Settings: one switch ---------------------------------------------------------------------

test("3.11: Settings has one switch that hides the profit card; it is on by default and is saved", async () => {
  const { SettingsProfitTools } = await loadJsx("src/pos/SettingsScreens.jsx");
  const view = render({ type: SettingsProfitTools, props: { shopName: "My shop", onShopNameChange() {}, onBack() {}, onOpenBackup() {}, onOpenMomoSettings() {}, onOpenPlan() {}, onOpenSubscription() {} } });
  const switches = [...walk(view.tree)].filter((node) => node.type === "input" && node.props.role === "switch" && node.props.id === "settings-profit");
  assert.equal(switches.length, 1, "one switch for the profit card (the other switch is Sound)");
  assert.equal(switches[0].props.checked, true, "shown by default");
  assert.match(textOf(view.tree), /Show estimated profit/);
  assert.doesNotMatch(textOf(view.tree), /Profit estimates/);
  assert.equal(await getPreference(SHOW_PROFIT_PREFERENCE, true), true);
  switches[0].props.onChange({ target: { checked: false } });
  await waitFor(async () => (await getPreference(SHOW_PROFIT_PREFERENCE, true)) === false, "the switch to be saved as off");
  switches[0].props.onChange({ target: { checked: true } });
  await waitFor(async () => (await getPreference(SHOW_PROFIT_PREFERENCE, true)) === true, "the switch to be saved as on");
});

test("3.11: the report reads the switch (hidden when saved as off)", () => {
  const base = { currentTransactions: [], previousTransactions: [], debts: [], allTransactions: [], suppliers: [] };
  assert.equal(buildMyMoneyReport({ ...base, showProfit: false }).showProfit, false);
  assert.equal(buildMyMoneyReport({ ...base, showProfit: true }).showProfit, true);
});
