import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordDebtCollection, recordCreditSale } from "../src/db/debts.js";
import { correctDebtBalance, recordManualDebt } from "../src/db/debtLedger.js";
import { localDateString } from "../src/utils/installments.js";

// The rule checked here (owner, Batch 13): after every collection, correction, add-on and
// plan change, the stored installmentsRemaining equals the balance ÷ installment amount,
// rounded up. A case that breaks it is a finding to report, not something fixed here.
after(async () => {
  db.close();
  await db.delete();
});
beforeEach(async () => {
  await Promise.all([db.debts, db.customers, db.transactions, db.payments].map((table) => table.clear()));
});

const inDays = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localDateString(date);
};
const plan = (balance, installment, frequency = "weekly") => ({
  isInstallmentPlan: true,
  installmentAmount: installment,
  frequency,
  nextDueDate: inDays(7),
  installmentsRemaining: Math.ceil(balance / installment),
  totalInstallments: Math.ceil(balance / installment),
  installmentPaymentCarryPesewas: 0
});
async function startPlan(balance, installment) {
  const { debt, customer } = await recordManualDebt({ name: "Ama", amountPesewas: balance, installmentPlan: plan(balance, installment) });
  return { debtId: debt.id, customerId: customer.id };
}
async function check(debtId, step) {
  const debt = await db.debts.get(debtId);
  if (debt.status !== "unpaid" || !debt.isInstallmentPlan) return;
  const expected = Math.ceil(debt.amountPesewas / debt.installmentAmount);
  assert.equal(
    debt.installmentsRemaining,
    expected,
    `${step}: stored ${debt.installmentsRemaining}, but balance ${debt.amountPesewas} ÷ ${debt.installmentAmount} rounded up is ${expected} (carry ${debt.installmentPaymentCarryPesewas})`
  );
}
const collect = (debtId, amountPesewas) => recordDebtCollection({ debtId, parts: [{ paymentMethod: "cash", amountPesewas }] });
const debtVersion = async (debtId) => (await db.debts.get(debtId)).updatedAt;

test("collection: whole and part payments on a balance that is a whole number of installments", async () => {
  const { debtId } = await startPlan(3000, 1000);
  await check(debtId, "start GH₵30.00 at GH₵10.00");
  for (const amount of [1000, 500, 700, 300]) {
    await collect(debtId, amount);
    await check(debtId, `after collecting ${amount}`);
  }
});

test("collection: a balance that is not a whole number of installments, paid in parts", async () => {
  const { debtId } = await startPlan(2500, 1000);
  await check(debtId, "start GH₵25.00 at GH₵10.00");
  await collect(debtId, 1000);
  await check(debtId, "after collecting 1000");
  await collect(debtId, 500);
  await check(debtId, "after collecting 500");
});

test("collection: a part payment first on a balance that is not a whole number of installments", async () => {
  const { debtId } = await startPlan(2500, 1000);
  await collect(debtId, 500);
  await check(debtId, "after collecting 500");
});

test("correction: lowering the balance after a part payment, then collecting", async () => {
  const { debtId } = await startPlan(3000, 1000);
  await collect(debtId, 500);
  await check(debtId, "after collecting 500");
  await correctDebtBalance({ debtId, expectedUpdatedAt: await debtVersion(debtId), newBalancePesewas: 1800, reasonCode: "wrong_amount" });
  await check(debtId, "after correcting to 1800");
  await collect(debtId, 600);
  await check(debtId, "after collecting 600");
});

test("correction: to a balance that is not a whole number of installments, then collecting", async () => {
  const { debtId } = await startPlan(3000, 1000);
  await correctDebtBalance({ debtId, expectedUpdatedAt: await debtVersion(debtId), newBalancePesewas: 2500, reasonCode: "wrong_amount" });
  await check(debtId, "after correcting to 2500");
  await collect(debtId, 1000);
  await check(debtId, "after collecting 1000");
  await collect(debtId, 500);
  await check(debtId, "after collecting 500");
});

test("add-on: 53 Next with the inherited plan, after a part payment", async () => {
  const { debtId, customerId } = await startPlan(3000, 1000);
  await collect(debtId, 500);
  const debt = await db.debts.get(debtId);
  await recordManualDebt({ name: "Ama", customerId, debtId, amountPesewas: 1000, installmentPlan: {
    isInstallmentPlan: true, installmentAmount: debt.installmentAmount, frequency: debt.frequency, nextDueDate: debt.nextDueDate,
    installmentsRemaining: Math.ceil((debt.amountPesewas + 1000) / debt.installmentAmount), totalInstallments: debt.totalInstallments
  } });
  await check(debtId, "after adding 1000 with the inherited plan");
  await collect(debtId, 500);
  await check(debtId, "after collecting 500");
});

