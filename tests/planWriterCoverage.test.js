import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale, recordDebtCollection } from "../src/db/debts.js";
import { recordManualDebt } from "../src/db/debtLedger.js";
import { saveAddedDebt } from "../src/utils/addDebt.js";
import { getNextCycleDate, getPlanProgress, localDateString, prepareInstallmentPlan } from "../src/utils/installments.js";
import { getCustomerLedgerRecords, getPlanPaidPesewas } from "../src/utils/debtLedgerMath.js";

// Every writer that calls reconcileInstallmentPlanChange or builds a start-today plan, checked for
// total, left, paid, next due date and carry against the money:
//   left = balance ÷ installment (up), paid = money paid against the debt ÷ installment (down),
//   total = paid + left, next date = the date chosen on 19, carry = money toward that installment.
after(async () => {
  db.close();
  await db.delete();
});
beforeEach(async () => {
  await Promise.all([db.debts, db.customers, db.transactions, db.payments].map((table) => table.clear()));
});

const CHOSEN = "2026-11-18";
const weekly = (balance, installment, nextDueDate = "2026-11-12") => ({
  isInstallmentPlan: true, installmentAmount: installment, frequency: "weekly", nextDueDate,
  installmentsRemaining: Math.ceil(balance / installment), totalInstallments: Math.ceil(balance / installment),
  installmentPaymentCarryPesewas: 0
});
// 19 with "First payment Today": the plan on the whole balance, then the chosen next date.
const startToday = (balancePesewas, installmentPesewas, todayPesewas) => {
  const prepared = prepareInstallmentPlan({
    amountPesewas: balancePesewas, installmentAmountPesewas: installmentPesewas, frequency: "weekly",
    nextDueDate: "2026-11-07", startToday: true, initialPaymentLimitPesewas: todayPesewas
  });
  return {
    installmentPlan: { ...prepared.plan, nextDueDate: CHOSEN },
    initialPaymentPesewas: prepared.initialPaymentPesewas,
    initialPaymentParts: [{ paymentMethod: "cash", amountPesewas: prepared.initialPaymentPesewas }]
  };
};
const collect = (debtId, amountPesewas) => recordDebtCollection({ debtId, parts: [{ paymentMethod: "cash", amountPesewas }] });

async function planPaid(debt) {
  const ledger = getCustomerLedgerRecords({
    customerId: debt.customerId, customerName: debt.customerName ?? debt.customer_name ?? "",
    debts: await db.debts.toArray(), transactions: await db.transactions.toArray(), payments: await db.payments.toArray()
  });
  return getPlanPaidPesewas(ledger, debt.id);
}

// The stored total is checked separately (checkTotal) so a wrong total does not hide the rest.
let checkTotal = true;
async function assertPlan(debtId, { balancePesewas, paidPesewas, nextDueDate = CHOSEN, carryPesewas }) {
  const debt = await db.debts.get(debtId);
  assert.equal(debt.amountPesewas, balancePesewas, "balance");
  assert.equal(await planPaid(debt), paidPesewas, "money paid against the debt");
  const money = getPlanProgress({ balancePesewas, installmentAmountPesewas: debt.installmentAmount, paidPesewas });
  if (checkTotal) {
    assert.equal(debt.totalInstallments, money.paid + money.left, `total = paid + left (${money.paid} + ${money.left})`);
    return;
  }
  assert.equal(debt.installmentsRemaining, money.left, "left");
  assert.equal(debt.nextDueDate, nextDueDate, "next due date");
  assert.equal(debt.installmentPaymentCarryPesewas ?? 0, carryPesewas, "carry");
}
// Each case runs twice: left, paid, next date and carry; then the stored total on its own
// (owner rule, 11 Nov 2026: every writer stores getPlanProgress paid + left).
function planTest(name, run) {
  test(`${name}: left, paid, next date, carry`, async () => { checkTotal = false; await run(); });
  test(`${name}: stored total = paid + left`, async () => { checkTotal = true; await run(); });
}

// ---- recordCreditSale (19, and 16 when the Owe part has a plan: same writer, same plan shape) ----

planTest("credit sale, start today, new customer", async () => {
  // GH₵30.00 sale, GH₵10.00 today pays the sale (not a debt payment), GH₵20.00 left.
  const { debtId } = await recordCreditSale({ name: "Kofi", amountPesewas: 3000, ...startToday(3000, 1000, 1000) });
  await assertPlan(debtId, { balancePesewas: 2000, paidPesewas: 0, carryPesewas: 0 });
});

