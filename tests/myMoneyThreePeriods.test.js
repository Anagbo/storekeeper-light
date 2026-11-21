import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { formatGhs, getFinancialTransactions, summarizeFinancialTransactionsSafely, summarizePosMoneySafely } from "../src/lib/money.js";
import { loadMyMoneyReport, summarizeMyMoney } from "../src/pos/myMoneyReport.js";
import { getMoneyPeriodRange } from "../src/pos/money.js";
import { getLayout } from "../src/pos/layout.js";
import { appCss, browser, measureInFrames, toHtml } from "./helpers/browserLayout.js";
import { findButton, loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Wiring 33 (15 Nov 2026): Today / This week / This month (default Today); Money in by method (sales
// parts plus collections; credit and corrections never), the Debts paid and On credit rows (On credit =
// 24's Given on credit); Money spent by method with "Method not recorded"; What you
// should have left; Owed to you and You owe suppliers do not follow the period. Same rows as 22 and 24.

after(async () => {
  setLiveQuery(null);
  db.close();
  await db.delete();
});
beforeEach(async () => {
  setLiveQuery(null);
  await Promise.all(["transactions", "debts", "suppliers", "settings", "customers"].map((name) => db.table(name).clear()));
});

// Wednesday 18 Nov 2026, 15:00. This week starts Monday 16 Nov.
const NOW = new Date(2026, 10, 18, 15, 0);
const at = (day, hour = 10, month = 10) => new Date(2026, month, day, hour).getTime();
const row = (id, createdAt, fields) => ({ id, createdAt, timestamp: createdAt, updatedAt: createdAt, ...fields });

const cashSale = (id, when, amount) => row(id, when, { type: "sale", amountPesewas: amount, total_amount: amount, payment_method: "cash", cashReceivedPesewas: amount, momoReceivedPesewas: 0 });
const splitSale = (id, when, cash, momo) => row(id, when, { type: "sale", amountPesewas: cash + momo, total_amount: cash + momo, payment_method: "split", cashReceivedPesewas: cash, momoReceivedPesewas: momo });
const partPaidCreditSale = (id, when, cash, momo, owed) => row(id, when, { type: "installment_sale", paymentType: "credit", amountPesewas: cash + momo + owed, total_amount: cash + momo + owed, payment_method: "split", cashReceivedPesewas: cash, momoReceivedPesewas: momo, installmentPaymentPesewas: cash + momo, creditExtendedPesewas: owed });
const collection = (id, when, amount, method) => row(id, when, { type: "income", collectionType: "debt_collection", amountPesewas: amount, total_amount: amount, payment_method: method, note: "Debt payment from Ama" });
const correction = (id, when, amount) => row(id, when, { type: "debt_adjustment", amountPesewas: amount, total_amount: amount, payment_method: null });
const addedToDebt = (id, when, amount) => row(id, when, { type: "manual_debt", amountPesewas: amount, total_amount: amount, creditExtendedPesewas: amount, payment_method: null });
const expense = (id, when, amount, extra = {}) => row(id, when, { type: "expense", category: "transport", amountPesewas: amount, total_amount: amount, paidAmountPesewas: amount, owedAmountPesewas: 0, payment_method: "cash", ...extra });
const supplierPayment = (id, when, amount, extra = {}) => row(id, when, { type: "supplier_payment", supplierId: "s1", amountPesewas: amount, total_amount: amount, payment_method: "cash", ...extra });

const report = (period) => loadMyMoneyReport({ period, now: NOW });

// ---- each period -----------------------------------------------------------------------------------------

test("each period counts only its own rows: Today, This week (from Monday) and This month", async () => {
  await db.transactions.bulkAdd([
    cashSale("today", at(18), 1000),
    cashSale("monday", at(16), 2000),
    cashSale("month", at(3), 4000),
    cashSale("last-month", at(31, 10, 9), 8000)
  ]);
  assert.equal((await report("day")).summary.moneyIn, 1000);
  assert.equal((await report("week")).summary.moneyIn, 3000);
  assert.equal((await report("month")).summary.moneyIn, 7000);
});

test("the comparison follows the period: yesterday, last week, last month", async () => {
  await db.transactions.bulkAdd([cashSale("today", at(18), 5000), cashSale("yesterday", at(17), 2000), cashSale("last-week", at(10), 1000), cashSale("last-month", at(20, 10, 9), 500)]);
  assert.deepEqual((await report("day")).comparison, { kind: "more", amountPesewas: 3000 });
  assert.deepEqual((await report("week")).comparison, { kind: "more", amountPesewas: 6000 });
  assert.deepEqual((await report("month")).comparison, { kind: "more", amountPesewas: 7500 });
});

test("Owed to you and You owe suppliers are the balance now, the same for every period", async () => {
  await db.debts.bulkAdd([
    { id: "d1", status: "unpaid", amountPesewas: 9300, total_owed: 9300, createdAt: at(1, 10, 8) },
    { id: "d2", status: "paid", amountPesewas: 0, total_owed: 0, createdAt: at(18) }
  ]);
  await db.suppliers.add({ id: "s1", name: "Kofi", nameLower: "kofi", phone: "" });
  await db.transactions.add(row("stock", at(2, 10, 8), { type: "expense", category: "stock", supplierId: "s1", amountPesewas: 28000, total_amount: 28000, paidAmountPesewas: 0, owedAmountPesewas: 28000, payment_method: "cash" }));
  for (const period of ["day", "week", "month"]) {
    const result = await report(period);
    assert.equal(result.debtPesewas, 9300, period);
    assert.equal(result.supplierBalancePesewas, 28000, period);
  }
});

test("Estimated profit follows the period; the 4-week average is only for This week", async () => {
  await db.transactions.bulkAdd([
    cashSale("old", at(1, 10, 8), 100), // three months of data, so 4 weeks exist
    cashSale("today", at(18), 3000),
    row("stock", at(16), { type: "expense", category: "stock", amountPesewas: 1000, total_amount: 1000, paidAmountPesewas: 1000, owedAmountPesewas: 0, payment_method: "cash", paidWith: "cash" })
  ]);
  assert.equal((await report("day")).summary.profit, 3000);
  assert.equal((await report("week")).summary.profit, 2000);
  assert.equal((await report("day")).averageProfitPesewas, null);
  assert.equal((await report("month")).averageProfitPesewas, null);
  assert.notEqual((await report("week")).averageProfitPesewas, null);
});

// ---- money in -------------------------------------------------------------------------------------------

test("a split sale counts each part once, by method", () => {
  const summary = summarizeMyMoney([splitSale("s", 1, 3000, 2000), partPaidCreditSale("c", 1, 400, 600, 1000)]);
  assert.equal(summary.cashIn, 3400);
  assert.equal(summary.momoIn, 2600);
  assert.equal(summary.moneyIn, 6000);
  assert.equal(summary.sales, 7000, "each sale once in the sales total");
});

test("a debt collection is money in (by its method) and in the collected line, but not a sale", () => {
  const summary = summarizeMyMoney([cashSale("s", 1, 1000), collection("c1", 1, 700, "momo"), collection("c2", 1, 300, "cash")]);
  assert.equal(summary.momoIn, 700);
  assert.equal(summary.cashIn, 1300);
  assert.equal(summary.collectedIn, 1000);
  assert.equal(summary.sales, 1000, "a collection is not a sale");
  assert.equal(summary.profit, 1000, "nor profit");
});

test("a balance correction counts as nothing", () => {
  const base = [cashSale("s", 1, 1000), expense("e", 1, 200, { paidWith: "cash" })];
  assert.deepEqual(summarizeMyMoney([...base, correction("fix", 1, 5000)]), summarizeMyMoney(base));
});

test("credit appears only as the quiet Also given on credit line: the owed part of sales plus Added to debt", () => {
  const summary = summarizeMyMoney([partPaidCreditSale("c", 1, 400, 600, 1000), addedToDebt("m", 1, 2500), row("owe-all", 1, { type: "sale", paymentType: "credit", amountPesewas: 800, total_amount: 800, cashReceivedPesewas: 0, creditExtendedPesewas: 800 })]);
  assert.equal(summary.givenOnCredit, 1000 + 2500 + 800);
  assert.equal(summary.moneyIn, 1000, "credit is never money in");
  assert.equal(summary.cashIn + summary.momoIn, 1000);
  assert.equal(summary.cashShouldHave + summary.momoShouldHave, 1000, "nor money you should have");
});

test("Cash + MoMo = Money in, on a mixed day", () => {
  const summary = summarizeMyMoney([
    cashSale("a", 1, 1234), splitSale("b", 1, 500, 777), partPaidCreditSale("c", 1, 10, 20, 30),
    collection("d", 1, 450, "momo"), collection("e", 1, 50, "cash"), correction("f", 1, 99), addedToDebt("g", 1, 1000),
    row("legacy-momo", 1, { type: "sale", paymentType: "momo", amountPesewas: 300 })
  ]);
  assert.equal(summary.cashIn + summary.momoIn, summary.moneyIn);
  assert.equal(summary.moneyIn, 1234 + 1277 + 30 + 500 + 300);
});

// ---- money spent ----------------------------------------------------------------------------------------

test("spending parts add up to Money spent: Paid in cash + Paid by MoMo + Method not recorded", () => {
  const summary = summarizeMyMoney([
    expense("cash", 1, 1000, { paidWith: "cash" }),
    expense("momo", 1, 2000, { paidWith: "momo" }),
    expense("old", 1, 400),
    row("part", 1, { type: "expense", category: "stock", amountPesewas: 5000, total_amount: 5000, paidAmountPesewas: 1500, owedAmountPesewas: 3500, payment_method: "cash", paidWith: "momo" }),
    supplierPayment("pay-momo", 1, 700, { paidWith: "momo" }),
    supplierPayment("pay-old", 1, 300)
  ]);
  assert.equal(summary.spentCash, 1000);
  assert.equal(summary.spentMomo, 2000 + 1500 + 700, "only the part paid now, and the supplier payment");
  assert.equal(summary.spentUnrecorded, 400 + 300, "older records have no method");
  assert.equal(summary.spentCash + summary.spentMomo + summary.spentUnrecorded, summary.moneySpent);
});

test("What you should have left: cash in − cash spent, MoMo in − MoMo spent; with unrecorded spending they explain Money left", () => {
  const summary = summarizeMyMoney([splitSale("s", 1, 3000, 2000), expense("c", 1, 500, { paidWith: "cash" }), expense("m", 1, 800, { paidWith: "momo" }), expense("old", 1, 100)]);
  assert.equal(summary.cashShouldHave, 2500);
  assert.equal(summary.momoShouldHave, 1200);
  assert.equal(summary.cashShouldHave + summary.momoShouldHave - summary.spentUnrecorded, summary.moneyLeft);
});

// ---- the same rows as 22 and 24 ----------------------------------------------------------------------------

test("Today on 33 agrees with Home (22) and Today's transactions (24), from the same rows", async () => {
  await db.transactions.bulkAdd([
    splitSale("a", at(18, 9), 1500, 500), partPaidCreditSale("b", at(18, 10), 100, 200, 700), collection("c", at(18, 11), 400, "momo"),
    addedToDebt("d", at(18, 12), 900), correction("e", at(18, 12), 300), expense("f", at(18, 13), 250, { paidWith: "cash" }), expense("g", at(18, 13), 60),
    cashSale("yesterday", at(17), 9999)
  ]);
  const day = getMoneyPeriodRange("day", NOW);
  const rows = await getFinancialTransactions(day);
  const home = summarizePosMoneySafely(rows).totals;
  const tile24 = summarizeFinancialTransactionsSafely(rows).totals;
  const { summary } = await report("day");
  assert.equal(summary.moneyIn, home.moneyIn);
  assert.equal(summary.cashIn, home.cashIn);
  assert.equal(summary.momoIn, home.momoIn);
  assert.equal(summary.moneySpent, home.moneySpent);
  assert.equal(summary.moneyLeft, home.cashLeft);
  assert.equal(summary.givenOnCredit, tile24.creditGiven, "Also given on credit = 24's Given on credit");
  assert.equal(summary.collectedIn, tile24.debtPaymentsCollected);
});

// ---- the screen -----------------------------------------------------------------------------------------

function screenReport(summaryOverrides = {}) {
  return {
    summary: {
      moneyIn: 6000, cashIn: 3500, momoIn: 2500, collectedIn: 1000, givenOnCredit: 4300,
      moneySpent: 1800, spentStock: 0, spentOther: 1800, spentCash: 1000, spentMomo: 500, spentUnrecorded: 300,
      cashShouldHave: 2500, momoShouldHave: 2000, moneyLeft: 4200, sales: 5000, stockBought: 0, otherCosts: 1800, profit: 3200,
      ...summaryOverrides
    },
    comparison: null, uncounted: { sales: 0, other: 0 }, hideAmounts: false, showProfit: true, averageProfitPesewas: 1000, debtPesewas: 9300, supplierBalancePesewas: 28000
  };
}
async function mount(report, props = {}) {
  const { default: MyMoney } = await loadJsx("src/pos/MyMoney.jsx");
  const asked = [];
  setLiveQuery((deps) => { asked.push(deps[0]); return report; });
  const view = render({ type: MyMoney, props: { onNavigate() {}, ...props } });
  return { view, asked };
}
const card = (view, name) => [...walk(view.tree)].find((node) => node.props?.["data-card"] === name);

test("33: three period buttons, Today selected by default, one always selected", async () => {
  const { view, asked } = await mount(screenReport());
  const buttons = [...walk(view.tree)].filter((node) => node.type === "button" && node.props["aria-pressed"] !== undefined);
  assert.deepEqual(buttons.map((node) => textOf(node)), ["Today", "This week", "This month"]);
  assert.deepEqual(buttons.map((node) => node.props["aria-pressed"]), [true, false, false]);
  assert.equal(asked[0], "day");
  findButton(view.tree, "This month").props.onClick();
  view.rerender();
  const after = [...walk(view.tree)].filter((node) => node.type === "button" && node.props["aria-pressed"] !== undefined);
  assert.deepEqual(after.map((node) => node.props["aria-pressed"]), [false, false, true]);
  assert.equal(asked.at(-1), "month");
});

// Changed 15 Nov 2026 (wiring 33 layout rule): the caption is the same for every period.
test("33: the heading follows the period; the caption is 'This period only. Check your MoMo balance.'", async () => {
  const { view } = await mount(screenReport());
  const caption = "This period only. Check your MoMo balance.";
  assert.match(textOf(view.tree), /Money left today/);
  assert.ok(textOf(card(view, "should-have-left")).endsWith(caption));
  for (const [button, heading] of [["This week", /Money left this week/], ["This month", /Money left this month/]]) {
    findButton(view.tree, button).props.onClick();
    view.rerender();
    assert.match(textOf(view.tree), heading);
    assert.ok(textOf(card(view, "should-have-left")).endsWith(caption), button);
  }
});

// Changed 15 Nov 2026 (wiring 33 "Debts paid"): the two sentences under Cash and MoMo are now two rows
// under a thicker line.
const rowOf = (view, name) => [...walk(view.tree)].find((node) => node.type === "p" && node.props?.["data-row"] === name);
test("33: Money in card: Cash and MoMo rows, then Debts paid (dark green) and On credit (dark crimson) under a thicker line", async () => {
  const { view } = await mount(screenReport());
  const text = textOf(card(view, "money-in"));
  assert.ok(text.includes(`Money in${formatGhs(6000)}`));
  assert.ok(text.includes(`Cash${formatGhs(3500)}`));
  assert.ok(text.includes(`MoMo${formatGhs(2500)}`));
  assert.ok(text.endsWith(`Debts paid${formatGhs(1000)}On credit${formatGhs(4300)}`), text);
  assert.doesNotMatch(text, /Includes|Also given on credit|paid by customers/, "the two sentences are gone");
  const extras = [...walk(card(view, "money-in"))].find((node) => node.props?.["data-line"] === "money-in-extras");
  assert.match(extras.props.className, /border-t-\[3px\]/, "a thicker line above the two rows");
  const paid = rowOf(view, "debts-paid");
  const credit = rowOf(view, "on-credit");
  assert.match(paid.props.className, /text-emerald-900/);
  assert.match(credit.props.className, /text-rose-900/);
  const cash = rowOf(view, "cash-in");
  for (const extra of [paid, credit]) {
    assert.doesNotMatch(extra.props.className, /\bbg-|\bborder\b|border-/, "no fill and no border");
    const [label, amount] = extra.props.children;
    assert.match(label.props.className, /font-bold/, "a plain bold label");
    assert.equal(amount.type, cash.props.children[1].type);
    assert.equal(amount.props.className, cash.props.children[1].props.className, "the amount in the same column and size as Cash");
  }
  const elsewhere = textOf(view.tree).replace(text, "");
  assert.doesNotMatch(elsewhere, /On credit|Debts paid/, "both only once, inside Money in");
});

test("33: Debts paid and On credit are each hidden when zero; Cash + MoMo = Money in", async () => {
  const noPaid = await mount(screenReport({ collectedIn: 0 }));
  assert.equal(rowOf(noPaid.view, "debts-paid"), undefined);
  assert.ok(rowOf(noPaid.view, "on-credit"));
  const noCredit = await mount(screenReport({ givenOnCredit: 0 }));
  assert.ok(rowOf(noCredit.view, "debts-paid"));
  assert.equal(rowOf(noCredit.view, "on-credit"), undefined);
  const none = await mount(screenReport({ collectedIn: 0, givenOnCredit: 0 }));
  assert.doesNotMatch(textOf(none.view.tree), /Debts paid|On credit/);
  assert.equal([...walk(none.view.tree)].some((node) => node.props?.["data-line"] === "money-in-extras"), false, "no line without the rows");
});

test("33 on real records: Cash + MoMo = Money in (Debts paid is inside it), and On credit = 24's Given on credit tile", async () => {
  await db.transactions.bulkAdd([
    splitSale("a", at(18, 9), 1500, 500), partPaidCreditSale("b", at(18, 10), 100, 200, 700), collection("c", at(18, 11), 400, "momo"),
    addedToDebt("d", at(18, 12), 900), correction("e", at(18, 12), 300), expense("f", at(18, 13), 250, { paidWith: "cash" })
  ]);
  const real = await report("day");
  assert.equal(real.summary.cashIn + real.summary.momoIn, real.summary.moneyIn);
  assert.equal(real.summary.moneyIn, 1500 + 500 + 100 + 200 + 400, "the collection is counted once");
  const { view } = await mount(real);
  assert.ok(textOf(rowOf(view, "debts-paid")).endsWith(formatGhs(400)));
  const { createPosTransactionRows } = await import("../src/pos/transactionFeed.js");
  const rows = await getFinancialTransactions(getMoneyPeriodRange("day", NOW));
  const { default: TodaysTransactions } = await loadJsx("src/pos/TodaysTransactions.jsx");
  setLiveQuery(() => ({ status: "ready", transactions: createPosTransactionRows(rows), totals: summarizeFinancialTransactionsSafely(rows).totals }));
  const tile = [...walk(render({ type: TodaysTransactions, props: { onBack() {} } }).tree)].find((node) => node.props?.["data-summary"] === "given-on-credit");
  const tileAmount = textOf(tile).replace(/^Given on credit/, "");
  assert.equal(tileAmount, formatGhs(700 + 900));
  assert.ok(textOf(rowOf(view, "on-credit")).endsWith(tileAmount), "33's On credit = 24's tile");
});

test("33: Money spent card shows Method not recorded only when above zero", async () => {
  const { view } = await mount(screenReport());
  const text = textOf(card(view, "money-spent"));
  assert.ok(text.includes(`Paid in cash${formatGhs(1000)}`));
  assert.ok(text.includes(`Paid by MoMo${formatGhs(500)}`));
  assert.ok(text.includes(`Method not recorded${formatGhs(300)}`));
  const none = await mount(screenReport({ spentUnrecorded: 0, moneySpent: 1500 }));
  assert.doesNotMatch(textOf(card(none.view, "money-spent")), /Method not recorded/);
});

test("33: What you should have left shows Cash and MoMo; the layout order follows the wiring", async () => {
  const { view } = await mount(screenReport());
  const text = textOf(card(view, "should-have-left"));
  assert.ok(text.includes(`Cash${formatGhs(2500)}`));
  assert.ok(text.includes(`MoMo${formatGhs(2000)}`));
  const order = textOf(view.tree);
  const at = (label) => order.indexOf(label);
  assert.ok(at("Money left today") < at("Money in") && at("Money in") < at("Money spent") && at("Money spent") < at("What you should have left") && at("What you should have left") < at("Estimated profit") && at("Estimated profit") < at("Owed to you"));
});

// ---- the period buttons at 340px -----------------------------------------------------------------------------

test("33 at 340, 360 and 393px: the three period buttons are equal and one line each, 16px", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)" }, async () => {
  const { view } = await mount(screenReport());
  setLiveQuery(null);
  const results = measureInFrames({
    pages: [{ name: "33", html: toHtml(view.tree) }],
    css: await appCss(),
    widths: [340, 360, 393],
    measure: `(frame, win, doc) => {
      const buttons = [...doc.querySelectorAll('[data-periods] button')];
      const lines = (el) => { const range = doc.createRange(); range.selectNodeContents(el); return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size; };
      return {
        buttons: buttons.map((el) => ({ text: el.textContent, width: el.getBoundingClientRect().width, top: el.getBoundingClientRect().top, lines: lines(el), fontSize: win.getComputedStyle(el).fontSize, clipped: el.scrollWidth > el.clientWidth + 0.5, client: el.clientWidth, scroll: el.scrollWidth })),
        pageOverflow: doc.scrollingElement.scrollWidth > win.innerWidth
      };
    }`
  });
  for (const result of results) {
    const where = `${result.width}px`;
    assert.equal(result.pageOverflow, false, where);
    assert.deepEqual(result.buttons.map((b) => b.text), ["Today", "This week", "This month"]);
    for (const b of result.buttons) {
      assert.equal(b.lines, 1, `${where}: ${b.text} on one line`);
      assert.equal(b.clipped, false, `${where}: ${b.text} not clipped (${b.scroll}px of text in ${b.client}px)`);
      assert.equal(b.fontSize, "16px", `${where}: ${b.text} is 16px`);
      assert.ok(Math.abs(b.width - result.buttons[0].width) < 1, `${where}: equal widths`);
      assert.ok(Math.abs(b.top - result.buttons[0].top) < 1, `${where}: one row`);
    }
  }
});

