import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordManualDebt } from "../src/db/debtLedger.js";
import { recordDebtCollection } from "../src/db/debts.js";
import { loadCustomerHistory } from "../src/utils/loadCustomerDebtHistory.js";
import { summarizeFinancialTransactions } from "../src/utils/financials.js";

const tables = [db.debts, db.customers, db.transactions, db.payments];

before(async () => {
  await db.open();
});

beforeEach(async () => {
  await Promise.all(tables.map((table) => table.clear()));
});

after(async () => {
  db.close();
  await db.delete();
});

test("records manual debt without a sale, item line, payment, or money movement", async () => {
  const beforeTotals = summarizeFinancialTransactions(await db.transactions.toArray());
  const result = await recordManualDebt({
    name: "Ama Mensah",
    phone: "024 123 4567",
    ghanaCardNumber: "GHA-123456789-0",
    amountPesewas: 1250,
    note: "Rice",
    now: 2000
  });

  assert.equal(result.event.type, "manual_debt");
  assert.equal(result.event.creditExtendedPesewas, 1250);
  assert.equal(result.event.amountPesewas, 0);
  assert.equal(result.event.items_json, "[]");
  assert.equal(await db.transactions.where("type").equals("manual_debt").count(), 1);
  assert.equal(await db.transactions.where("type").equals("credit_sale").count(), 0);
  assert.equal(await db.payments.count(), 0);
  assert.deepEqual(summarizeFinancialTransactions(await db.transactions.toArray()), beforeTotals);
  assert.equal(result.debt.amountPesewas, 1250);
  assert.equal(result.customer.totalDebtPesewas, 1250);
});

test("reproduces the manual debt path behind an Added to debt history row", async () => {
  const result = await recordManualDebt({
    name: "Test Balance D",
    phone: "024 123 4567",
    ghanaCardNumber: "GHA-123456789-0",
    amountPesewas: 10000,
    initialPaymentPesewas: 2000,
    initialPaymentParts: [{ paymentMethod: "cash", amountPesewas: 2000 }],
    paymentMethod: "cash",
    installmentPlan: {
      isInstallmentPlan: true,
      installmentAmount: 2000,
      frequency: "weekly",
      nextDueDate: "2026-11-12",
      installmentsRemaining: 4,
      totalInstallments: 5
    },
    now: 2100
  });

  assert.equal(result.debt.amountPesewas, 8000);
  assert.equal(result.debt.installmentsRemaining, 4);
  assert.equal(result.debt.totalInstallments, 5);
  assert.equal(await db.payments.count(), 1);
  const payment = (await db.payments.toArray())[0];
  assert.equal(payment.amountPesewas, 2000);
  assert.equal(payment.paymentMethod, "cash");
  assert.equal(result.event.type, "manual_debt");
  assert.equal(result.event.creditExtendedPesewas, 10000);
  assert.equal(result.customer.totalDebtPesewas, 8000);

  const history = await loadCustomerHistory(result.customer.id, "Test Balance D");
  assert.equal(history.currentBalancePesewas, 8000);
  assert.equal(history.totalCreditPesewas, 10000);
  assert.equal(history.totalPaidPesewas, 2000);
  assert.equal(history.unaccountedCreditPesewas, 0);
  const paymentEvents = history.events.filter((e) => e.type === "payment");
  assert.equal(paymentEvents.length, 1);
  assert.equal(paymentEvents[0].amountPesewas, 2000);
  const manualDebtEvents = history.events.filter((e) => e.type === "manual_debt");
  assert.equal(manualDebtEvents.length, 1);
  assert.equal(manualDebtEvents[0].amountPesewas, 10000);
});

test("appends manual debt events and orders backdated history by timestamp", async () => {
  const first = await recordManualDebt({
    name: "Ama Mensah",
    ghanaCardNumber: "GHA-123456789-0",
    amountPesewas: 1000,
    note: "Earlier debt",
    now: 3000
  });
  const second = await recordManualDebt({
    customerId: first.customer.id,
    name: "Ama Mensah",
    ghanaCardNumber: "GHA-123456789-0",
    amountPesewas: 500,
    note: "Backdated debt",
    now: 1000
  });

  assert.equal(await db.transactions.where("type").equals("manual_debt").count(), 2);
  assert.equal((await db.debts.get(first.debt.id)).amountPesewas, 1500);
  const history = await loadCustomerHistory(first.customer.id, "Ama Mensah");
  assert.deepEqual(
    history.events.filter((event) => event.type === "manual_debt").map((event) => [event.amountPesewas, event.note]),
    [[1000, "Earlier debt"], [500, "Backdated debt"]]
  );
  assert.equal(history.currentBalancePesewas, 1500);
  assert.equal(history.totalCreditPesewas, 1500);
  assert.equal(history.unaccountedCreditPesewas, 0);
  assert.equal(second.event.timestamp, 1000);
});

test("accepts a small add-on amount when the inherited installment amount exceeds the add-on", async () => {
  const first = await recordManualDebt({
    name: "Kojo Mensah",
    ghanaCardNumber: "GHA-123456789-0",
    amountPesewas: 6000,
    installmentPlan: {
      isInstallmentPlan: true,
      installmentAmount: 3000,
      frequency: "weekly",
      nextDueDate: "2026-11-24",
      installmentsRemaining: 2,
      totalInstallments: 2
    }
  });

  const result = await recordManualDebt({
    customerId: first.customer.id,
    debtId: first.debt.id,
    name: "Kojo Mensah",
    ghanaCardNumber: "GHA-123456789-0",
    amountPesewas: 22,
    installmentPlan: {
      isInstallmentPlan: true,
      installmentAmount: 3000,
      frequency: "weekly",
      nextDueDate: "2026-11-24",
      installmentsRemaining: 2,
      totalInstallments: 2
    }
  });

  assert.equal(result.debt.amountPesewas, 6022);
  assert.equal(result.debt.installmentsRemaining, 3);
});

test("manual debt plan changes preserve partial carry and completed history", async () => {
  const first = await recordManualDebt({
    name: "Yaw Mensah",
    ghanaCardNumber: "GHA-123456789-0",
    amountPesewas: 10000,
    installmentPlan: {
      isInstallmentPlan: true,
      installmentAmount: 2000,
      frequency: "weekly",
      nextDueDate: "2026-11-24",
      installmentsRemaining: 5,
      totalInstallments: 5
    }
  });

  await recordDebtCollection({
    debtId: first.debt.id,
    parts: [{ paymentMethod: "cash", amountPesewas: 500 }],
    now: 100
  });

  const result = await recordManualDebt({
    customerId: first.customer.id,
    debtId: first.debt.id,
    name: "Yaw Mensah",
    ghanaCardNumber: "GHA-123456789-0",
    amountPesewas: 1000,
    installmentPlan: {
      isInstallmentPlan: true,
      installmentAmount: 2500,
      frequency: "monthly",
      nextDueDate: "2026-11-24",
      installmentsRemaining: 5,
      totalInstallments: 5
    },
    now: 200
  });

  assert.equal(result.debt.amountPesewas, 10500);
  assert.equal(result.debt.frequency, "monthly");
  assert.equal(result.debt.installmentAmount, 2500);
  assert.equal(result.debt.installmentPaymentCarryPesewas, 500);
  assert.equal(result.debt.installmentsRemaining, 5);
  assert.equal(result.debt.totalInstallments, 5);
  assert.equal(result.debt.nextDueDate, "2026-11-24");
});
