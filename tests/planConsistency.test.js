import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { checkLedgerConsistency } from "../src/utils/consistency.js";
import { localDateString } from "../src/utils/installments.js";

// Owner rule (11 Nov 2026): the stored totalInstallments is no longer checked against the
// payments left (screens work from money). The stored fields stay in records and backups.
after(async () => {
  db.close();
  await db.delete();
});
beforeEach(async () => {
  await Promise.all([db.debts, db.customers, db.transactions, db.payments].map((table) => table.clear()));
});

const plan = {
  isInstallmentPlan: true, installmentAmount: 1000, frequency: "weekly", nextDueDate: localDateString(),
  installmentsRemaining: 3, totalInstallments: 3, installmentPaymentCarryPesewas: 0
};
const scheduleIssues = (report) => report.issues.filter((issue) => issue.code === "installment_schedule_mismatch");

test("a stored total below the payments left is not an issue; the fields stay on the record", async () => {
  const { debtId } = await recordCreditSale({ name: "Ama", amountPesewas: 3000, installmentPlan: plan });
  await db.debts.update(debtId, { totalInstallments: 1 });
  assert.deepEqual(scheduleIssues(await checkLedgerConsistency(db)), []);
  const stored = await db.debts.get(debtId);
  assert.equal(stored.totalInstallments, 1);
  assert.equal(stored.installmentsRemaining, 3);
});

test("payments left that do not match the balance is still an issue", async () => {
  const { debtId } = await recordCreditSale({ name: "Ama", amountPesewas: 3000, installmentPlan: plan });
  await db.debts.update(debtId, { installmentsRemaining: 5 });
  assert.equal(scheduleIssues(await checkLedgerConsistency(db)).length, 1);
});
