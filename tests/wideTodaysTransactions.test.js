import "fake-indexeddb/auto";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createPosTransactionRows, filterPosTransactionRows } from "../src/pos/transactionFeed.js";
import { summarizeFinancialTransactions } from "../src/utils/financials.js";
import { getLayout } from "../src/pos/layout.js";
import { db } from "../src/db/db.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Wiring 24 wide (D4): the same rows as the phone in one table, every amount in its own column,
// a "Total today" row equal to the three cards. Wide only.
after(async () => { db.close(); await db.delete(); });

const DAY = Date.UTC(2026, 10, 14, 9, 0);
const records = [
  { id: "cash-sale", type: "sale", amountPesewas: 800, paymentType: "cash", payment_method: "cash", createdAt: DAY + 1 },
  { id: "part-paid", type: "sale", paymentType: "credit", payment_method: "cash", amountPesewas: 1300, cashReceivedPesewas: 800, creditExtendedPesewas: 500, customer_name: "ama", createdAt: DAY + 2 },
  { id: "credit-only", type: "sale", paymentType: "credit", amountPesewas: 600, cashReceivedPesewas: 0, creditExtendedPesewas: 600, customer_name: "kojo", createdAt: DAY + 3 },
  { id: "added", type: "manual_debt", amountPesewas: 0, creditExtendedPesewas: 1000, customer_name: "Esi", createdAt: DAY + 4 },
  { id: "collected", type: "income", amountPesewas: 500, payment_method: "cash", note: "Debt payment from Ama", customer_name: "Ama", collectionId: "c1", createdAt: DAY + 5 },
  { id: "corrected", type: "debt_adjustment", amountPesewas: 0, total_amount: 0, payment_method: null, previousBalancePesewas: 600, newBalancePesewas: 0, deltaPesewas: -600, reasonCode: "wrong_amount", reasonNote: "", customer_name: "kojo", createdAt: DAY + 6 },
  { id: "spent", type: "expense", amountPesewas: 300, paidAmountPesewas: 300, category: "transport", createdAt: DAY + 7 },
  { id: "stock-credit", type: "expense", amountPesewas: 700, paidAmountPesewas: 0, owedAmountPesewas: 700, category: "stock", createdAt: DAY + 8 }
];
const rows = createPosTransactionRows(records);
const totals = summarizeFinancialTransactions(records);

const all = (tree, match) => [...walk(tree)].filter((node) => node.props && match(node));
const cell = (tr, name) => textOf(all(tr, (n) => n.props["data-cell"] === name)[0]);

async function mount(layout, data = rows) {
  const { default: TodaysTransactions } = await loadJsx("src/pos/TodaysTransactions.jsx");
  setLiveQuery(() => ({ status: "ready", transactions: data, totals }));
  try {
    return render({ type: TodaysTransactions, props: { onBack() {}, layout } }).tree;
  } finally {
    setLiveQuery(null);
  }
}
const bodyRows = (view) => all(view, (n) => n.type === "tr" && n.props["data-wide-row"] !== undefined);
const byKind = (view, id) => bodyRows(view).find((tr) => tr.props["data-row-id"] === id);

for (const width of [768, 1024, 1280, 1440]) {
  test(`wide ${width}: columns, each row kind in the right column, part-paid example, total equals the cards`, async () => {
    const view = await mount(getLayout(width));
    const heads = all(view, (n) => n.type === "th" && n.props.scope === "col").map((th) => textOf(th));
    assert.deepEqual(heads, ["Time", "What", "Money in", "Spent", "On credit"]);

    const part = byKind(view, "part-paid");
    assert.equal(cell(part, "money-in"), "+GH₵8.00");
    assert.equal(cell(part, "owed"), "GH₵5.00");
    assert.equal(cell(part, "spent"), "—");
    assert.match(cell(part, "what"), /^Sale of GH₵13.00Ama.*Cash GH₵8.00/);

    assert.equal(cell(byKind(view, "cash-sale"), "money-in"), "+GH₵8.00");
    assert.equal(cell(byKind(view, "credit-only"), "owed"), "GH₵6.00");
    assert.equal(cell(byKind(view, "added"), "owed"), "GH₵10.00");
    assert.equal(cell(byKind(view, "collected"), "money-in"), "+GH₵5.00");
    const spent = byKind(view, "spent");
    assert.equal(cell(spent, "spent"), "−GH₵3.00");
    assert.match(cell(spent, "what"), /Transport/);
    const stock = byKind(view, "stock-credit");
    assert.equal(cell(stock, "spent"), "—");
    assert.equal(cell(stock, "owed"), "—");
    assert.equal(cell(stock, "money-in"), "—");
    const stockChip = all(stock, (n) => n.props["data-chip"] === "person")[0];
    assert.equal(textOf(stockChip), "You owe Supplier GH₵7.00");
    assert.equal(stockChip.props["data-owes"], "true");
    const fix = byKind(view, "corrected");
    assert.equal(cell(fix, "owed"), "GH₵6.00");
    assert.equal(cell(fix, "money-in"), "—");
    assert.equal(all(fix, (n) => n.props["data-cell"] === "owed")[0].props.className.includes("text-slate-800"), true);

    const total = all(view, (n) => n.props["data-wide-total"] !== undefined)[0];
    assert.equal(cell(total, "total-money-in"), `GH₵${(totals.cashInflow / 100).toFixed(2)}`);
    assert.equal(cell(total, "total-spent"), `GH₵${(totals.expenses / 100).toFixed(2)}`);
    assert.equal(cell(total, "total-owed"), `GH₵${(totals.creditGiven / 100).toFixed(2)}`);
    const cards = Object.fromEntries(all(view, (n) => n.props["data-summary"] !== undefined).map((n) => [n.props["data-summary"], textOf(n)]));
    assert.match(cards["money-in"], /GH₵21\.00/);
    assert.match(cards.spent, /GH₵3\.00/);
    assert.match(cards["given-on-credit"], /GH₵21\.00/);
  });
}

test("wide: rows are not buttons or focusable; filters keep working; an empty filter says Nothing here yet today.", async () => {
  const view = await mount(getLayout(1280));
  for (const tr of bodyRows(view)) {
    assert.equal(tr.props.tabIndex, undefined);
    assert.equal(tr.props.onClick, undefined);
    assert.equal(all(tr, (n) => n.type === "button" || n.type === "a").length, 0);
  }
  assert.equal(all(view, (n) => n.type === "button" && ["All", "Sold", "Spent", "Credit"].includes(textOf(n))).length, 4);
  assert.deepEqual(["all", "sold", "spent", "credit"].map((filter) => filterPosTransactionRows(rows, filter).length), [8, 3, 1, 6]);
  const empty = await mount(getLayout(1280), []);
  assert.equal(textOf(all(empty, (n) => n.props["data-empty"] !== undefined)[0]), "Nothing here yet today.");
  assert.equal(all(empty, (n) => n.type === "table").length, 0);
});

test("the phone does not get the table", async () => {
  const view = await mount(getLayout(390));
  assert.equal(all(view, (n) => n.type === "table").length, 0);
  assert.equal(all(view, (n) => n.type === "article").length, rows.length);
});
