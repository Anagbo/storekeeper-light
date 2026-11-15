import test from "node:test";
import assert from "node:assert/strict";
import { createPosTransactionRows, filterPosTransactionRows } from "../src/pos/transactionFeed.js";

test("transaction rows sort newest first and preserve sale, credit, and spending parts", () => {
  const rows = createPosTransactionRows([
    { id: "cash", type: "sale", amountPesewas: 800, paymentType: "cash", createdAt: 200 },
    { id: "credit", type: "sale", amountPesewas: 1200, paymentType: "credit", creditExtendedPesewas: 1200, customerName: "Ama", createdAt: 300 },
    { id: "expense", type: "expense", amountPesewas: 1000, paidAmountPesewas: 700, note: "Transport", createdAt: 100 }
  ]);

  assert.deepEqual(rows.map(({ id }) => id), ["credit", "cash", "expense"]);
  assert.equal(rows[0].kind, "sold");
  assert.equal(rows[0].amountPesewas, 1200);
  assert.equal(rows[0].owedPesewas, 1200);
  assert.equal(rows[0].customerName, "Ama");
  assert.equal(rows[2].amountPesewas, 700);
  assert.equal(rows[2].kind, "spent");
});

test("installment sale rows preserve split cash and MoMo amounts", () => {
  const [row] = createPosTransactionRows([{
    id: "split-installment",
    type: "installment_sale",
    amountPesewas: 10000,
    installmentPaymentPesewas: 10000,
    cashReceivedPesewas: 3000,
    momoReceivedPesewas: 7000,
    creditExtendedPesewas: 0,
    createdAt: 100
  }]);

  assert.equal(row.cashReceivedPesewas, 10000);
  assert.equal(row.cashPesewas, 3000);
  assert.equal(row.momoPesewas, 7000);
});

test("transaction filters distinguish sold, spent, and credit rows", () => {
  const rows = createPosTransactionRows([
    { id: "cash", type: "sale", amountPesewas: 800, paymentType: "cash", createdAt: 100 },
    { id: "credit", type: "sale", amountPesewas: 1200, paymentType: "credit", createdAt: 200 },
    { id: "expense", type: "expense", amountPesewas: 300, createdAt: 300 }
  ]);

  assert.deepEqual(filterPosTransactionRows(rows, "sold").map(({ id }) => id), ["credit", "cash"]);
  assert.deepEqual(filterPosTransactionRows(rows, "spent").map(({ id }) => id), ["expense"]);
  assert.deepEqual(filterPosTransactionRows(rows, "credit").map(({ id }) => id), ["credit"]);
  assert.equal(filterPosTransactionRows(rows, "all").length, 3);
  assert.throws(() => filterPosTransactionRows(rows, "unknown"), /Unknown transaction filter/);
});

test("transaction feed displays debt adjustments without classifying them as cash or credit", () => {
  const [row] = createPosTransactionRows([{
    id: "adjustment-1",
    type: "debt_adjustment",
    amountPesewas: 0,
    deltaPesewas: -2500,
    createdAt: 100
  }]);

  assert.equal(row.kind, "adjustment");
  assert.equal(row.amountPesewas, 0);
  assert.equal(row.adjustmentDeltaPesewas, -2500);
  assert.equal(row.cashPesewas, 0);
  assert.equal(row.momoPesewas, 0);
  assert.equal(row.isCredit, false);
});

test("manual debt rows use the credit amount and remain visible as added debt", () => {
  const [row] = createPosTransactionRows([{
    id: "manual-debt-1",
    type: "manual_debt",
    amountPesewas: 0,
    creditExtendedPesewas: 10000,
    customerName: "Ama",
    createdAt: 100
  }]);

  assert.equal(row.kind, "debt_added");
  assert.equal(row.amountPesewas, 10000);
  assert.equal(row.isCredit, true);
  assert.equal(row.customerName, "Ama");
  assert.deepEqual(filterPosTransactionRows([row], "credit").map(({ id }) => id), ["manual-debt-1"]);
});

test("supplier payments appear as spending, separate from the stock purchase", () => {
  const rows = createPosTransactionRows([
    { id: "stock", type: "expense", category: "stock", amountPesewas: 5000, paidAmountPesewas: 0, createdAt: 100 },
    { id: "payment", type: "supplier_payment", amountPesewas: 2000, note: "Payment to supplier", createdAt: 200 }
  ]);
  assert.deepEqual(rows.map(({ kind, amountPesewas }) => [kind, amountPesewas]), [
    ["spent", 2000],
    ["credit", 5000]
  ]);
});

test("transaction rows reject invalid dates and money rather than misreporting", () => {
  assert.throws(() => createPosTransactionRows([
    { id: "bad-money", type: "sale", amountPesewas: 1.5, createdAt: 100 }
  ]), /invalid pesewa amount/);
  assert.throws(() => createPosTransactionRows([
    { id: "bad-time", type: "sale", amountPesewas: 100, createdAt: "not-a-date" }
  ]), /invalid timestamp/);
});

test("reversed collection entries are removed from the daily feed", () => {
  const rows = createPosTransactionRows([
    { id: "cash-part", type: "income", amountPesewas: 1250, payment_method: "cash", collectionId: "collection-1", createdAt: 100 },
    { id: "momo-part", type: "income", amountPesewas: 2750, payment_method: "momo", collectionId: "collection-1", createdAt: 100 },
    { id: "cash-reversal", type: "income_reversal", amountPesewas: 1250, reversalOfCollectionId: "collection-1", reversalOfTransactionId: "cash-part", createdAt: 200 },
    { id: "momo-reversal", type: "income_reversal", amountPesewas: 2750, reversalOfCollectionId: "collection-1", reversalOfTransactionId: "momo-part", createdAt: 200 }
  ]);

  assert.deepEqual(rows, []);
});

test("split collections render as one row with method totals", () => {
  const rows = createPosTransactionRows([
    { id: "cash-part", type: "income", amountPesewas: 1250, payment_method: "cash", collectionId: "collection-1", note: "Debt payment from Ama", createdAt: 100 },
    { id: "momo-part", type: "income", amountPesewas: 2750, payment_method: "momo", collectionId: "collection-1", note: "Debt payment from Ama", createdAt: 100 }
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].amountPesewas, 4000);
  assert.equal(rows[0].cashPesewas, 1250);
  assert.equal(rows[0].momoPesewas, 2750);
});
