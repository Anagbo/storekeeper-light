import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale, recordDebtCollection } from "../src/db/debts.js";
import { addDueCycles, prepareInstallmentPlan } from "../src/utils/installments.js";

// Owner replay (11 Nov 2026), "amos": a GH₵855.00 credit sale on 05/11 with a GH₵20.00 weekly
// plan, a GH₵6.00 collection, then a GH₵5.00 credit sale with "First payment Today" paying
// GH₵20.00 (GH₵5.00 for the sale, GH₵15.00 against the old debt). Built the way 19 builds it.
//
// Finding (not fixed, owner decision): the writer stores totalInstallments 44 and
// installmentsRemaining 42 (so "2 paid") and moves the next date from the chosen 18/11 to
// 25/11. reconcileInstallmentPlanChange counts today's GH₵15.00 twice: once in
// replacementPlan.totalInstallments (prepareInstallmentPlan adds 1 for the payment today) and
// once in completedCycles (carry GH₵6.00 + GH₵15.00 = one whole installment). Screens no longer
// read these counters; they come from money (getPlanProgress).
after(async () => {
  db.close();
  await db.delete();
});
beforeEach(async () => {
  await Promise.all([db.debts, db.customers, db.transactions, db.payments].map((table) => table.clear()));
});

export async function replayAmos() {
  const first = prepareInstallmentPlan({
    amountPesewas: 85500, installmentAmountPesewas: 2000, frequency: "weekly", nextDueDate: "2026-11-12"
  });
  const { debtId } = await recordCreditSale({ name: "amos", amountPesewas: 85500, installmentPlan: first.plan });
  await recordDebtCollection({ debtId, parts: [{ paymentMethod: "cash", amountPesewas: 600 }] });
  // 19 for the GH₵5.00 sale: owed 849 + 5 = 854, Today, GH₵20.00 paid today, next date a week on.
  const chosenNext = addDueCycles("2026-11-11", "weekly", 1);
  const prepared = prepareInstallmentPlan({
    amountPesewas: 85400, installmentAmountPesewas: 2000, frequency: "weekly",
    nextDueDate: "2026-11-11", startToday: true, initialPaymentLimitPesewas: 2000
  });
  await recordCreditSale({
    name: "amos", amountPesewas: 500,
    installmentPlan: { ...prepared.plan, nextDueDate: chosenNext },
    initialPaymentPesewas: prepared.initialPaymentPesewas,
    initialPaymentParts: [{ paymentMethod: "cash", amountPesewas: prepared.initialPaymentPesewas }]
  });
  return { stored: await db.debts.get(debtId), chosenNext };
}

test("amos replay: balance GH₵834.00; the writer's counters as found on 11 Nov 2026", async () => {
  const { stored, chosenNext } = await replayAmos();
  assert.equal(stored.amountPesewas, 83400);
  assert.equal(chosenNext, "2026-11-18");
  // Recorded, not endorsed: these are the double count described above.
  assert.equal(stored.totalInstallments, 44);
  assert.equal(stored.installmentsRemaining, 42);
  assert.equal(stored.installmentPaymentCarryPesewas, 100);
  assert.equal(stored.nextDueDate, "2026-11-25");
});