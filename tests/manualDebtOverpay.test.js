import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordManualDebt } from "../src/db/debtLedger.js";
import { getOutstandingDebtPesewas, summarizeFinancialTransactions, summarizePosMoney } from "../src/utils/financials.js";
import { calculateLedgerEventBalance, getCustomerLedgerRecords } from "../src/utils/debtLedgerMath.js";
import { checkLedgerConsistency } from "../src/utils/consistency.js";
import { addDueCycles, localDateString } from "../src/utils/installments.js";
import { loadCustomerHistory } from "../src/utils/loadCustomerDebtHistory.js";
import { findButton, loadJsx, render } from "./helpers/renderJsx.js";

// A manual debt (Add debt on 53, or Change to 19) with a payment today larger than the amount
// added. 19's "Maximum today" is the whole balance (older debt + amount added), so the writer
// accepts that much: the part that pays the amount added is recorded as before, and the rest pays
// the older debt and is written as a real debt collection (income transaction + payment row with a
// collectionId, as recordCreditSale does). Paying everything settles the debt with no plan.
after(async () => {
  db.close();
  await db.delete();
});
beforeEach(async () => {
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings].map((table) => table.clear()));
});

const TODAY = localDateString();
const weekAhead = addDueCycles(TODAY, "weekly", 1);
const plan = (installmentAmount, remaining, frequency = "weekly", nextDueDate = weekAhead) => ({
  isInstallmentPlan: true, installmentAmount, frequency, nextDueDate, installmentsRemaining: remaining, totalInstallments: remaining + 1
});
const noPlan = { isInstallmentPlan: false, installmentAmount: 2000, frequency: "weekly", nextDueDate: "", installmentsRemaining: 0, totalInstallments: 1 };
const cash = (amountPesewas) => ({ paymentMethod: "cash", amountPesewas });
const momo = (amountPesewas) => ({ paymentMethod: "momo", amountPesewas, momoMethod: "direct", verification: "merchant_confirmed", confirmedPesewas: amountPesewas });

async function olderDebt(kind, amount = 3000) {
  if (kind === "dueDate") return recordManualDebt({ name: "Ama", amountPesewas: amount, dueDate: weekAhead, now: Date.now() - 5000 });
  if (kind === "plan") return recordManualDebt({ name: "Ama", amountPesewas: amount, installmentPlan: plan(1000, Math.ceil(amount / 1000)), now: Date.now() - 5000 });
  return recordManualDebt({ name: "Ama", amountPesewas: amount, now: Date.now() - 5000 });
}
async function ledger(customerId) {
  const records = getCustomerLedgerRecords({ customerId, customerName: "Ama", debts: await db.debts.toArray(), transactions: await db.transactions.toArray(), payments: await db.payments.toArray() });
  return calculateLedgerEventBalance(records.transactions, records.payments);
}
async function assertConsistent() {
  const report = await checkLedgerConsistency();
  assert.deepEqual(report.issues.filter((issue) => issue.code === "debt_balance_mismatch"), []);
}
const after2 = async (id) => db.transactions.filter((row) => row.createdAt > 0 && row.id !== id).toArray();

// ---- the owner's case: 30 owed + 50 added + 60 paid today --------------------------------------------