test("33 at 340, 360 and 393px: card rows keep label and amount on one line with large amounts, nothing clipped", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)" }, async () => {
  const big = 1234500;
  const { view } = await mount(screenReport({
    moneyIn: big, cashIn: big, momoIn: big, collectedIn: big, givenOnCredit: big, moneySpent: big,
    spentCash: big, spentMomo: big, spentUnrecorded: big, cashShouldHave: -big, momoShouldHave: big
  }));
  setLiveQuery(null);
  const results = measureInFrames({
    pages: [{ name: "33-big", html: toHtml(view.tree) }],
    css: await appCss(),
    widths: [340, 360, 393],
    height: 2000,
    measure: `(frame, win, doc) => {
      const lines = (el) => { const range = doc.createRange(); range.selectNodeContents(el); return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size; };
      const rows = [...doc.querySelectorAll('[data-method-cards] [data-row]')].map((el) => {
        const [label, amount] = el.children;
        const box = el.getBoundingClientRect();
        return { name: el.dataset.row, fontSize: getComputedStyle(amount).fontSize, labelLines: lines(label), text: el.textContent, amountLines: lines(amount), labelRight: label.getBoundingClientRect().right, amountLeft: amount.getBoundingClientRect().left, amountRight: amount.getBoundingClientRect().right, right: box.right };
      });
      return { rows, pageOverflow: doc.scrollingElement.scrollWidth > win.innerWidth };
    }`
  });
  for (const result of results) {
    const where = `${result.width}px`;
    assert.equal(result.pageOverflow, false, `${where}: no horizontal scroll`);
    assert.equal(result.rows.length, 9, `${where}: every row is there (Debts paid and On credit since 15 Nov 2026)`);
    const cash = result.rows.find((row) => row.name === "cash-in");
    for (const name of ["debts-paid", "on-credit"]) {
      const extra = result.rows.find((row) => row.name === name);
      assert.equal(extra.labelLines, 1, `${where}: ${name}: label on one line`);
      assert.equal(extra.fontSize, cash.fontSize, `${where}: ${name}: same size as Cash`);
      assert.ok(Math.abs(extra.amountRight - cash.amountRight) <= 0.5, `${where}: ${name}: same right-hand column as Cash`);
    }
    for (const row of result.rows) {
      assert.equal(row.amountLines, 1, `${where}: ${row.text}: amount on one line`);
      assert.ok(row.labelRight <= row.amountLeft + 0.5, `${where}: ${row.text}: label and amount do not overlap`);
      assert.ok(row.amountRight <= row.right + 0.5, `${where}: ${row.text}: amount inside the card`);
    }
  }
});

