import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldRestoreBackupRecord,
  validateBackupData
} from "../src/utils/backup.js";

function makeBackup() {
  return {
    app: "StoreKeeper Light",
    formatVersion: 1,
    exportedAt: "2026-10-22T00:00:00.000Z",
    data: {
      transactions: [{ id: "transaction-1" }],
      customers: [{ id: "customer-1", ghanaCardNumber: "GHA-123456789-0" }],
      debts: [{
        id: "debt-1",
        ghanaCardNumber: "1234567890",
        isInstallmentPlan: true,
        installmentAmount: 2500,
        frequency: "weekly",
        nextDueDate: "2026-11-01",
        installmentsRemaining: 4,
        totalInstallments: 8
      }],
      products: [{ id: 1 }],
      payments: [],
      suppliers: [{ id: "supplier-1", name: "Market Wholesale", nameLower: "market wholesale", phone: "" }]
    }
  };
}

test("accepts a valid StoreKeeper backup with all data tables", () => {
  assert.deepEqual(validateBackupData(makeBackup()), makeBackup().data);
  assert.equal(validateBackupData(makeBackup()).customers[0].ghanaCardNumber, "GHA-123456789-0");
  assert.equal(validateBackupData(makeBackup()).debts[0].ghanaCardNumber, "1234567890");
  assert.equal(validateBackupData(makeBackup()).debts[0].nextDueDate, "2026-11-01");
  assert.equal(validateBackupData(makeBackup()).suppliers[0].name, "Market Wholesale");
});

test("accepts older backups without payment details and restores the table as empty", () => {
  const backup = makeBackup();
  delete backup.data.payments;
  delete backup.data.suppliers;
  assert.deepEqual(validateBackupData(backup).payments, []);
  assert.deepEqual(validateBackupData(backup).suppliers, []);
});

test("preserves payment details in backup data", () => {
  const backup = makeBackup();
  backup.data.payments = [{
    id: "payment-1",
    debtId: "debt-1",
    amountPesewas: 2000,
    paymentMethod: "cash",
    createdAt: 1792684800000,
    updatedAt: 1792684800000
  }];
  assert.deepEqual(validateBackupData(backup).payments, backup.data.payments);
});

test("preserves debt adjustment relationships and correction metadata", () => {
  const backup = makeBackup();
  backup.data.transactions = [{
    id: "adjustment-1",
    type: "debt_adjustment",
    debtId: "debt-1",
    customerId: "customer-1",
    amountPesewas: 0,
    deltaPesewas: -2500,
    previousBalancePesewas: 10000,
    newBalancePesewas: 7500,
    reasonCode: "wrong_amount",
    reasonNote: "",
    debtBefore: { amountPesewas: 10000 },
    debtAfter: { amountPesewas: 7500 }
  }];
  const restored = validateBackupData(backup);
  assert.deepEqual(restored.transactions[0], backup.data.transactions[0]);
});

test("rejects unsupported or incomplete backup files", () => {
  assert.throws(() => validateBackupData({ ...makeBackup(), formatVersion: 2 }), /supported/);
  const incomplete = makeBackup();
  delete incomplete.data.customers;
  assert.throws(() => validateBackupData(incomplete), /customers/);
});

test("rejects records without IDs and product IDs of the wrong type", () => {
  const missingId = makeBackup();
  missingId.data.debts = [{ customerName: "Ama" }];
  assert.throws(() => validateBackupData(missingId), /invalid record in debts/);

  const invalidProductId = makeBackup();
  invalidProductId.data.products = [{ id: "1" }];
  assert.throws(() => validateBackupData(invalidProductId), /product with an invalid ID/);
});

test("rejects duplicate IDs and broken backup relationships", () => {
  const duplicate = makeBackup();
  duplicate.data.products = [{ id: 1 }, { id: 1 }];
  assert.throws(() => validateBackupData(duplicate), /duplicate IDs/);

  const brokenPayment = makeBackup();
  brokenPayment.data.payments = [{ id: "payment-1", debtId: "missing-debt" }];
  assert.throws(() => validateBackupData(brokenPayment), /unknown debt ID/);
});

test("does not restore an older timestamp over newer local data", () => {
  assert.equal(
    shouldRestoreBackupRecord({ id: "sale-1", updatedAt: 200 }, { id: "sale-1", updatedAt: 100 }),
    false
  );
  assert.equal(
    shouldRestoreBackupRecord({ id: "sale-1", updatedAt: 100 }, { id: "sale-1", updatedAt: 200 }),
    true
  );
  assert.equal(
    shouldRestoreBackupRecord({ id: "sale-1" }, { id: "sale-1" }),
    true
  );
});
