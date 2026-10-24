import test from "node:test";
import assert from "node:assert/strict";
import { validateBackupData } from "../src/utils/backup.js";

function makeBackup() {
  return {
    app: "StoreKeeper Light",
    formatVersion: 1,
    exportedAt: "2026-10-22T00:00:00.000Z",
    data: {
      transactions: [{ id: "transaction-1" }],
      customers: [{ id: "customer-1", ghanaCardNumber: "GHA-123456789-0" }],
      debts: [{ id: "debt-1", ghanaCardNumber: "1234567890" }],
      products: [{ id: 1 }]
    }
  };
}

test("accepts a valid StoreKeeper backup with all data tables", () => {
  assert.deepEqual(validateBackupData(makeBackup()), makeBackup().data);
  assert.equal(validateBackupData(makeBackup()).customers[0].ghanaCardNumber, "GHA-123456789-0");
  assert.equal(validateBackupData(makeBackup()).debts[0].ghanaCardNumber, "1234567890");
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
