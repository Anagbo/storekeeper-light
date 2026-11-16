import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { loadHideAmounts, saveHideAmounts, setPreference } from "../src/db/preferences.js";
import { formatGhs } from "../src/lib/money.js";
import { loadMyMoneyReport } from "../src/pos/myMoneyReport.js";
import { findButton, loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";
import { hostShape, moneyPieces } from "./helpers/hiddenAmountScan.js";

// Wiring 33 "Hide amounts" and rules_global.hide_amounts: the eye button (48px) beside the title
// "My money" hides every shop figure on the screen behind "GH₵ ••••". Sentences keep their words; the
// comparison line becomes "Compared with yesterday: GH₵ ••••" so it does not say up or down.

globalThis.HTMLElement ??= class {};
const tick = () => new Promise((resolve) => setTimeout(resolve, 2));
let liveResults = new Map();

after(async () => {
  setLiveQuery(null);
  db.close();
  await db.delete();
});

beforeEach(async () => {
  liveResults = new Map();
  setLiveQuery((deps, query) => {
    // 33 passes now.getTime() in its deps: a timestamp must not make every render a new query.
    const key = `${String(query)}|${JSON.stringify(deps.map((dep) => (typeof dep === "number" && dep > 1e12 ? "now" : dep)))}`;
    if (!liveResults.has(key)) {
      liveResults.set(key, undefined);
      Promise.resolve().then(query).then((value) => liveResults.set(key, value), () => liveResults.set(key, null));
    }
    return liveResults.get(key);
  });
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.suppliers, db.settings].map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
});

const DAY = 86_400_000;
const hiddenNodes = (tree) => [...walk(tree)].filter((node) => node.props?.["data-hidden-amount"] !== undefined);
const eyeButton = (tree) => [...walk(tree)].find((node) => node.type === "button" && node.props?.["data-hide-amounts"] !== undefined);

async function seed() {
  const now = Date.now();
  await db.transactions.bulkAdd([
    { id: "s1", type: "sale", amountPesewas: 123456, total_amount: 123456, payment_method: "cash", cashReceivedPesewas: 123456, momoReceivedPesewas: 0, createdAt: now, timestamp: now },
    { id: "s2", type: "sale", amountPesewas: 4000, total_amount: 4000, payment_method: "momo", cashReceivedPesewas: 0, momoReceivedPesewas: 4000, createdAt: now, timestamp: now },
    { id: "y1", type: "sale", amountPesewas: 1000, total_amount: 1000, payment_method: "cash", cashReceivedPesewas: 1000, momoReceivedPesewas: 0, createdAt: now - DAY, timestamp: now - DAY },
    { id: "e1", type: "expense", category: "stock", amountPesewas: 6000, paidAmountPesewas: 6000, payment_method: "cash", createdAt: now, timestamp: now },
    { id: "e2", type: "expense", category: "transport", amountPesewas: 2500, paidAmountPesewas: 2500, payment_method: "momo", createdAt: now, timestamp: now }
  ]);
  await db.suppliers.add({ id: "sup-1", name: "Kofi Supplies", balancePesewas: 3300 });
  await recordCreditSale({ name: "Ama Owes", amountPesewas: 7700, now: now - 3 * DAY });
}

async function openMyMoney() {
  const { default: MyMoney } = await loadJsx("src/pos/MyMoney.jsx");
  const view = render({ type: MyMoney, props: { onNavigate() {} } });
  await settle(view);
  return view;
}
async function settle(view, label) {
  const ready = () => eyeButton(view.tree) && !eyeButton(view.tree).props.disabled && (!label || eyeButton(view.tree).props["aria-label"] === label);
  for (let index = 0; index < 200 && !ready(); index += 1) {
    await tick();
    view.rerender();
  }
  assert.ok(eyeButton(view.tree), "My money loaded with its eye button");
}
async function toggle(view) {
  const next = eyeButton(view.tree).props["aria-label"] === "Hide amounts" ? "Show amounts" : "Hide amounts";
  await eyeButton(view.tree).props.onClick();
  liveResults = new Map();
  await settle(view, next);
}

