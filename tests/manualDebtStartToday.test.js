import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordDebtCollection } from "../src/db/debts.js";
import { recordManualDebt } from "../src/db/debtLedger.js";
import { getPlanProgress, prepareInstallmentPlan } from "../src/utils/installments.js";
import { getCustomerLedgerRecords, getPlanPaidPesewas } from "../src/utils/debtLedgerMath.js";

// 53 (recordManualDebt), start today with a payment today, on a customer who already has a debt
// and a part payment. The plan is built the way 19 builds it: prepareInstallmentPlan on the whole
// balance (owed before + amount added), start today, then the next date chosen on 19.
after(async () => {
  db.close();
  await db.delete();
});
beforeEach(async () => {
  await Promise.all([db.debts, db.customers, db.transactions, db.payments].map((table) => table.clear()));
});

const CHOSEN = "2026-11-18";
const weekly = (balance, installment) => ({
  isInstallmentPlan: true, installmentAmount: installment, frequency: "weekly", nextDueDate: "2026-11-12",
  installmentsRemaining: Math.ceil(balance / installment), totalInstallments: Math.ceil(balance / installment),
  installmentPaymentCarryPesewas: 0
});

async function addOnStartToday({ customerId, debtId, owedBeforePesewas, amountPesewas, installmentPesewas, todayPesewas }) {
  const prepared = prepareInstallmentPlan({
    amountPesewas: owedBeforePesewas + amountPesewas, installmentAmountPesewas: installmentPesewas, frequency: "weekly",
    nextDueDate: "2026-11-07", startToday: true, initialPaymentLimitPesewas: todayPesewas
  });
  await recordManualDebt({
    name: "amos", customerId, debtId, amountPesewas,
    initialPaymentPesewas: prepared.initialPaymentPesewas,
    initialPaymentParts: [{ paymentMethod: "cash", amountPesewas: prepared.initialPaymentPesewas }],
    installmentPlan: { ...prepared.plan, nextDueDate: CHOSEN }
  });
  return db.debts.get(debtId);
}

async function planPaid(debt) {
  const ledger = getCustomerLedgerRecords({
    customerId: debt.customerId, customerName: debt.customerName ?? "",
    debts: await db.debts.toArray(), transactions: await db.transactions.toArray(), payments: await db.payments.toArray()
  });
  return getPlanPaidPesewas(ledger, debt.id);
}

// total, left, paid, next due date and carry, all against the money.
async function assertPlan(debt, { balancePesewas, paidPesewas, carryPesewas = paidPesewas % debt.installmentAmount }) {
  assert.equal(debt.amountPesewas, balancePesewas, "balance");
  assert.equal(await planPaid(debt), paidPesewas, "money paid against the plan");
  const money = getPlanProgress({ balancePesewas, installmentAmountPesewas: debt.installmentAmount, paidPesewas });
  assert.equal(debt.installmentsRemaining, money.left, "left");
  assert.equal(debt.totalInstallments, money.paid + money.left, "total = paid + left");
  assert.equal(debt.nextDueDate, CHOSEN, "next due date = the date chosen on 19");
  assert.equal(debt.installmentPaymentCarryPesewas ?? 0, carryPesewas, "carry = money toward the next installment");
}

test("53 start today on a plan debt with a part payment, paying more than the amount added", async () => {
  const { debt: first, customer } = await recordManualDebt({ name: "amos", amountPesewas: 85500, installmentPlan: weekly(85500, 2000) });
  await recordDebtCollection({ debtId: first.id, parts: [{ paymentMethod: "cash", amountPesewas: 600 }] });
  // GH₵5.00 added, GH₵20.00 today: GH₵5.00 pays the amount added, GH₵15.00 the old debt.
  const debt = await addOnStartToday({ customerId: customer.id, debtId: first.id, owedBeforePesewas: 84900, amountPesewas: 500, installmentPesewas: 2000, todayPesewas: 2000 });
  await assertPlan(debt, { balancePesewas: 83400, paidPesewas: 2600 });
});

test("53 start today on a plan debt with a part payment, paying less than the amount added", async () => {
  const { debt: first, customer } = await recordManualDebt({ name: "amos", amountPesewas: 85500, installmentPlan: weekly(85500, 2000) });
  await recordDebtCollection({ debtId: first.id, parts: [{ paymentMethod: "cash", amountPesewas: 600 }] });
  // GH₵50.00 added, GH₵20.00 today, all of it toward the amount added.
  const debt = await addOnStartToday({ customerId: customer.id, debtId: first.id, owedBeforePesewas: 84900, amountPesewas: 5000, installmentPesewas: 2000, todayPesewas: 2000 });
  await assertPlan(debt, { balancePesewas: 87900, paidPesewas: 2600 });
});

test("53 start today on a debt with no plan and a part payment, paying the amount added", async () => {
  const { debt: first, customer } = await recordManualDebt({ name: "amos", amountPesewas: 3000 });
  await recordDebtCollection({ debtId: first.id, parts: [{ paymentMethod: "cash", amountPesewas: 500 }] });
  const debt = await addOnStartToday({ customerId: customer.id, debtId: first.id, owedBeforePesewas: 2500, amountPesewas: 1000, installmentPesewas: 1000, todayPesewas: 1000 });
  // The plan starts today: the GH₵5.00 paid before there was a plan is not toward the 18/11 installment.
  await assertPlan(debt, { balancePesewas: 2500, paidPesewas: 1500, carryPesewas: 0 });
});

test("53 start today on a debt with no plan and a part payment, paying less than one installment", async () => {
  const { debt: first, customer } = await recordManualDebt({ name: "amos", amountPesewas: 3000 });
  await recordDebtCollection({ debtId: first.id, parts: [{ paymentMethod: "cash", amountPesewas: 200 }] });
  // GH₵10.00 added, GH₵5.00 today: GH₵7.00 paid in all (0 whole installments), GH₵33.00 left (4).
  const debt = await addOnStartToday({ customerId: customer.id, debtId: first.id, owedBeforePesewas: 2800, amountPesewas: 1000, installmentPesewas: 1000, todayPesewas: 500 });
  await assertPlan(debt, { balancePesewas: 3300, paidPesewas: 700, carryPesewas: 500 });
});

test("53 start today on a debt with no plan and a part payment, paying more than the amount added", async () => {
  const { debt: first, customer } = await recordManualDebt({ name: "amos", amountPesewas: 3000 });
  await recordDebtCollection({ debtId: first.id, parts: [{ paymentMethod: "cash", amountPesewas: 500 }] });
  const debt = await addOnStartToday({ customerId: customer.id, debtId: first.id, owedBeforePesewas: 2500, amountPesewas: 500, installmentPesewas: 1000, todayPesewas: 1000 });
  await assertPlan(debt, { balancePesewas: 2000, paidPesewas: 1500, carryPesewas: 0 });
});