test("30 owed + 50 added + 60 paid today: balance 20, Money in 60, the extra 10 is a real collection", async () => {
  const first = await olderDebt("dueDate");
  const older = first.debt;
  const moneyBefore = summarizePosMoney(await db.transactions.toArray()).moneyIn;
  const result = await recordManualDebt({
    customerId: first.customer.id, debtId: older.id, name: "Ama", amountPesewas: 5000,
    initialPaymentPesewas: 6000, initialPaymentParts: [cash(6000)], paymentMethod: "cash",
    installmentPlan: plan(2000, 1), now: Date.now()
  });
  assert.equal(result.debt.amountPesewas, 2000, "balance 20");
  const debts = await db.debts.toArray();
  assert.equal(getOutstandingDebtPesewas(debts), 2000, "Owed 20");
  assert.equal(debts[0].installmentAmount, 2000);
  assert.equal(debts[0].nextDueDate, weekAhead, "the next payment date is the one chosen on 19");
  assert.equal((await db.customers.get(first.customer.id)).totalDebtPesewas, 2000);

  const totals = summarizeFinancialTransactions(await db.transactions.toArray());
  assert.equal(totals.cashInflow - moneyBefore, 6000, "Money in 60");
  assert.equal(totals.cashReceived, 6000);
  assert.equal(summarizePosMoney(await db.transactions.toArray()).moneyIn, 6000);

  const incomes = (await db.transactions.toArray()).filter((row) => row.type === "income");
  const collections = incomes.filter((row) => row.collectionType === "debt_collection");
  assert.equal(collections.length, 1, "one real collection");
  assert.equal(collections[0].amountPesewas, 1000, "the extra 10");
  assert.equal(collections[0].debtId, older.id, "against the older debt");
  assert.ok(collections[0].collectionId);
  assert.equal(incomes.filter((row) => !row.collectionId).reduce((sum, row) => sum + row.amountPesewas, 0), 5000, "the 50 added is recorded as before");

  const payments = await db.payments.toArray();
  const collectionRows = payments.filter((row) => row.collectionType === "debt_collection");
  assert.deepEqual(collectionRows.map((row) => [row.amountPesewas, row.debtId, row.collectionId === collections[0].collectionId, row.transactionId === collections[0].id]), [[1000, older.id, true, true]]);
  assert.equal(payments.reduce((sum, row) => sum + row.amountPesewas, 0), 6000);

  assert.equal(await ledger(first.customer.id), 2000, "the ledger reconciles");
  await assertConsistent();
  const history = await loadCustomerHistory(first.customer.id, "Ama");
  assert.equal(history.unaccountedCreditPesewas, 0);
  assert.equal(history.currentBalancePesewas, 2000);
});

test("the same on an older installment plan: balance 20, a new plan on the date chosen", async () => {
  const first = await olderDebt("plan");
  const result = await recordManualDebt({
    customerId: first.customer.id, debtId: first.debt.id, name: "Ama", amountPesewas: 5000,
    initialPaymentPesewas: 6000, initialPaymentParts: [cash(6000)], paymentMethod: "cash",
    installmentPlan: plan(2000, 1), now: Date.now()
  });
  assert.equal(result.debt.amountPesewas, 2000);
  assert.equal(result.debt.isInstallmentPlan, true);
  assert.equal(result.debt.installmentAmount, 2000);
  assert.equal(result.debt.installmentsRemaining, 1);
  assert.equal(result.debt.nextDueDate, weekAhead, "not pushed out by the payment made today");
  assert.equal(summarizePosMoney(await db.transactions.toArray()).moneyIn, 6000);
  assert.equal(await ledger(first.customer.id), 2000);
  await assertConsistent();
});

test("Cash + MoMo: the extra keeps its method; money in and the MoMo record are right", async () => {
  const first = await olderDebt("dueDate");
  await recordManualDebt({
    customerId: first.customer.id, debtId: first.debt.id, name: "Ama", amountPesewas: 5000,
    initialPaymentPesewas: 6000, initialPaymentParts: [cash(2000), momo(4000)], paymentMethod: "momo",
    installmentPlan: plan(2000, 1), now: Date.now()
  });
  const totals = summarizePosMoney(await db.transactions.toArray());
  assert.deepEqual([totals.moneyIn, totals.cashIn, totals.momoIn], [6000, 2000, 4000]);
  const incomes = (await db.transactions.toArray()).filter((row) => row.type === "income");
  const collection = incomes.filter((row) => row.collectionType === "debt_collection");
  assert.deepEqual(collection.map((row) => [row.payment_method, row.amountPesewas]), [["momo", 1000]]);
  assert.equal(collection[0].momoVerification, "merchant_confirmed");
  assert.equal(incomes.filter((row) => !row.collectionId && row.payment_method === "momo").reduce((sum, row) => sum + row.amountPesewas, 0), 3000);
  assert.equal(await ledger(first.customer.id), 2000);
  await assertConsistent();
});

// ---- paying everything, and the limits ---------------------------------------------------------------------

test("paying the whole balance settles the debt with no plan (a 'no plan' object from 19 is accepted)", async () => {
  const first = await olderDebt("plan");
  const result = await recordManualDebt({
    customerId: first.customer.id, debtId: first.debt.id, name: "Ama", amountPesewas: 5000,
    initialPaymentPesewas: 8000, initialPaymentParts: [cash(8000)], paymentMethod: "cash", installmentPlan: noPlan, now: Date.now()
  });
  assert.equal(result.debt.amountPesewas, 0);
  assert.equal(result.debt.status, "paid");
  assert.equal(result.debt.isInstallmentPlan, false);
  assert.equal(result.debt.nextDueDate, "");
  assert.equal(summarizePosMoney(await db.transactions.toArray()).moneyIn, 8000);
  assert.equal(await ledger(first.customer.id), 0);
  await assertConsistent();
});