planTest("credit sale, start today, existing plan debt with a part payment, paying no more than the sale", async () => {
  const { debtId } = await recordCreditSale({ name: "Kofi", amountPesewas: 3000, installmentPlan: weekly(3000, 1000) });
  await collect(debtId, 500);
  // GH₵10.00 sale paid in full today; the plan's GH₵5.00 carry stays.
  await recordCreditSale({ name: "Kofi", amountPesewas: 1000, ...startToday(3500, 1000, 1000) });
  await assertPlan(debtId, { balancePesewas: 2500, paidPesewas: 500, carryPesewas: 500 });
});

planTest("credit sale, start today, existing debt with no plan and a part payment, paying more than the sale", async () => {
  const { debtId } = await recordCreditSale({ name: "Kofi", amountPesewas: 3000 });
  await collect(debtId, 500);
  // GH₵2.00 sale, GH₵10.00 today: GH₵8.00 pays the old debt. Money paid before the plan is not in the carry.
  await recordCreditSale({ name: "Kofi", amountPesewas: 200, ...startToday(2700, 1000, 1000) });
  await assertPlan(debtId, { balancePesewas: 1700, paidPesewas: 1300, carryPesewas: 800 });
});

// ---- recordManualDebt (19 for a manual debt, and 53 keeping the plan without 19) ----

planTest("manual debt, start today, new customer, paying less than one installment", async () => {
  const { debt } = await recordManualDebt({ name: "Kofi", amountPesewas: 3000, ...startToday(3000, 1000, 400) });
  // Owner rule (11 Nov 2026): a payment today shorter than one installment is carried
  // (payment today modulo the installment), as a collection does.
  await assertPlan(debt.id, { balancePesewas: 2600, paidPesewas: 400, carryPesewas: 400 });
});

planTest("manual debt, start today, new customer, GH₵16.00 today on a GH₵20.00 installment", async () => {
  const { debt } = await recordManualDebt({ name: "Kofi", amountPesewas: 10000, ...startToday(10000, 2000, 1600) });
  await assertPlan(debt.id, { balancePesewas: 8400, paidPesewas: 1600, carryPesewas: 1600 });
});

planTest("53 keeps the plan (no 19, nothing paid today) after whole installments were paid", async () => {
  const { debt: first, customer } = await recordManualDebt({ name: "Kofi", amountPesewas: 3000, installmentPlan: weekly(3000, 1000) });
  await collect(first.id, 2000);
  const debt = await db.debts.get(first.id);
  // 53's inherited plan: the stored date and total, payments left from the new balance.
  await recordManualDebt({ name: "Kofi", customerId: customer.id, debtId: first.id, amountPesewas: 500, installmentPlan: {
    isInstallmentPlan: true, installmentAmount: 1000, frequency: "weekly", nextDueDate: debt.nextDueDate,
    installmentsRemaining: 2, totalInstallments: debt.totalInstallments
  } });
  await assertPlan(first.id, { balancePesewas: 1500, paidPesewas: 2000, nextDueDate: debt.nextDueDate, carryPesewas: 0 });
});

planTest("manual debt, plan changed on 19 with the next cycle (nothing paid today) after a part payment", async () => {
  const { debt: first, customer } = await recordManualDebt({ name: "Kofi", amountPesewas: 3000, installmentPlan: weekly(3000, 1000) });
  await collect(first.id, 500);
  await recordManualDebt({ name: "Kofi", customerId: customer.id, debtId: first.id, amountPesewas: 1000,
    installmentPlan: weekly(3500, 700, CHOSEN) });
  await assertPlan(first.id, { balancePesewas: 3500, paidPesewas: 500, carryPesewas: 500 });
});

// ---- prepareAddDebt / saveAddedDebt (start today; not reached from any screen, tests only) ----

planTest("saveAddedDebt, start today, existing plan debt with a part payment", async () => {
  const { debtId } = await recordCreditSale({ name: "Kofi", amountPesewas: 3000, installmentPlan: weekly(3000, 1000) });
  await collect(debtId, 500);
  // GH₵10.00 added and paid today (the limit is the amount added), next date one cycle from today.
  await saveAddedDebt({ customerName: "Kofi", amount: 1000, isInstallmentPlan: true, installmentAmount: "10",
    installmentStartMode: "today", existingDebtPesewas: 2500 });
  await assertPlan(debtId, { balancePesewas: 2500, paidPesewas: 500,
    nextDueDate: getNextCycleDate(localDateString(), "weekly"), carryPesewas: 500 });
});