test("33: shown by default; the eye (48px, Hide amounts) is on the title row beside My money", async () => {
  await seed();
  const view = await openMyMoney();
  const button = eyeButton(view.tree);
  assert.equal(button.props["aria-label"], "Hide amounts");
  assert.match(button.props.className, /\bh-12\b/);
  assert.match(button.props.className, /\bw-12\b/);
  const row = [...walk(view.tree)].find((node) => node.type === "div" && [...walk(node)].some((child) => child.type === "h1") && [...walk(node)].includes(button) && !node.props?.["data-wide-header"]);
  assert.ok(row && /My money/.test(textOf(row)), "title row: Back, My money, eye");
  assert.equal(hiddenNodes(view.tree).length, 0);
  const report = await loadMyMoneyReport({ period: "day" });
  const text = textOf(view.tree);
  for (const amount of [report.summary.moneyLeft, report.summary.moneyIn, report.summary.profit, report.debtPesewas, report.supplierBalancePesewas]) {
    assert.ok(text.includes(formatGhs(amount)), `shows ${formatGhs(amount)}`);
  }
});

test("33: hidden replaces every figure on the screen (a scan finds no money text at all)", async () => {
  await seed();
  const view = await openMyMoney();
  await toggle(view);
  assert.equal(eyeButton(view.tree).props["aria-label"], "Show amounts");
  assert.deepEqual(moneyPieces(view.tree), [], "no amount left anywhere on 33");
  for (const node of hiddenNodes(view.tree)) {
    assert.equal(textOf(node), "GH₵ ••••");
    assert.equal(node.props["aria-label"], "Amount hidden");
  }
  const text = textOf(view.tree);
  assert.match(text, /Compared with yesterday: GH₵ ••••/);
  assert.doesNotMatch(text, /more than|less than|Same as/);
  assert.match(text, /Sales GH₵ •••• − stock GH₵ •••• − other costs GH₵ ••••/);
  for (const label of ["Money left today", "Money in", "Cash", "MoMo", "What you should have left", "Estimated profit", "Owed to you"]) {
    assert.ok(text.includes(label), `${label} keeps its words`);
  }
});

test("33: every period stays hidden, and the comparison never says up or down while hidden", async () => {
  const { default: MyMoney } = await loadJsx("src/pos/MyMoney.jsx");
  const report = (kind) => ({
    hideAmounts: true,
    summary: { moneyIn: 9, cashIn: 9, momoIn: 0, collectedIn: 5, givenOnCredit: 5, moneySpent: 9, spentCash: 9, spentMomo: 0, spentUnrecorded: 5, cashShouldHave: 9, momoShouldHave: 0, moneyLeft: 9, sales: 9, stockBought: 9, otherCosts: 9, profit: 9 },
    comparison: { kind, amountPesewas: 2500 },
    showProfit: true,
    averageProfitPesewas: 9500,
    debtPesewas: 9300,
    supplierBalancePesewas: 28000
  });
  for (const kind of ["more", "less", "same"]) {
    setLiveQuery(() => report(kind));
    const view = render({ type: MyMoney, props: { onNavigate() {} } });
    for (const [period, words] of [["Today", "yesterday"], ["This week", "last week"], ["This month", "last month"]]) {
      findButton(view.tree, period).props.onClick();
      view.rerender();
      const text = textOf(view.tree);
      assert.ok(text.includes(`Compared with ${words}: GH₵ ••••`), `${kind}, ${period}`);
      assert.doesNotMatch(text, /more than|less than|Same as/);
      assert.deepEqual(moneyPieces(view.tree), [], `${kind}, ${period}: no amount`);
    }
    assert.match(textOf(view.tree), /Money left this month/);
  }
  setLiveQuery(null);
});

