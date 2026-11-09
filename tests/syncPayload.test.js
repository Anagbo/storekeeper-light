import assert from "node:assert/strict";
import { test } from "node:test";
import { createIdempotencyKey, createSyncPayload } from "../src/lib/syncPayload.js";

test("sync payload preserves records while making batch order deterministic", () => {
  const first = createSyncPayload({
    products: [{ id: 2, name: "B" }, { id: 1, name: "A" }],
    transactions: [],
    debts: []
  });
  const second = createSyncPayload({
    products: [{ id: 1, name: "A" }, { id: 2, name: "B" }],
    transactions: [],
    debts: []
  });

  assert.deepEqual(first.body.records.products, [
    { id: 1, name: "A" },
    { id: 2, name: "B" }
  ]);
  assert.equal(first.serializedBody, second.serializedBody);
});

test("identical sync snapshots receive the same idempotency key", async () => {
  const records = {
    products: [],
    transactions: [{ id: "sale-1", updatedAt: 10, syncStatus: "pending" }],
    debts: []
  };
  const first = createSyncPayload(records);
  const second = createSyncPayload(records);

  assert.equal(
    await createIdempotencyKey(first.serializedBody),
    await createIdempotencyKey(second.serializedBody)
  );
});

test("a changed record receives a different idempotency key", async () => {
  const first = createSyncPayload({
    products: [],
    transactions: [{ id: "sale-1", updatedAt: 10 }],
    debts: []
  });
  const second = createSyncPayload({
    products: [],
    transactions: [{ id: "sale-1", updatedAt: 11 }],
    debts: []
  });

  assert.notEqual(
    await createIdempotencyKey(first.serializedBody),
    await createIdempotencyKey(second.serializedBody)
  );
});
