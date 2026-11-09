import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale, recordDebtCollection, undoDebtCollection } from "../src/db/debts.js";
import { correctDebtBalance } from "../src/db/debtLedger.js";
import { calculateLedgerEventBalance } from "../src/utils/debtLedgerMath.js";

after(async () => {
  db.close();
  await db.delete();
});

const credit = { id: "sale-1", type: "credit_sale", amountPesewas: 5000, creditExtendedPesewas: 5000 };
const income = { id: "inc-1", type: "income", amountPesewas: 2000 };
const paymentRow = { id: "pay-1", amountPesewas: 2000, transactionId: "inc-1" };

test("D15: a payment whose income was reversed by Undo no longer counts in the ledger balance", () => {
  assert.equal(calculateLedgerEventBalance([credit, income], [paymentRow]), 3000);
  const reversal = { id: "rev-1", type: "income_reversal", amountPesewas: 2000, reversalOfTransactionId: "inc-1" };
  assert.equal(calculateLedgerEventBalance([credit, income, reversal], [paymentRow]), 5000);
});

test("D15: a reversal of a different payment does not hide this one", () => {
  const otherReversal = { id: "rev-2", type: "income_reversal", amountPesewas: 2000, reversalOfTransactionId: "inc-other" };
  assert.equal(calculateLedgerEventBalance([credit, income, otherReversal], [paymentRow]), 3000);
});

test("D15: after collect then Undo, the balance can still be corrected (events reconcile)", async () => {
  const sale = await recordCreditSale({ amountPesewas: 5000, name: "Abena Undo" });
  const collection = await recordDebtCollection({ debtId: sale.debtId, parts: [{ paymentMethod: "cash", amountPesewas: 2000 }] });
  await undoDebtCollection({ collectionId: collection.collectionId, now: collection.createdAt + 1000 });

  const debt = await db.debts.get(sale.debtId);
  assert.equal(debt.amountPesewas, 5000);
  // The undone payment row stays in place: the ledger is append-only.
  assert.equal(await db.payments.filter((row) => row.collectionId === collection.collectionId).count(), 1);

  await correctDebtBalance({
    debtId: sale.debtId,
    expectedUpdatedAt: debt.updatedAt,
    newBalancePesewas: 4000,
    reasonCode: "wrong_amount"
  });
  assert.equal((await db.debts.get(sale.debtId)).amountPesewas, 4000);
});