test("a new customer paying the whole amount added today saves as settled, with no plan", async () => {
  const result = await recordManualDebt({ name: "Ama", amountPesewas: 8000, initialPaymentPesewas: 8000, initialPaymentParts: [cash(8000)], paymentMethod: "cash", installmentPlan: noPlan });
  assert.equal(result.debt.status, "paid");
  assert.equal(result.debt.amountPesewas, 0);
  assert.equal(summarizePosMoney(await db.transactions.toArray()).moneyIn, 8000);
});

test("more than the balance after the addition is refused and nothing is written", async () => {
  const first = await olderDebt("dueDate");
  const eventsBefore = await db.transactions.count();
  await assert.rejects(recordManualDebt({
    customerId: first.customer.id, debtId: first.debt.id, name: "Ama", amountPesewas: 5000,
    initialPaymentPesewas: 8001, initialPaymentParts: [cash(8001)], paymentMethod: "cash", now: Date.now()
  }), /cannot exceed/);
  assert.equal(await db.transactions.count(), eventsBefore);
  assert.equal((await db.debts.get(first.debt.id)).amountPesewas, 3000);
  assert.equal(await db.payments.count(), 0);
});

test("a new customer cannot pay more than the amount added", async () => {
  await assert.rejects(recordManualDebt({ name: "Kofi", amountPesewas: 5000, initialPaymentPesewas: 5001, initialPaymentParts: [cash(5001)], paymentMethod: "cash" }), /cannot exceed/);
  assert.equal(await db.debts.count(), 0);
});

test("a payment that is not more than the amount added is recorded exactly as before (no collection)", async () => {
  const first = await olderDebt("dueDate");
  await recordManualDebt({
    customerId: first.customer.id, debtId: first.debt.id, name: "Ama", amountPesewas: 5000,
    initialPaymentPesewas: 5000, initialPaymentParts: [cash(5000)], paymentMethod: "cash", installmentPlan: plan(3000, 1), now: Date.now()
  });
  const incomes = (await db.transactions.toArray()).filter((row) => row.type === "income");
  assert.equal(incomes.length, 1);
  assert.equal(incomes[0].collectionId, undefined);
  assert.equal(incomes[0].amountPesewas, 5000);
  assert.equal((await db.payments.toArray()).every((row) => !row.collectionId), true);
  assert.equal((await db.debts.get(first.debt.id)).amountPesewas, 3000);
});

// ---- two open debt entries (older data) ---------------------------------------------------------------------

async function twoEntries() {
  const first = await olderDebt("dueDate", 3000);
  await db.debts.add({ ...first.debt, id: "second-entry", amountPesewas: 2000, total_owed: 2000, createdAt: first.debt.createdAt + 1, created_at: first.debt.createdAt + 1 });
  await db.transactions.add({ id: "second-event", type: "manual_debt", debtId: "second-entry", customerId: first.customer.id, amountPesewas: 0, total_amount: 0, creditExtendedPesewas: 2000, customer_name: "Ama", createdAt: first.debt.createdAt + 1, timestamp: first.debt.createdAt + 1, items_json: "[]", payment_method: null });
  return first;
}

test("two open entries 30 + 20: add 10 and pay all 60 settles both, Money in 60", async () => {
  const first = await twoEntries();
  await recordManualDebt({
    customerId: first.customer.id, debtId: first.debt.id, name: "Ama", amountPesewas: 1000,
    initialPaymentPesewas: 6000, initialPaymentParts: [cash(6000)], paymentMethod: "cash", installmentPlan: noPlan, now: Date.now()
  });
  const debts = await db.debts.toArray();
  assert.deepEqual(debts.map((debt) => [debt.id === "second-entry" ? "second" : "first", debt.status, debt.amountPesewas]).sort(), [["first", "paid", 0], ["second", "paid", 0]]);
  assert.equal(summarizePosMoney(await db.transactions.toArray()).moneyIn, 6000);
  assert.equal(await ledger(first.customer.id), 0);
  await assertConsistent();
});

