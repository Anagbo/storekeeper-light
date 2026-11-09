import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { importDatabaseFromJson, validateBackupData } from "../src/utils/backup.js";

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  await Promise.all(["transactions", "payments", "debts", "customers", "products", "suppliers", "settings"].map((name) => db.table(name).clear()));
});

const sale = { id: "sale-1", type: "sale", amountPesewas: 1000, total_amount: 1000, payment_method: "cash", cashReceivedPesewas: 1000, momoReceivedPesewas: 0, createdAt: 100, timestamp: 100, updatedAt: 100 };
const debt = { id: "debt-1", customerId: "customer-1", status: "unpaid", amountPesewas: 5000, total_owed: 5000, updatedAt: 100 };
const payment = { id: "payment-1", debtId: "debt-1", amountPesewas: 2000, paymentMethod: "cash", createdAt: 100, updatedAt: 100 };

function backupWith(data) {
  return {
    app: "StoreKeeper Light",
    formatVersion: 1,
    exportedAt: "2026-11-09T00:00:00.000Z",
    data: { transactions: [], customers: [{ id: "customer-1" }], debts: [debt], products: [], payments: [], suppliers: [], ...data }
  };
}
function file(backup) {
  return { text: async () => JSON.stringify(backup) };
}

test("D4: restore never overwrites an existing sale, even with a newer updatedAt", async () => {
  await db.transactions.add(sale);
  await importDatabaseFromJson(file(backupWith({ transactions: [{ ...sale, amountPesewas: 99900, total_amount: 99900, cashReceivedPesewas: 99900, updatedAt: 999 }] })));
  assert.equal((await db.transactions.get("sale-1")).amountPesewas, 1000);
});

test("D4: restore never overwrites an existing payment row", async () => {
  await db.customers.add({ id: "customer-1" });
  await db.debts.add(debt);
  await db.payments.add(payment);
  await importDatabaseFromJson(file(backupWith({ payments: [{ ...payment, amountPesewas: 4900, updatedAt: 999 }] })));
  assert.equal((await db.payments.get("payment-1")).amountPesewas, 2000);
});

test("D4: restore still adds ledger rows the device does not have", async () => {
  await importDatabaseFromJson(file(backupWith({ transactions: [sale], payments: [payment] })));
  assert.equal((await db.transactions.get("sale-1")).amountPesewas, 1000);
  assert.equal((await db.payments.get("payment-1")).amountPesewas, 2000);
});

test("D4: restore rejects invalid amounts and writes nothing", async () => {
  for (const bad of [10.5, -100, "1000", Number.MAX_SAFE_INTEGER + 2]) {
    await assert.rejects(
      importDatabaseFromJson(file(backupWith({ transactions: [{ ...sale, id: `bad-${String(bad)}`, amountPesewas: bad }] }))),
      /invalid amount/
    );
  }
  await assert.rejects(importDatabaseFromJson(file(backupWith({ payments: [{ ...payment, amountPesewas: 0 }] }))), /invalid amount/);
  await assert.rejects(importDatabaseFromJson(file(backupWith({ debts: [{ ...debt, amountPesewas: -1 }] }))), /invalid amount/);
  assert.equal(await db.transactions.count(), 0);
  assert.equal(await db.debts.count(), 0);
});

test("D4: restore rejects unknown transaction types, payment methods and debt statuses", () => {
  assert.throws(() => validateBackupData(backupWith({ transactions: [{ ...sale, type: "free_money" }] })), /unknown transaction type/);
  assert.throws(() => validateBackupData(backupWith({ payments: [{ ...payment, paymentMethod: "cheque" }] })), /unknown payment method/);
  assert.throws(() => validateBackupData(backupWith({ debts: [{ ...debt, status: "forgiven" }] })), /unknown debt status/);
});

test("D4: restore accepts every stored transaction type the app writes", () => {
  const types = ["sale", "cash_sale", "credit_sale", "installment_sale", "installment_addon", "income", "income_reversal", "debt_payment", "expense", "supplier_payment", "manual_debt", "debt_adjustment"];
  const transactions = types.map((type, index) => ({ id: `t-${index}`, type, amountPesewas: 0 }));
  assert.equal(validateBackupData(backupWith({ transactions })).transactions.length, types.length);
});

test("D4: restore records a local log entry with what was added and skipped", async () => {
  await db.transactions.add(sale);
  const result = await importDatabaseFromJson(file(backupWith({ transactions: [{ ...sale, updatedAt: 999 }, { ...sale, id: "sale-2" }] })));
  const log = JSON.parse((await db.settings.get("backupRestoreLog")).value);
  assert.equal(log.length, 1);
  assert.equal(log[0].skippedLedgerRows, 1);
  assert.equal(log[0].added.transactions, 1);
  assert.ok(Number.isFinite(Date.parse(log[0].restoredAt)));
  assert.equal(result.transactions, 2, "the returned counts keep their meaning: records in the backup");
});