// ---- wide layout (D7) ----------------------------------------------------------------------------------------

const WIDE_MEASURE = `(frame, win, doc) => {
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width) }; };
  const q = (s) => doc.querySelector(s);
  return {
    title: box(q("h1")), periods: box(q("[data-periods]")),
    moneyLeft: box(q('[data-block="money-left"]')), profit: box(q('[data-card="profit"]')),
    moneyIn: box(q('[data-card="money-in"]')), moneySpent: box(q('[data-card="money-spent"]')), shouldHave: box(q('[data-card="should-have-left"]')),
    tiles: box(q("[data-tiles]")),
    clipped: [...doc.querySelectorAll("[data-method-cards] strong, [data-method-cards] p")].some((el) => el.scrollWidth > el.clientWidth + 0.5),
    pageOverflow: doc.scrollingElement.scrollWidth > win.innerWidth
  };
}`;

// Since 21 Nov 2026 the layout is decided by layout.js and passed down (no lg: classes): each width is
// rendered with the layout PosApp would pass at that width, then measured in a frame of that width.
test("33 wide (D7) at 1024, 1280 and 1440px: selector top right, Money left beside profit, three cards in one row; 768px keeps the phone layout", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)" }, async () => {
  const css = await appCss();
  const results = [];
  for (const width of [768, 1024, 1280, 1440]) {
    const { view } = await mount(screenReport({ moneyIn: 1234500, spentCash: 1234500 }), { layout: getLayout(width) });
    setLiveQuery(null);
    results.push(...measureInFrames({ pages: [{ name: "33", html: toHtml(view.tree) }], css, widths: [width], height: 1200, measure: WIDE_MEASURE }));
  }
  for (const r of results) {
    const where = `${r.width}px`;
    assert.equal(r.pageOverflow, false, `${where}: no horizontal scroll`);
    assert.equal(r.clipped, false, `${where}: nothing clipped in the cards`);
    if (r.width < 1024) {
      assert.ok(r.periods.top > r.title.top, `${where}: selector under the title (phone layout)`);
      assert.ok(r.moneyIn.top < r.moneySpent.top && r.moneySpent.top < r.shouldHave.top, `${where}: cards stacked`);
      continue;
    }
    assert.ok(r.periods.left > r.title.right, `${where}: selector to the right of the title`);
    assert.ok(r.periods.top < r.moneyLeft.top, `${where}: selector at the top`);
    assert.ok(r.periods.right >= r.moneyIn.left + 2 * r.moneyIn.width, `${where}: selector at the right`);
    assert.equal(r.moneyLeft.top, r.profit.top, `${where}: Money left beside the profit card`);
    assert.ok(r.moneyLeft.right <= r.profit.left, `${where}: Money left on the left`);
    assert.equal(r.moneyIn.top, r.moneySpent.top, `${where}: one row`);
    assert.equal(r.moneySpent.top, r.shouldHave.top, `${where}: one row`);
    assert.ok(r.moneyIn.right <= r.moneySpent.left && r.moneySpent.right <= r.shouldHave.left, `${where}: Money in, Money spent, What you should have left`);
    assert.ok(Math.abs(r.moneyIn.width - r.shouldHave.width) <= 1, `${where}: equal cards`);
    assert.ok(r.moneyIn.top >= r.profit.bottom, `${where}: the cards under the first row`);
    assert.ok(r.tiles.top >= r.shouldHave.bottom, `${where}: the balance tiles last`);
  }
});

test("33 wide: with the profit card hidden, Money left takes the whole first row", async () => {
  const { view } = await mount({ ...screenReport(), showProfit: false }, { layout: getLayout(1280) });
  const block = [...walk(view.tree)].find((node) => node.props?.["data-block"] === "money-left");
  assert.match(block.props.className, /(^|\s)col-span-2(\s|$)/);
  assert.equal([...walk(view.tree)].some((node) => node.props?.["data-card"] === "profit"), false);
});
