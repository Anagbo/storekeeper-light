import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { getCustomerLedgerRecords, getPlanPaidPesewas } from "../src/utils/debtLedgerMath.js";
import { recordCreditSale, recordDebtCollection } from "../src/db/debts.js";
import { getPlanProgress, prepareInstallmentPlan, reconcileInstallmentPlanChange } from "../src/utils/installments.js";
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

// Due date (owner rule): the next payment date chosen on 19 is the date saved. amos with today
// 07/11, weekly, next date chosen 18/11: before the fix the carry GH₵6.00 + today's GH₵15.00 made
// one whole installment and moved the chosen date a week, to 25/11.
async function replayAmosOn07Nov() {
  const first = prepareInstallmentPlan({ amountPesewas: 85500, installmentAmountPesewas: 2000, frequency: "weekly", nextDueDate: "2026-11-12" });
  const { debtId } = await recordCreditSale({ name: "amos", amountPesewas: 85500, installmentPlan: first.plan });
  await recordDebtCollection({ debtId, parts: [{ paymentMethod: "cash", amountPesewas: 600 }] });
  const prepared = prepareInstallmentPlan({
    amountPesewas: 85400, installmentAmountPesewas: 2000, frequency: "weekly",
    nextDueDate: "2026-11-07", startToday: true, initialPaymentLimitPesewas: 2000
  });
  await recordCreditSale({
    name: "amos", amountPesewas: 500,
    installmentPlan: { ...prepared.plan, nextDueDate: "2026-11-18" },
    initialPaymentPesewas: prepared.initialPaymentPesewas,
    initialPaymentParts: [{ paymentMethod: "cash", amountPesewas: prepared.initialPaymentPesewas }]
  });
  return db.debts.get(debtId);
}

test("amos (today 07/11, weekly, next chosen 18/11): the saved next date is 18/11", async () => {
  const stored = await replayAmosOn07Nov();
  assert.equal(stored.nextDueDate, "2026-11-18");
  // GH₵21.00 paid against the plan: one whole installment and GH₵1.00 toward the 18/11 one.
  assert.equal(stored.installmentPaymentCarryPesewas, 100);
  assert.equal(stored.totalInstallments, 43);
  assert.equal(stored.installmentsRemaining, 42);
});

test("reconcileInstallmentPlanChange keeps the chosen date, with or without a payment today", () => {
  assert.equal(reconcileInstallmentPlanChange(amosBefore, 83400, amosReplacement, 1500).nextDueDate, "2026-11-18");
  assert.equal(reconcileInstallmentPlanChange(amosBefore, 83400, amosReplacement, 1500).installmentPaymentCarryPesewas, 100);
  // A smaller installment than the carry already paid: still the chosen date.
  const smaller = reconcileInstallmentPlanChange({ ...amosBefore, installmentPaymentCarryPesewas: 1500 }, 84900,
    { ...amosReplacement, installmentAmount: 500, installmentsRemaining: 170, totalInstallments: 170 }, 0);
  assert.equal(smaller.nextDueDate, "2026-11-18");
  assert.equal(smaller.installmentPaymentCarryPesewas, 0);
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