test("two open entries 30 + 20: add 10 and pay 45 pays the entry added to, then the other", async () => {
  const first = await twoEntries();
  await recordManualDebt({
    customerId: first.customer.id, debtId: first.debt.id, name: "Ama", amountPesewas: 1000,
    initialPaymentPesewas: 4500, initialPaymentParts: [cash(4500)], paymentMethod: "cash", now: Date.now()
  });
  const byId = Object.fromEntries((await db.debts.toArray()).map((debt) => [debt.id, debt]));
  assert.equal(byId[first.debt.id].amountPesewas, 0);
  assert.equal(byId[first.debt.id].status, "paid");
  assert.equal(byId["second-entry"].amountPesewas, 1500);
  assert.equal(getOutstandingDebtPesewas(Object.values(byId)), 1500);
  assert.equal(await ledger(first.customer.id), 1500);
  await assertConsistent();
});

// ---- the grid on 19: every combination that failed now saves -------------------------------------------------------

// The fields PosApp.saveCreditSale passes to recordManualDebt (src/pos/PosApp.jsx).
const toWriter = (details) => ({
  customerId: details.customer?.id ?? details.customerId, debtId: details.debtId, name: details.customer?.name ?? "",
  phone: details.customer?.phone ?? "", ghanaCardNumber: details.customer?.ghanaCardNumber ?? "", amountPesewas: details.amountPesewas,
  initialPaymentPesewas: details.initialPaymentPesewas ?? 0, initialPaymentParts: details.initialPaymentParts ?? null,
  paymentMethod: details.paymentMethod ?? "cash", note: details.note ?? "", dueDate: details.dueDate ?? "",
  installmentPlan: details.installmentPlan ?? null, takenOn: details.takenOn ?? "", attemptId: details.attemptId, now: Date.now()
});

test("PosApp passes the manual-debt fields the grid helper mirrors", () => {
  const app = readFileSync(new URL("../src/pos/PosApp.jsx", import.meta.url), "utf8");
  for (const field of ["initialPaymentPesewas: details.initialPaymentPesewas ?? 0", "initialPaymentParts: details.initialPaymentParts ?? null", "installmentPlan: details.installmentPlan ?? null", "debtId: details.debtId"]) {
    assert.ok(app.includes(field), field);
  }
});

const FREQUENCY_DAYS = { weekly: 7, "bi-weekly": 14, monthly: 30 };
function plusDays(days) {
  const date = new Date(`${TODAY}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test("19 grid, manual debt with older debt: Today with 60, 50, 40, 20 or 80 paid, every amount, frequency and date saves", async () => {
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx");
  const failures = [];
  let saved = 0;
  for (const older of ["dueDate", "plan"]) {
    for (const paid of [60, 50, 40, 20, 80]) for (const each of [10, 20, 30, 80]) for (const frequency of ["weekly", "bi-weekly", "monthly"]) for (const offset of [0, -1, 1]) {
      await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings].map((table) => table.clear()));
      const first = await olderDebt(older);
      const customer = { ...(await db.customers.get(first.customer.id)), totalDebtPesewas: 3000, debt: first.debt };
      // The date is a valid choice on 19 when it is after today (see the date rule in the next commit).
      const nextDueDate = plusDays(FREQUENCY_DAYS[frequency] + offset);
      const label = `${older} paid ${paid} each ${each} ${frequency} ${nextDueDate}`;
      let outcome = null;
      const view = render({ type: CreditScreens, props: {
        route: "ALittleAtATime",
        params: { manualDebt: true, amountPesewas: 5000, customer, debtId: first.debt.id, note: "", takenOn: TODAY,
          installmentAmount: String(each), frequency, startToday: true, todayPaymentAmount: String(paid), nextDueDate, paymentMethod: "cash" },
        onBack() {}, onNavigate() {}, onUpdateParams() {}, onReturnToSplit() {},
        onSaveCredit: async (details) => { outcome = await recordManualDebt(toWriter(details)); }
      } });
      const button = findButton(view.tree, "Save plan");
      if (button.props.disabled) { failures.push(`${label}: Save plan is off`); continue; }
      await button.props.onClick();
      for (let index = 0; index < 100 && !outcome; index += 1) await new Promise((resolve) => setTimeout(resolve, 3));
      if (!outcome) { failures.push(label); continue; }
      saved += 1;
      const expectedBalance = 8000 - paid * 100;
      if (outcome.customer.totalDebtPesewas !== expectedBalance) failures.push(`${label}: balance ${outcome.customer.totalDebtPesewas} not ${expectedBalance}`);
      if (summarizePosMoney(await db.transactions.toArray()).moneyIn !== paid * 100) failures.push(`${label}: Money in`);
    }
  }
  assert.deepEqual(failures, []);
  assert.equal(saved, 2 * 5 * 4 * 3 * 3);
});