test("add-on: an amount that is not a whole number of installments, then collecting", async () => {
  const { debtId, customerId } = await startPlan(3000, 1000);
  const debt = await db.debts.get(debtId);
  await recordManualDebt({ name: "Ama", customerId, debtId, amountPesewas: 250, installmentPlan: {
    isInstallmentPlan: true, installmentAmount: debt.installmentAmount, frequency: debt.frequency, nextDueDate: debt.nextDueDate,
    installmentsRemaining: Math.ceil((debt.amountPesewas + 250) / debt.installmentAmount), totalInstallments: debt.totalInstallments
  } });
  await check(debtId, "after adding 250");
  await collect(debtId, 1000);
  await check(debtId, "after collecting 1000");
  await collect(debtId, 300);
  await check(debtId, "after collecting 300");
});

test("add-on: a credit sale added to a person who has a plan", async () => {
  const { debtId } = await startPlan(3000, 1000);
  await recordCreditSale({ name: "Ama", amountPesewas: 2000 });
  await check(debtId, "after a GH₵20.00 credit sale");
});

test("plan change: new installment amount on a plan with a part payment, then collecting", async () => {
  const { debtId, customerId } = await startPlan(3000, 1000);
  await collect(debtId, 500);
  await recordManualDebt({ name: "Ama", customerId, debtId, amountPesewas: 1000, installmentPlan: plan(3500, 700) });
  await check(debtId, "after changing to GH₵7.00 each");
  await collect(debtId, 200);
  await check(debtId, "after collecting 200");
});

test("plan change: new installment amount with no part payment, then collecting", async () => {
  const { debtId, customerId } = await startPlan(3000, 1000);
  await recordManualDebt({ name: "Ama", customerId, debtId, amountPesewas: 500, installmentPlan: plan(3500, 700) });
  await check(debtId, "after changing to GH₵7.00 each");
  for (const amount of [700, 300, 400]) {
    await collect(debtId, amount);
    await check(debtId, `after collecting ${amount}`);
  }
});
// The effect of DRIFT-2 and DRIFT-4: the stored count falls below the balance, and
// reconcileInstallmentPayment then refuses every further collection on that debt.
test("a debt changed by a correction or a plan change after a part payment can still be collected", async () => {
  const { debtId } = await startPlan(3000, 1000);
  await collect(debtId, 500);
  await correctDebtBalance({ debtId, expectedUpdatedAt: await debtVersion(debtId), newBalancePesewas: 1800, reasonCode: "wrong_amount" });
  await collect(debtId, 600);
  await collect(debtId, 100);
  assert.equal((await db.debts.get(debtId)).amountPesewas, 1100);
});

// A debt that already drifted on a phone before the fix (stored count below the balance)
// can still be collected, and the collection writes the count from the balance.
test("a debt saved with a count below its balance can still be collected and is corrected", async () => {
  const { debtId } = await startPlan(3000, 1000);
  await db.debts.update(debtId, { installmentsRemaining: 1, installmentPaymentCarryPesewas: 0 });
  await collect(debtId, 400);
  const debt = await db.debts.get(debtId);
  assert.equal(debt.amountPesewas, 2600);
  await check(debtId, "after collecting 400 on a drifted debt");
});

// Readers: payments left on screens comes from the balance, not the stored counter.
test("getInstallmentsLeft is balance ÷ installment rounded up, 0 without an active plan", async () => {
  const { getInstallmentsLeft } = await import("../src/utils/installments.js");
  const base = { isInstallmentPlan: true, status: "unpaid", installmentAmount: 1000, installmentsRemaining: 9 };
  assert.equal(getInstallmentsLeft({ ...base, amountPesewas: 2500 }), 3);
  assert.equal(getInstallmentsLeft({ ...base, amountPesewas: 1000 }), 1);
  assert.equal(getInstallmentsLeft({ ...base, total_owed: 1 }), 1);
  assert.equal(getInstallmentsLeft({ ...base, amountPesewas: 0 }), 0);
  assert.equal(getInstallmentsLeft({ ...base, amountPesewas: 2500, isInstallmentPlan: false }), 0);
  assert.equal(getInstallmentsLeft({ ...base, amountPesewas: 2500, status: "paid" }), 0);
  assert.equal(getInstallmentsLeft({ ...base, amountPesewas: 2500, installmentAmount: 0 }), 0);
});

test("the largest balances summary shows payments left from the balance", async () => {
  const { getLargestUnpaidBalances } = await import("../src/utils/debtBalances.js");
  const [summary] = getLargestUnpaidBalances([{
    id: "d1", customerName: "Ama", amountPesewas: 1000, isInstallmentPlan: true, status: "unpaid",
    installmentAmount: 1000, frequency: "weekly", nextDueDate: "2026-11-16", installmentsRemaining: 2, totalInstallments: 3
  }]);
  assert.equal(summary.installmentsRemaining, 1);
});

test("collection screens do not show the stored payments-left counter", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const file of ["src/pos/DebtCollection.jsx"]) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\.installmentsRemaining\b/, `${file} reads the stored counter`);
    assert.match(source, /getInstallmentsLeft\(/, `${file} should use getInstallmentsLeft`);
  }
});
