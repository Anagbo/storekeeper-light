import assert from "node:assert/strict";
import { test } from "node:test";
import { runTransactionWithTimeout, SaveTimeoutError } from "../src/db/runTransactionWithTimeout.js";

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
