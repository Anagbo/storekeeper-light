import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import Dexie from "dexie";
import { runTransactionWithTimeout, SaveTimeoutError } from "../src/db/runTransactionWithTimeout.js";
const atomicDb = new Dexie(`StoreKeeperAtomicity-${process.pid}`);
atomicDb.version(1).stores({ transactions: "id, syncStatus" });

before(async () => {
  await atomicDb.open();
});

beforeEach(async () => {
  await atomicDb.transactions.clear();
});

after(async () => {
  atomicDb.close();
  await atomicDb.delete();
});

function createFakeDb() {
  return {
    transaction(_mode, ...args) {
      const operation = args.pop();
      return Promise.resolve().then(operation);
    }
  };
}

test("runs transaction operations and returns their result", async () => {
  const result = await runTransactionWithTimeout(
    createFakeDb(),
    ["transactions"],
    async () => "saved"
  );

  assert.equal(result, "saved");
});

test("rejects operations that exceed the save deadline", async () => {
  await assert.rejects(
    runTransactionWithTimeout(
      createFakeDb(),
      ["transactions"],
      () => new Promise(() => {}),
      10
    ),
    SaveTimeoutError
  );
});

test("does not run a transaction callback that starts after the deadline", async () => {
  let callback;
  const delayedDb = {
    transaction(_mode, ...args) {
      callback = args.pop();
      return new Promise((resolve, reject) => {
        setTimeout(() => Promise.resolve().then(callback).then(resolve, reject), 20);
      });
    }
  };
  let wrote = false;

  await assert.rejects(
    runTransactionWithTimeout(delayedDb, ["transactions"], () => { wrote = true; }, 10),
    SaveTimeoutError
  );
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(wrote, false);
});

test("rolls back writes when a Dexie transaction callback fails", async () => {
  await assert.rejects(
    runTransactionWithTimeout(
      atomicDb,
      [atomicDb.transactions],
      async () => {
        await atomicDb.transactions.add({
          id: "timed-out-sale",
          type: "sale",
          amountPesewas: 1000,
          createdAt: 1,
          updatedAt: 1,
          syncStatus: "pending"
        });
        throw new Error("simulated write failure");
      },
      1000
    ),
    /simulated write failure/
  );
  assert.equal(await atomicDb.transactions.count(), 0);
});
