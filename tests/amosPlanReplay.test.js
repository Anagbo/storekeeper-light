import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { getCustomerLedgerRecords, getPlanPaidPesewas } from "../src/utils/debtLedgerMath.js";
import { getPlanProgress, reconcileInstallmentPlanChange } from "../src/utils/installments.js";
import { replayAmos } from "./helpers/amosReplay.js";

// amos replay (see the helper). Before the fix the writer stored totalInstallments 44: today's
// GH₵15.00 against the old debt was counted twice, once in replacementPlan.totalInstallments
// (prepareInstallmentPlan adds 1 for the payment today) and once in completedCycles (carry
// GH₵6.00 + GH₵15.00 = one whole installment). Now it is counted once.
after(async () => {
  db.close();
  await db.delete();
});
beforeEach(async () => {
  await Promise.all([db.debts, db.customers, db.transactions, db.payments].map((table) => table.clear()));
});

// The debt before the GH₵5.00 sale: GH₵849.00 left, GH₵6.00 paid toward the 12/11 installment.
const amosBefore = {
  isInstallmentPlan: true, amountPesewas: 84900, installmentAmount: 2000, frequency: "weekly",
  nextDueDate: "2026-11-12", installmentsRemaining: 43, totalInstallments: 43, installmentPaymentCarryPesewas: 600
};
// What 19 sends: prepareInstallmentPlan(854, start today, GH₵20.00 today) with the chosen next date.
const amosReplacement = {
  isInstallmentPlan: true, installmentAmount: 2000, frequency: "weekly", nextDueDate: "2026-11-18",
  installmentsRemaining: 42, totalInstallments: 43
};

test("reconcileInstallmentPlanChange counts today's payment once in the stored total", () => {
  const result = reconcileInstallmentPlanChange(amosBefore, 83400, amosReplacement, 1500);
  assert.equal(result.installmentsRemaining, 42);
  assert.equal(result.totalInstallments, 43, "1 paid (GH₵21.00) + 42 left");
});

test("reconcileInstallmentPlanChange with no payment today keeps the plan's own total", () => {
  const result = reconcileInstallmentPlanChange(
    { ...amosBefore, installmentPaymentCarryPesewas: 0 }, 85400,
    { ...amosReplacement, nextDueDate: "2026-11-12", installmentsRemaining: 43, totalInstallments: 43 }, 0
  );
  assert.equal(result.installmentsRemaining, 43);
  assert.equal(result.totalInstallments, 43);
});

test("amos replay: stored total 43, 42 left, and paid + left equals the money", async () => {
  const { stored } = await replayAmos();
  assert.equal(stored.amountPesewas, 83400);
  assert.equal(stored.installmentsRemaining, 42);
  assert.equal(stored.totalInstallments, 43);
  const ledger = getCustomerLedgerRecords({
    customerId: stored.customerId, customerName: "amos",
    debts: await db.debts.toArray(), transactions: await db.transactions.toArray(), payments: await db.payments.toArray()
  });
  const paidPesewas = getPlanPaidPesewas(ledger, stored.id);
  assert.equal(paidPesewas, 2100);
  const money = getPlanProgress({ balancePesewas: stored.amountPesewas, installmentAmountPesewas: stored.installmentAmount, paidPesewas });
  assert.equal(money.paid + money.left, stored.totalInstallments, "paid + left from money = stored total");
  assert.equal(money.left, stored.installmentsRemaining);
});