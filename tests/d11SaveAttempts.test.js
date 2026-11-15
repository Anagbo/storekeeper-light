import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCashSale } from "../src/db/sales.js";
import { recordCreditSale, recordDebtCollection } from "../src/db/debts.js";
import { recordManualDebt } from "../src/db/debtLedger.js";
import {
  runTransactionWithTimeout,
  SaveOutcomeUnknownError,
  SaveTimeoutError
} from "../src/db/runTransactionWithTimeout.js";
import { SaveAttemptMismatchError } from "../src/db/saveAttempts.js";
import { fingerprintSave } from "../src/lib/saveAttempt.js";
import { posText } from "../src/pos/i18n.js";
import { findButton, findComponent, loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// D11 (Batch 14, part 1): a save that times out must not be recorded twice.
after(async () => {
  db.close();
  await db.delete();
});
beforeEach(async () => {
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings].map((table) => table.clear()));
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = () => new Promise((resolve) => setImmediate(resolve));
// A database that runs the work at once but commits `delay` ms later (the D11 case:
// the timeout fires while the commit is still finishing).
function slowDb(delay) {
  return {
    transaction(_mode, ...args) {
      const operation = args.pop();
      return Promise.resolve().then(operation).then((value) => wait(delay).then(() => value));
    }
  };
}

// --- runTransactionWithTimeout: wait for the real result ---

test("D11: a save that finishes after the timeout returns success, not an error", async () => {
  const result = await runTransactionWithTimeout(slowDb(30), ["transactions"], async () => "saved", 10, 200);
  assert.equal(result, "saved");
});

test("D11: a save that never settles throws SaveOutcomeUnknownError (not 'not recorded')", async () => {
  const neverDb = { transaction: () => new Promise(() => {}) };
  await assert.rejects(
    runTransactionWithTimeout(neverDb, ["transactions"], async () => "saved", 10, 20),
    (error) => error instanceof SaveOutcomeUnknownError && !(error instanceof SaveTimeoutError)
  );
});

test("D11: a save cancelled after the timeout throws SaveTimeoutError (certainly not saved)", async () => {
  const cancelledDb = { transaction: () => wait(20).then(() => { throw new Error("AbortError"); }) };
  await assert.rejects(
    runTransactionWithTimeout(cancelledDb, ["transactions"], async () => "saved", 10, 200),
    SaveTimeoutError
  );
});

// --- writers: the same attemptId twice gives one record ---

test("D11 writer: recordCashSale with the same attemptId twice saves one sale and returns the same result", async () => {
  const first = await recordCashSale({ amountPesewas: 1000, attemptId: "a-sale" });
  const second = await recordCashSale({ amountPesewas: 1000, attemptId: "a-sale" });
  assert.equal(await db.transactions.count(), 1);
  assert.equal(second.id, first.id);
});

test("D11 writer: recordCreditSale with the same attemptId twice saves one sale and one debt", async () => {
  const details = { amountPesewas: 2000, name: "Ama", initialPaymentPesewas: 500, attemptId: "a-credit" };
  const first = await recordCreditSale(details);
  const counts = async () => [await db.debts.count(), await db.transactions.count(), await db.payments.count()];
  const afterFirst = await counts();
  const second = await recordCreditSale(details);
  assert.deepEqual(await counts(), afterFirst);
  assert.equal(await db.debts.count(), 1);
  assert.equal((await db.debts.toArray())[0].amountPesewas, 1500);
  assert.equal(second.transactionId, first.transactionId);
});

test("D11 writer: recordDebtCollection with the same attemptId twice records one collection", async () => {
  const { debt } = await recordManualDebt({ name: "Kofi", amountPesewas: 3000 });
  const parts = [{ paymentMethod: "cash", amountPesewas: 1000 }];
  const first = await recordDebtCollection({ debtId: debt.id, parts, attemptId: "a-collect" });
  const second = await recordDebtCollection({ debtId: debt.id, parts, attemptId: "a-collect" });
  assert.equal(await db.payments.count(), 1);
  assert.equal((await db.debts.get(debt.id)).amountPesewas, 2000);
  assert.equal(second.collectionId, first.collectionId);
});

test("D11 writer: recordManualDebt with the same attemptId twice records the debt once", async () => {
  const details = { name: "Yaw", amountPesewas: 4000, attemptId: "a-manual" };
  const first = await recordManualDebt(details);
  const second = await recordManualDebt(details);
  assert.equal(await db.debts.count(), 1);
  assert.equal((await db.debts.get(first.debt.id)).amountPesewas, 4000);
  assert.equal(second.debt.id, first.debt.id);
});

// --- owner condition 2: a stored result is never returned for different content ---

test("D11 condition: the writer refuses a stored result when the content is different", async () => {
  await recordCashSale({ amountPesewas: 1000, attemptId: "a-same-key" });
  await assert.rejects(recordCashSale({ amountPesewas: 1500, attemptId: "a-same-key" }), SaveAttemptMismatchError);
  await assert.rejects(
    recordCashSale({ amountPesewas: 1000, cashReceivedPesewas: 0, momoReceivedPesewas: 1000, attemptId: "a-same-key" }),
    SaveAttemptMismatchError
  );
  assert.equal(await db.transactions.count(), 1);

  const { debt } = await recordManualDebt({ name: "Kofi", amountPesewas: 3000 });
  await recordDebtCollection({ debtId: debt.id, parts: [{ paymentMethod: "cash", amountPesewas: 500 }], attemptId: "a-collect-key" });
  await assert.rejects(
    recordDebtCollection({ debtId: debt.id, parts: [{ paymentMethod: "cash", amountPesewas: 700 }], attemptId: "a-collect-key" }),
    SaveAttemptMismatchError
  );
  assert.equal((await db.debts.get(debt.id)).amountPesewas, 2500);
});

test("D11: the fingerprint ignores key order but not values", () => {
  assert.equal(fingerprintSave({ a: 1, b: [1, 2] }), fingerprintSave({ b: [1, 2], a: 1 }));
  assert.notEqual(fingerprintSave({ a: 1, b: [1, 2] }), fingerprintSave({ a: 1, b: [2, 1] }));
  assert.notEqual(fingerprintSave({ a: 1 }), fingerprintSave({ a: 2 }));
});

test("D11: old save attempt records are pruned to the last 50", async () => {
  for (let index = 0; index < 55; index += 1) {
    await recordCashSale({ amountPesewas: 100 + index, attemptId: `a-prune-${index}`, now: index + 1 });
  }
  const keys = (await db.settings.toArray()).map((row) => row.key).filter((key) => key.startsWith("saveAttempt:"));
  assert.equal(keys.length, 50);
  assert.ok(!keys.includes("saveAttempt:a-prune-0"));
  assert.ok(keys.includes("saveAttempt:a-prune-54"));
});

// --- screens: Try again keeps the key; changed content gets a new key (owner condition 1) ---

const unknownError = () => Object.assign(new Error("unknown"), { name: "SaveOutcomeUnknownError" });
const quietly = async (run) => {
  const original = console.error;
  console.error = () => {};
  try { return await run(); } finally { console.error = original; }
};
const exactButton = (tree, label) => [...walk(tree)].find((node) => node.type === "button" && textOf(node) === label);

test("D11 screen 15: Try again after an unknown result keeps the same key; a changed amount gets a new key", async () => {
  const { default: Sell } = await loadJsx("src/pos/Sell.jsx");
  const attempts = [];
  const recordSale = async (details) => {
    attempts.push(details.attemptId);
    throw unknownError();
  };
  const view = render({ type: Sell, props: { params: {}, onNavigate() {}, recordSale } });
  for (const digit of ["1", "0"]) {
    exactButton(view.tree, digit).props.onClick();
    view.rerender();
  }
  await quietly(async () => {
    findButton(view.tree, posText("sell.done")).props.onClick();
    await settle();
    view.rerender();
    assert.match(textOf(view.tree), /We could not confirm this was saved\. Tap Try again\. It will not be recorded twice\./);
    assert.doesNotMatch(textOf(view.tree), /not recorded\./);
    findButton(view.tree, posText("save.tryAgain")).props.onClick();
    await settle();
    view.rerender();
    exactButton(view.tree, "5").props.onClick();
    view.rerender();
    findButton(view.tree, posText("sell.done")).props.onClick();
    await settle();
  });
  assert.equal(attempts.length, 3);
  assert.ok(attempts[0]);
  assert.equal(attempts[1], attempts[0], "Try again reuses the key");
  assert.notEqual(attempts[2], attempts[0], "a changed amount makes a new key");
});

test("D11 screen 26: Try again after an unknown result keeps the same key; a changed amount gets a new key", async () => {
  const { CollectPayPart } = await loadJsx("src/pos/DebtCollection.jsx");
  const debt = { id: "d1", amountPesewas: 50000, customerName: "Ama", status: "unpaid" };
  setLiveQuery(([debtId]) => (debtId === "d1" ? debt : undefined));
  const attempts = [];
  const onRecordCollection = async (_debtId, parts, attemptId) => {
    attempts.push(attemptId);
    throw unknownError();
  };
  try {
    const view = render({ type: CollectPayPart, props: { params: { debtId: "d1", amount: "10" }, onBack() {}, onNavigate() {}, onUpdateParams() {}, onRecordCollection } });
    await quietly(async () => {
      findButton(view.tree, posText("collect.received")).props.onClick();
      await settle();
      view.rerender();
      assert.match(textOf(view.tree), /We could not confirm this was saved\./);
      findButton(view.tree, posText("save.tryAgain")).props.onClick();
      await settle();
      view.rerender();
      findComponent(view.tree, "AmountKeypad").props.onKey("5");
      view.rerender();
      findButton(view.tree, posText("collect.received")).props.onClick();
      await settle();
    });
  } finally {
    setLiveQuery(null);
  }
  assert.equal(attempts.length, 3);
  assert.ok(attempts[0]);
  assert.equal(attempts[1], attempts[0], "Try again reuses the key");
  assert.notEqual(attempts[2], attempts[0], "a changed amount makes a new key");
});

test("D11 messages: checking and unknown wording as approved", () => {
  assert.equal(posText("save.checking"), "Still saving… please wait.");
  assert.equal(posText("save.outcomeUnknown"), "We could not confirm this was saved. Tap Try again. It will not be recorded twice.");
  assert.equal(posText("save.tryAgain"), "Try again");
});
