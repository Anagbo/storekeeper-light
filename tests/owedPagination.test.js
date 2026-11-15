import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { getOwedCursor, loadUnpaidDebtPage } from "../src/pos/owed.js";

before(async () => {
  await db.open();
});

beforeEach(async () => {
  await db.debts.clear();
});

after(async () => {
  db.close();
  await db.delete();
});

test("loads unpaid debts in bounded descending pages with a stable cursor", async () => {
  await db.debts.bulkAdd([
    { id: "debt-1", status: "unpaid", amountPesewas: 3000, customerName: "Ama" },
    { id: "debt-2", status: "unpaid", amountPesewas: 2000, customerName: "Kofi" },
    { id: "debt-3", status: "unpaid", amountPesewas: 1000, customerName: "Yaw" },
    { id: "paid", status: "paid", amountPesewas: 9000, customerName: "Paid" }
  ]);

  const first = await loadUnpaidDebtPage({ pageSize: 2 });
  assert.deepEqual(first.debts.map((debt) => debt.id), ["debt-1", "debt-2"]);
  assert.equal(first.hasMore, true);
  assert.deepEqual(first.nextCursor, { amountPesewas: 2000, id: "debt-2" });

  const second = await loadUnpaidDebtPage({ pageSize: 2, after: first.nextCursor });
  assert.deepEqual(second.debts.map((debt) => debt.id), ["debt-3"]);
  assert.equal(second.hasMore, false);
  assert.equal(second.nextCursor, null);
});

test("creates cursors from legacy total_owed balances and rejects invalid paging", async () => {
  assert.deepEqual(getOwedCursor({ id: "legacy", total_owed: 1250 }), {
    amountPesewas: 1250,
    id: "legacy"
  });
  await assert.rejects(
    loadUnpaidDebtPage({ pageSize: 0 }),
    /page size/
  );
  await assert.rejects(
    loadUnpaidDebtPage({ after: { amountPesewas: -1, id: "debt" } }),
    /cursor/
  );
});
