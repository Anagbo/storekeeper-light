import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifySyncRecord,
  SYNC_CONFLICT_POLICIES
} from "../src/lib/syncConflicts.js";

test("sync policy treats transactions as append-only and other synced tables as manual review", () => {
  assert.deepEqual(SYNC_CONFLICT_POLICIES, {
    products: "manual-review",
    transactions: "append-only",
    debts: "manual-review"
  });
});

test("new records are accepted and exact retries are acknowledged idempotently", () => {
  const record = { id: "sale-1", amountPesewas: 1000, syncStatus: "pending", synced: false };

  assert.deepEqual(classifySyncRecord("transactions", null, record), {
    action: "accept",
    reason: "new-record"
  });
  assert.deepEqual(classifySyncRecord("transactions", { ...record, syncStatus: "synced", synced: true }, record), {
    action: "acknowledge",
    reason: "idempotent-duplicate"
  });
});

test("divergent transaction retries are conflicts, never overwrites", () => {
  const result = classifySyncRecord(
    "transactions",
    { id: "sale-1", amountPesewas: 1000 },
    { id: "sale-1", amountPesewas: 1200 }
  );

  assert.deepEqual(result, {
    action: "conflict",
    reason: "immutable-record-changed"
  });
});

test("divergent mutable records require a version conflict decision", () => {
  const result = classifySyncRecord(
    "debts",
    { id: "debt-1", amountPesewas: 1000, updatedAt: 10 },
    { id: "debt-1", amountPesewas: 1200, updatedAt: 11 }
  );

  assert.deepEqual(result, {
    action: "conflict",
    reason: "mutable-record-version-conflict"
  });
});
