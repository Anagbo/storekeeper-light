import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale, recordDebtCollection, undoDebtCollection } from "../src/db/debts.js";
import { correctDebtBalance } from "../src/db/debtLedger.js";
import { calculateLedgerEventBalance, getCustomerLedgerRecords } from "../src/utils/debtLedgerMath.js";
import { checkLedgerConsistency } from "../src/utils/consistency.js";
import { summarizePosMoney } from "../src/utils/financials.js";
import { createPosTransactionRows } from "../src/pos/transactionFeed.js";
import { loadCustomerHistory } from "../src/utils/loadCustomerDebtHistory.js";
import { localDateString } from "../src/utils/installments.js";

// Owner rule (2026-11-10): a credit sale adds only its Owe part to the account history.
// Money paid at the sale is part of the sale, not a debt payment. One shared rule
// (debtLedgerMath.js) is used by the history, the ledger check, Correct balance and the
// consistency check. Stored records, writers, money totals and sync are not changed.

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  await Promise.all([db.debts, db.customers, db.transactions, db.payments].map((table) => table.clear()));
});

const splitParts = [
  { paymentMethod: "cash", amountPesewas: 200 },
  { paymentMethod: "momo", amountPesewas: 400 }
];

function summary(events) {
  return events.map((event) => `${event.type}:${event.amountPesewas}`).sort();
}

async function ledgerBalance(customerId, customerName) {
  const records = getCustomerLedgerRecords({
    customerId,
    customerName,
    debts: await db.debts.toArray(),
    transactions: await db.transactions.toArray(),
    payments: await db.payments.toArray()
  });
  return calculateLedgerEventBalance(records.transactions, records.payments).balancePesewas;
}

async function expectConsistent() {
  const report = await checkLedgerConsistency();
  assert.deepEqual(report.issues.filter((issue) => issue.code === "debt_balance_mismatch"), []);
}

test("split sale GH₵8.00 (Cash 2, MoMo 4, Owe 2): history shows only Added to debt GH₵2.00", async () => {
  const sale = await recordCreditSale({
    amountPesewas: 800, name: "Esi Split", initialPaymentPesewas: 600, initialPaymentParts: splitParts, paymentMethod: "momo"
  });
  const history = await loadCustomerHistory(sale.customerId, "Esi Split");
  assert.deepEqual(summary(history.events), ["credit:200"], "one credit event of the Owe part, no Paid rows for the sale");
  assert.equal(history.currentBalancePesewas, 200);
  assert.equal(history.totalCreditPesewas, 200);
  assert.equal(history.totalPaidPesewas, 0, "money paid at the sale is not a debt payment");
  assert.equal(history.unaccountedCreditPesewas, 0);
  assert.equal(await ledgerBalance(sale.customerId, "Esi Split"), 200);
  await expectConsistent();

  // Correct balance accepts the customer under the same rule.
  const debt = await db.debts.get(sale.debtId);
  await correctDebtBalance({ debtId: sale.debtId, expectedUpdatedAt: debt.updatedAt, newBalancePesewas: 100, reasonCode: "wrong_amount" });
  const corrected = await loadCustomerHistory(sale.customerId, "Esi Split");
  assert.deepEqual(summary(corrected.events), ["adjustment:100", "credit:200"]);
  assert.equal(corrected.unaccountedCreditPesewas, 0);
  await expectConsistent();
});

test("stored records are unchanged: the sale keeps its gross amount and its payment rows", async () => {
  const sale = await recordCreditSale({
    amountPesewas: 800, name: "Esi Records", initialPaymentPesewas: 600, initialPaymentParts: splitParts, paymentMethod: "momo"
  });
  const record = await db.transactions.get(sale.transactionId);
  assert.equal(record.creditSaleGrossPesewas, 800);
  assert.equal(record.creditExtendedPesewas, 200);
  const rows = await db.payments.filter((row) => row.transactionId === sale.transactionId).toArray();
  assert.deepEqual(rows.map((row) => `${row.paymentMethod}:${row.amountPesewas}`).sort(), ["cash:200", "momo:400"]);
});

test("money totals and Today's transactions count the split sale once (unchanged)", async () => {
  await recordCreditSale({
    amountPesewas: 800, name: "Esi Money", initialPaymentPesewas: 600, initialPaymentParts: splitParts, paymentMethod: "momo"
  });
  const transactions = await db.transactions.toArray();
  const totals = summarizePosMoney(transactions);
  assert.equal(totals.moneyIn, 600);
  assert.equal(totals.cashIn, 200);
  assert.equal(totals.momoIn, 400);
  assert.equal(totals.moneySpent, 0);
  assert.equal(totals.sales, 800);
  const rows = createPosTransactionRows(transactions);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amountPesewas, 800);
  assert.equal(rows[0].cashPesewas, 200);
  assert.equal(rows[0].momoPesewas, 400);
  assert.equal(rows[0].owedPesewas, 200);
});

test("19 with a payment today and a plan: plan sized on the Owe part, history shows only that part", async () => {
  const nextDueDate = localDateString(new Date(Date.now() + 7 * 86_400_000));
  const sale = await recordCreditSale({
    amountPesewas: 800,
    name: "Kofi Plan",
    initialPaymentPesewas: 600,
    paymentMethod: "cash",
    installmentPlan: {
      isInstallmentPlan: true, installmentAmount: 100, frequency: "weekly", nextDueDate,
      installmentsRemaining: 2, totalInstallments: 2, installmentPaymentCarryPesewas: 0
    }
  });
  const debt = await db.debts.get(sale.debtId);
  assert.equal(debt.amountPesewas, 200);
  assert.equal(debt.installmentsRemaining, 2);
  const history = await loadCustomerHistory(sale.customerId, "Kofi Plan");
  assert.deepEqual(summary(history.events), ["credit:200"]);
  assert.equal(history.unaccountedCreditPesewas, 0);
  assert.equal(await ledgerBalance(sale.customerId, "Kofi Plan"), 200);
  await expectConsistent();
});

