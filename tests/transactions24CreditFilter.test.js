import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createPosTransactionRows, describeTransactionRow, filterPosTransactionRows } from "../src/pos/transactionFeed.js";
import { summarizeFinancialTransactions } from "../src/utils/financials.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Wiring 24 (14 Nov 2026): Credit shows every row that changes what people owe (credit-only
// sales, part-paid sales, Added to debt, Payment collected, Balance correction). Sold and Spent
// are unchanged; All shows everything. A correction row is "Balance corrected".
const DAY = Date.UTC(2026, 10, 14, 9, 0);
const records = [
  { id: "cash-sale", type: "sale", amountPesewas: 800, paymentType: "cash", payment_method: "cash", createdAt: DAY + 1 },
  { id: "part-paid", type: "sale", paymentType: "credit", payment_method: "cash", amountPesewas: 800, cashReceivedPesewas: 400, creditExtendedPesewas: 400, customer_name: "ama", createdAt: DAY + 2 },
  { id: "credit-only", type: "sale", paymentType: "credit", amountPesewas: 600, cashReceivedPesewas: 0, creditExtendedPesewas: 600, customer_name: "kojo", createdAt: DAY + 3 },
  { id: "added", type: "manual_debt", amountPesewas: 0, creditExtendedPesewas: 1000, customer_name: "Esi", createdAt: DAY + 4 },
  { id: "collected", type: "income", amountPesewas: 500, payment_method: "cash", note: "Debt payment from Ama", customer_name: "Ama", collectionId: "c1", createdAt: DAY + 5 },
  { id: "corrected", type: "debt_adjustment", amountPesewas: 0, total_amount: 0, payment_method: null, previousBalancePesewas: 600, newBalancePesewas: 0, deltaPesewas: -600, reasonCode: "wrong_amount", reasonNote: "", customer_name: "kojo", createdAt: DAY + 6 },
  { id: "spent", type: "expense", amountPesewas: 300, paidAmountPesewas: 300, category: "transport", createdAt: DAY + 7 }
];
const rows = createPosTransactionRows(records);
const ids = (filter) => filterPosTransactionRows(rows, filter).map(({ id }) => id).sort();

test("All shows every row", () => {
  assert.deepEqual(ids("all"), records.map(({ id }) => id).sort());
});

test("Sold shows the sales only (cash, part-paid and credit-only)", () => {
  assert.deepEqual(ids("sold"), ["cash-sale", "credit-only", "part-paid"]);
});

test("Spent shows money paid out only; a correction moves no money", () => {
  assert.deepEqual(ids("spent"), ["spent"]);
});

test("Credit shows credit-only and part-paid sales, Added to debt, Payment collected and Balance correction", () => {
  assert.deepEqual(ids("credit"), ["added", "collected", "corrected", "credit-only", "part-paid"]);
});

test("a Balance corrected row: lowered amount in plain dark text, person chip with the new balance, reason chip", () => {
  const view = describeTransactionRow(rows.find(({ id }) => id === "corrected"));
  assert.equal(view.title, "Balance corrected");
  assert.equal(view.amountPesewas, 600);
  assert.equal(view.tone, "neutral");
  assert.deepEqual(view.chips, [
    { kind: "person", label: "Kojo owes GH₵0.00 now" },
    { kind: "reason", label: "Wrong amount entered" }
  ]);
  assert.match(view.ariaLabel, /lowered by GH₵6\.00/);
});

test("the reason chip shows the note the merchant typed when there is one", () => {
  const [row] = createPosTransactionRows([{ ...records[5], id: "note", reasonCode: "other", reasonNote: "Counted twice", previousBalancePesewas: 1500, newBalancePesewas: 1000, deltaPesewas: -500 }]);
  const view = describeTransactionRow(row);
  assert.deepEqual(view.chips.map(({ label }) => label), ["Kojo owes GH₵10.00 now", "Counted twice"]);
  assert.equal(view.amountPesewas, 500);
});

test("Money in and Spent tiles equal the sum of the rows; Owed is the owed part of today's sales", () => {
  const totals = summarizeFinancialTransactions(records);
  const views = rows.map((row) => describeTransactionRow(row));
  const sum = (tone) => views.filter((view) => view.tone === tone).reduce((total, view) => total + view.amountPesewas, 0);
  assert.equal(totals.cashInflow, sum("in"));
  assert.equal(totals.expenses, sum("spent"));
  // Current formula (reported, not changed): credit extended by today's sales only.
  assert.equal(totals.newCreditExtended, 400 + 600);
});

let screen;
after(() => setLiveQuery(null));

async function renderScreen(filter) {
  screen ??= (await loadJsx("src/pos/TodaysTransactions.jsx")).default;
  setLiveQuery(() => ({ status: "ready", transactions: rows, totals: summarizeFinancialTransactions(records) }));
  const view = render({ type: screen, props: { onBack() {} } });
  const button = [...walk(view.tree)].find((node) => node.type === "button" && textOf(node) === filter);
  button.props.onClick();
  view.rerender();
  return view;
}

test("rendered Credit list shows the correction row with no sign and no green or red, named 'lowered by'", async () => {
  const view = await renderScreen("Credit");
  const items = [...walk(view.tree)].filter((node) => node.props?.role === "listitem");
  assert.equal(items.length, 5);
  const correction = items.find((node) => textOf(node).startsWith("Balance corrected"));
  assert.ok(correction, "the correction row is under Credit");
  const amount = [...walk(correction)].find((node) => node.props && "data-row-amount" in node.props);
  assert.equal(textOf(amount), "GH₵6.00");
  assert.doesNotMatch(amount.props.className, /03543F|92400E|7F1D1D|emerald|rose|red|green/);
  assert.match(correction.props["aria-label"], /Balance corrected, lowered by GH₵6\.00/);
  assert.match(textOf(correction), /Kojo owes GH₵0\.00 now/);
  assert.match(textOf(correction), /Wrong amount entered/);
});

test("rendered Sold and Spent never show the correction row", async () => {
  for (const filter of ["Sold", "Spent"]) {
    const view = await renderScreen(filter);
    assert.doesNotMatch(textOf(view.tree), /Balance corrected/, filter);
  }
});