test("33: the week average line keeps its words and hides its amount", async () => {
  const { default: MyMoney } = await loadJsx("src/pos/MyMoney.jsx");
  setLiveQuery(() => ({ hideAmounts: true, summary: { moneyIn: 0, cashIn: 0, momoIn: 0, collectedIn: 0, givenOnCredit: 0, moneySpent: 0, spentCash: 0, spentMomo: 0, spentUnrecorded: 0, cashShouldHave: 0, momoShouldHave: 0, moneyLeft: 0, sales: 0, stockBought: 0, otherCosts: 0, profit: 0 }, comparison: null, showProfit: true, averageProfitPesewas: 9500, debtPesewas: 0, supplierBalancePesewas: 0 }));
  const view = render({ type: MyMoney, props: { onNavigate() {} } });
  findButton(view.tree, "This week").props.onClick();
  view.rerender();
  setLiveQuery(null);
  assert.match(textOf(view.tree), /Average of last 4 weeks: GH₵ ••••/);
  assert.deepEqual(moneyPieces(view.tree), []);
});

test("33: until the setting is known the figures render hidden", async () => {
  const { default: MyMoney } = await loadJsx("src/pos/MyMoney.jsx");
  setLiveQuery(() => ({ summary: { moneyIn: 99999, cashIn: 99999, momoIn: 0, collectedIn: 0, givenOnCredit: 0, moneySpent: 0, spentCash: 0, spentMomo: 0, spentUnrecorded: 0, cashShouldHave: 99999, momoShouldHave: 0, moneyLeft: 99999, sales: 99999, stockBought: 0, otherCosts: 0, profit: 99999 }, comparison: { kind: "more", amountPesewas: 99999 }, showProfit: true, averageProfitPesewas: null, debtPesewas: 99999, supplierBalancePesewas: 99999 }));
  const view = render({ type: MyMoney, props: { onNavigate() {} } });
  setLiveQuery(null);
  assert.deepEqual(moneyPieces(view.tree), []);
  assert.ok(hiddenNodes(view.tree).length > 0);
});

test("33: the hidden form does not leak the length of any figure", async () => {
  const { default: MyMoney } = await loadJsx("src/pos/MyMoney.jsx");
  const shapes = [];
  for (const amount of [5, 123_456_789_00]) {
    const summary = Object.fromEntries(["moneyIn", "cashIn", "momoIn", "collectedIn", "givenOnCredit", "moneySpent", "spentCash", "spentMomo", "spentUnrecorded", "cashShouldHave", "momoShouldHave", "moneyLeft", "sales", "stockBought", "otherCosts", "profit"].map((name) => [name, amount]));
    setLiveQuery(() => ({ hideAmounts: true, summary, comparison: { kind: "more", amountPesewas: amount }, showProfit: true, averageProfitPesewas: amount, debtPesewas: amount, supplierBalancePesewas: amount }));
    const view = render({ type: MyMoney, props: { onNavigate() {} } });
    shapes.push(JSON.stringify(hostShape(view.tree)));
  }
  setLiveQuery(null);
  assert.equal(shapes[0], shapes[1], "GH₵0.05 and GH₵123,456,789.00 hide to the very same page");
});

test("33 and 22 share one setting: hiding on My money hides Home, and it survives a fresh screen", async () => {
  await seed();
  const view = await openMyMoney();
  await toggle(view);
  assert.equal(await loadHideAmounts(), true);
  liveResults = new Map();
  const { default: Home } = await loadJsx("src/pos/Home.jsx");
  const home = render({ type: Home, props: { onNavigate() {} } });
  for (let index = 0; index < 200 && !eyeButton(home.tree); index += 1) { await tick(); home.rerender(); }
  assert.equal(eyeButton(home.tree).props["aria-label"], "Show amounts");
  const again = await openMyMoney();
  assert.equal(eyeButton(again.tree).props["aria-label"], "Show amounts");
  await toggle(again);
  assert.equal(await loadHideAmounts(), false);
  assert.equal(hiddenNodes(again.tree).length, 0);
});

test("33: the report carries the setting, read with the figures", async () => {
  assert.equal((await loadMyMoneyReport({ period: "day" })).hideAmounts, false);
  await saveHideAmounts(true);
  assert.equal((await loadMyMoneyReport({ period: "week" })).hideAmounts, true);
});
