import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { checkLedgerConsistency } from "../src/utils/consistency.js";

const tables = [db.transactions, db.debts, db.payments, db.customers, db.suppliers];

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

test("consistency checker reports a clean ledger without changing records", async () => {
  await db.customers.add({ id: "customer-1", name: "Ama", totalDebtPesewas: 3000 });
  await db.debts.add({ id: "debt-1", customerId: "customer-1", customerName: "Ama", status: "unpaid", amountPesewas: 3000, isInstallmentPlan: false, installmentsRemaining: 0, totalInstallments: 0 });
  await db.transactions.add({ id: "sale-1", type: "sale", amountPesewas: 5000, paymentType: "cash" });
  const before = {
    customers: await db.customers.toArray(),
    debts: await db.debts.toArray(),
    transactions: await db.transactions.toArray()
  };

  const report = await checkLedgerConsistency();
  assert.equal(report.ok, true);
  assert.deepEqual(report.issues, []);
  assert.deepEqual(await db.customers.toArray(), before.customers);
  assert.deepEqual(await db.debts.toArray(), before.debts);
  assert.deepEqual(await db.transactions.toArray(), before.transactions);
});

test("consistency checker reports broken references and balances without auto-fixing", async () => {
  await db.customers.add({ id: "customer-1", name: "Ama", totalDebtPesewas: 1000 });
  await db.debts.add({
    id: "debt-1",
    customerId: "missing-customer",
    customerName: "Ama",
    status: "unpaid",
    amountPesewas: 2000,
    isInstallmentPlan: false,
    installmentsRemaining: 0,
    totalInstallments: 0
  });
  await db.transactions.add({
    id: "bad-sale",
    type: "sale",
    amountPesewas: 1000,
    customerId: "missing-customer",
    debtId: "debt-1",
    cashReceivedPesewas: 900,
    momoReceivedPesewas: 200
  });

  const before = await db.debts.toArray();
  const report = await checkLedgerConsistency();
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((issue) => issue.code === "missing_reference"));
  assert.ok(report.issues.some((issue) => issue.code === "customer_balance_mismatch"));
  assert.ok(report.issues.some((issue) => issue.code === "split_payment_mismatch"));
  assert.ok(report.issues.some((issue) => issue.code === "debt_balance_mismatch"));
  assert.deepEqual(await db.debts.toArray(), before);
});

test("consistency checker includes debt adjustment deltas in debt balances", async () => {
  await db.customers.add({ id: "customer-1", name: "Ama", totalDebtPesewas: 1000 });
  await db.debts.add({
    id: "debt-1",
    customerId: "customer-1",
    customerName: "Ama",
    status: "unpaid",
    amountPesewas: 1000,
    isInstallmentPlan: false,
    installmentsRemaining: 0,
    totalInstallments: 0
  });
  await db.transactions.bulkAdd([
    { id: "sale-1", type: "credit_sale", amountPesewas: 1000, creditExtendedPesewas: 1000, debtId: "debt-1", customerId: "customer-1" },
    { id: "adjustment-1", type: "debt_adjustment", amountPesewas: 0, deltaPesewas: 500, debtId: "debt-1", customerId: "customer-1" }
  ]);
  await db.payments.add({ id: "payment-1", debtId: "debt-1", customerId: "customer-1", amountPesewas: 500 });

  const report = await checkLedgerConsistency();
  assert.equal(report.ok, true);
  assert.deepEqual(report.issues, []);
});

test("consistency checker uses gross credit events when initial payments are recorded separately", async () => {
  await db.customers.add({ id: "customer-1", name: "Ama", totalDebtPesewas: 3000 });
  await db.debts.add({
    id: "debt-1",
    customerId: "customer-1",
    customerName: "Ama",
    status: "unpaid",
    amountPesewas: 3000,
    isInstallmentPlan: false,
    installmentsRemaining: 0,
    totalInstallments: 0
  });
  await db.transactions.add({
    id: "sale-1",
    type: "installment_sale",
    amountPesewas: 10000,
    creditSaleGrossPesewas: 10000,
    creditExtendedPesewas: 3000,
    installmentPaymentPesewas: 7000,
    debtId: "debt-1",
    customerId: "customer-1",
    cashReceivedPesewas: 7000,
    momoReceivedPesewas: 0
  });
  await db.payments.bulkAdd([
    { id: "initial-payment", debtId: "debt-1", customerId: "customer-1", amountPesewas: 7000 },
  ]);

  const report = await checkLedgerConsistency();
  assert.equal(report.ok, true);
  assert.deepEqual(report.issues, []);
});

test("consistency checker reconciles customer events allocated across debts", async () => {
  await db.customers.add({ id: "customer-1", name: "Ama", totalDebtPesewas: 9000 });
  await db.debts.bulkAdd([
    {
      id: "debt-1",
      customerId: "customer-1",
      customerName: "Ama",
      status: "unpaid",
      amountPesewas: 6000,
      isInstallmentPlan: false,
      installmentsRemaining: 0,
      totalInstallments: 0
    },
    {
      id: "debt-2",
      customerId: "customer-1",
      customerName: "Ama",
      status: "unpaid",
      amountPesewas: 3000,
      isInstallmentPlan: false,
      installmentsRemaining: 0,
      totalInstallments: 0
    }
  ]);
  await db.transactions.bulkAdd([
    { id: "sale-1", type: "credit_sale", amountPesewas: 10000, creditSaleGrossPesewas: 10000, debtId: "debt-1", customerId: "customer-1" },
    { id: "sale-2", type: "credit_sale", amountPesewas: 5000, creditSaleGrossPesewas: 5000, debtId: "debt-2", customerId: "customer-1" }
  ]);
  await db.payments.bulkAdd([
    { id: "payment-1", debtId: "debt-2", customerId: "customer-1", amountPesewas: 4000, transactionId: "sale-1" },
    { id: "payment-2", debtId: "debt-1", customerId: "customer-1", amountPesewas: 2000, transactionId: "sale-2" }
  ]);

  const report = await checkLedgerConsistency();
  assert.equal(report.ok, true);
  assert.deepEqual(report.issues, []);
});
