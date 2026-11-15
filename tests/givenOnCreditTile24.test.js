import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createPosTransactionRows, describeTransactionRow } from "../src/pos/transactionFeed.js";
import { summarizeFinancialTransactions } from "../src/utils/financials.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Wiring 24 "Given on credit tile": owed part of today's credit, part-paid and installment sales
// plus Added to debt rows. Collections, corrections and stock bought on credit are not in it.
const DAY = Date.UTC(2026, 10, 14, 9, 0);
const records = {
  credit: { id: "credit", type: "sale", paymentType: "credit", amountPesewas: 600, cashReceivedPesewas: 0, creditExtendedPesewas: 600, customer_name: "kojo", createdAt: DAY + 1 },
  partPaid: { id: "part", type: "sale", paymentType: "credit", payment_method: "cash", amountPesewas: 800, cashReceivedPesewas: 300, creditExtendedPesewas: 500, customer_name: "ama", createdAt: DAY + 2 },
  installment: { id: "inst", type: "installment_sale", payment_method: "cash", amountPesewas: 2000, cashReceivedPesewas: 700, momoReceivedPesewas: 0, creditExtendedPesewas: 1300, customer_name: "esi", createdAt: DAY + 3 },
  added: { id: "added", type: "manual_debt", amountPesewas: 0, creditExtendedPesewas: 1000, customer_name: "Esi", createdAt: DAY + 4 },
  collection: { id: "coll", type: "income", amountPesewas: 500, payment_method: "cash", note: "Debt payment from Ama", customer_name: "Ama", collectionId: "c1", createdAt: DAY + 5 },
  correction: { id: "corr", type: "debt_adjustment", amountPesewas: 0, total_amount: 0, payment_method: null, previousBalancePesewas: 600, newBalancePesewas: 0, deltaPesewas: -600, reasonCode: "wrong_amount", reasonNote: "", customer_name: "kojo", createdAt: DAY + 6 },
  stock: { id: "stock", type: "expense", amountPesewas: 900, paidAmountPesewas: 0, category: "stock", supplierId: "s1", createdAt: DAY + 7 }
};

// The tile must equal the sum of the owed parts shown in the rows above it.
function rowsOwedSum(list) {
  return createPosTransactionRows(list).reduce((sum, row) => sum + (row.kind === "debt_added" ? row.amountPesewas : row.kind === "sold" ? row.owedPesewas : 0), 0);
}
function check(list, expected) {
  assert.equal(summarizeFinancialTransactions(list).creditGiven, expected);
  assert.equal(rowsOwedSum(list), expected);
}

test("a credit sale: the tile is its owed amount", () => check([records.credit], 600));
test("a part-paid sale: only the owed part, not the sale or the payment", () => check([records.partPaid], 500));
test("an installment sale: its owed part", () => check([records.installment], 1300));
test("an Added to debt row counts", () => check([records.added], 1000));
test("a collection is not subtracted", () => check([records.credit, records.collection], 600));
test("a correction is not subtracted", () => check([records.credit, records.correction], 600));
test("stock bought on credit is not counted", () => check([records.credit, records.stock], 600));
test("everything together", () => check(Object.values(records), 600 + 500 + 1300 + 1000));
test("no records: zero", () => check([], 0));
test("newCreditExtended (profit basis) is unchanged by Added to debt", () => {
  assert.equal(summarizeFinancialTransactions(Object.values(records)).newCreditExtended, 600 + 500 + 1300);
});

let screen;
after(() => setLiveQuery(null));
test("the screen shows 'Given on credit' with the total, no 'Owed' tile", async () => {
  const list = Object.values(records);
  screen ??= (await loadJsx("src/pos/TodaysTransactions.jsx")).default;
  setLiveQuery(() => ({ status: "ready", transactions: createPosTransactionRows(list), totals: summarizeFinancialTransactions(list) }));
  const view = render({ type: screen, props: { onBack() {} } });
  const tile = [...walk(view.tree)].find((n) => n.props?.["data-summary"] === "given-on-credit");
  assert.match(textOf(tile), /^Given on credit/);
  assert.match(textOf(tile), /GH₵34\.00$/);
  assert.equal([...walk(view.tree)].some((n) => n.props?.["data-summary"] === "owed"), false);
  void describeTransactionRow;
});
