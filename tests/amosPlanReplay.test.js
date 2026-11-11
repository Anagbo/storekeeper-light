import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { replayAmos } from "./helpers/amosReplay.js";

// Finding (not fixed, owner decision): for the amos replay (see the helper) the writer stores
// totalInstallments 44 and installmentsRemaining 42 (so "2 paid") and moves the next date from
// the chosen 18/11 to 25/11. reconcileInstallmentPlanChange counts today's GH₵15.00 twice: once
// in replacementPlan.totalInstallments (prepareInstallmentPlan adds 1 for the payment today) and
// once in completedCycles (carry GH₵6.00 + GH₵15.00 = one whole installment). Screens no longer
// read these counters; they come from money (getPlanProgress, tests/planProgress.test.js).
after(async () => {
  db.close();
  await db.delete();
});
beforeEach(async () => {
  await Promise.all([db.debts, db.customers, db.transactions, db.payments].map((table) => table.clear()));
});

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