test("pure Owe sale: Added to debt is the whole sale (unchanged)", async () => {
  const sale = await recordCreditSale({ amountPesewas: 800, name: "Yaw Owe" });
  const history = await loadCustomerHistory(sale.customerId, "Yaw Owe");
  assert.deepEqual(summary(history.events), ["credit:800"]);
  assert.equal(history.unaccountedCreditPesewas, 0);
  await expectConsistent();
});

test("customer who already owed: the split sale adds only its Owe part", async () => {
  await recordCreditSale({ amountPesewas: 500, name: "Ama Addon" });
  const sale = await recordCreditSale({
    amountPesewas: 800, name: "Ama Addon", initialPaymentPesewas: 600, initialPaymentParts: splitParts, paymentMethod: "momo"
  });
  const history = await loadCustomerHistory(sale.customerId, "Ama Addon");
  assert.deepEqual(summary(history.events), ["addon:200", "credit:500"]);
  assert.equal(history.currentBalancePesewas, 700);
  assert.equal(history.unaccountedCreditPesewas, 0);
  assert.equal(await ledgerBalance(sale.customerId, "Ama Addon"), 700);
  await expectConsistent();
});

test("sale fully paid on 19 that also pays older debt: only the extra collection shows", async () => {
  await recordCreditSale({ amountPesewas: 500, name: "Akua Over" });
  const sale = await recordCreditSale({ amountPesewas: 800, name: "Akua Over", initialPaymentPesewas: 1000, paymentMethod: "cash" });
  const history = await loadCustomerHistory(sale.customerId, "Akua Over");
  assert.deepEqual(summary(history.events), ["credit:500", "payment:200"]);
  assert.equal(history.currentBalancePesewas, 300);
  assert.equal(history.unaccountedCreditPesewas, 0);
  assert.equal(await ledgerBalance(sale.customerId, "Akua Over"), 300);
  await expectConsistent();
});

test("collect then Undo after a split sale still reconciles (D15)", async () => {
  const sale = await recordCreditSale({
    amountPesewas: 800, name: "Abena Undo", initialPaymentPesewas: 600, initialPaymentParts: splitParts, paymentMethod: "momo"
  });
  const collection = await recordDebtCollection({ debtId: sale.debtId, parts: [{ paymentMethod: "cash", amountPesewas: 100 }] });
  const collected = await loadCustomerHistory(sale.customerId, "Abena Undo");
  assert.deepEqual(summary(collected.events), ["credit:200", "payment:100"], "a real collection still shows as Paid");
  await undoDebtCollection({ collectionId: collection.collectionId, now: collection.createdAt + 1000 });

  const debt = await db.debts.get(sale.debtId);
  assert.equal(debt.amountPesewas, 200);
  assert.equal(await ledgerBalance(sale.customerId, "Abena Undo"), 200);
  await correctDebtBalance({ debtId: sale.debtId, expectedUpdatedAt: debt.updatedAt, newBalancePesewas: 150, reasonCode: "wrong_amount" });
  assert.equal((await db.debts.get(sale.debtId)).amountPesewas, 150);
  const history = await loadCustomerHistory(sale.customerId, "Abena Undo");
  assert.deepEqual(summary(history.events), ["adjustment:50", "credit:200"]);
  assert.equal(history.unaccountedCreditPesewas, 0);
  await expectConsistent();
});

test("old records keep their reading", async () => {
  await db.customers.add({ id: "c-old", name: "Old Esi", nameLower: "old esi", totalDebtPesewas: 1000 });
  await db.debts.bulkAdd([
    { id: "d-old-1", customerId: "c-old", customerName: "Old Esi", status: "unpaid", amountPesewas: 800 },
    { id: "d-old-2", customerId: "c-old", customerName: "Old Esi", status: "unpaid", amountPesewas: 200 }
  ]);
  await db.transactions.bulkAdd([
    // No creditSaleGrossPesewas: the older reading (amount minus the deposit) is unchanged.
    { id: "t-old-1", type: "installment_sale", customerId: "c-old", customer_name: "Old Esi", amountPesewas: 1000, installmentPaymentPesewas: 200, cashReceivedPesewas: 200, createdAt: 10 },
    // Gross sale whose paid-at-sale rows are not linked to it: still read as gross credit plus Paid rows.
    { id: "t-old-2", type: "installment_sale", customerId: "c-old", customer_name: "Old Esi", amountPesewas: 800, creditSaleGrossPesewas: 800, creditExtendedPesewas: 200, installmentPaymentPesewas: 600, cashReceivedPesewas: 600, momoReceivedPesewas: 0, createdAt: 20 }
  ]);
  await db.payments.add({ id: "p-old", customerId: "c-old", debtId: "d-old-2", amountPesewas: 600, paymentMethod: "cash", createdAt: 20 });

  const history = await loadCustomerHistory("c-old", "Old Esi");
  // Today's output for these records, pinned: the legacy sale shows its deposit as a Paid row,
  // the unlinked gross sale shows gross credit and its Paid row.
  assert.deepEqual(summary(history.events), ["credit:800", "credit:800", "payment:200", "payment:600"]);
  assert.equal(await ledgerBalance("c-old", "Old Esi"), 1000);
});
