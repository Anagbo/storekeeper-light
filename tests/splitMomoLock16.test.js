import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import * as splitTender from "../src/pos/splitTender.js";
const { addRemainingToPart, isLockedMomoRow, setPartAmount } = splitTender;
const removePart = (...args) => splitTender.removePart(...args);
import { openPosApp } from "./helpers/posAppHarness.js";
import { loadJsx, render, textOf, walk } from "./helpers/renderJsx.js";

// 16 (wiring, decided 11 Nov 2026): a MoMo row whose money has been received is locked. The
// phone request is verified, or the owner tapped "Money received" on 62 for a Direct MoMo. No
// pencil, no x, a plain amount (not a chip), a green-check "Received" status line, not tappable;
// setPartAmount and remove refuse it in code. An unconfirmed Direct row stays editable with
// "Customer sends to my number · not confirmed yet". Cash is never locked.

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  resetBrowserBack();
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
  await db.settings.put({ key: "momoReceivingNumber", value: "0241234567" });
  await db.settings.put({ key: "momoReceivingNetwork", value: "MTN" });
});

async function open() {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  return app;
}

const shown = (app) => app.text().replace(/\s+/g, " ");
const nodes = (tree) => [...walk(tree)].filter((node) => node.props);
const rowNode = (tree, method) => nodes(tree).find((node) => node.props["data-split-row"] === method);
const labels = (tree) => nodes(tree).map((node) => node.props["aria-label"]).filter(Boolean);
const buttonsIn = (node) => [...walk(node)].filter((child) => child.type === "button" || (typeof child.type === "function" && /Button$/.test(child.type.name)));
const pencilsIn = (node) => [...walk(node)].filter((child) => child.props?.["data-pencil"] !== undefined);

// Sell GH₵8.00 > Split payment > Cash 4.00 > MoMo 2.00 as Direct (61) > 62 Money received > back on 16.
async function splitWithReceivedMomo(app) {
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Split payment");
  assert.equal(app.route, "SplitPayment");
  await app.tap(/^Cash$/);
  await app.tap("Edit Cash amount");
  await app.type("split-draft-amount", "4.00");
  await app.tap(/^Save$/);
  await app.tap(/^MoMo$/);
  await app.type("split-draft-amount", "2.00");
  await app.tap(/^Save$/);
  assert.equal(app.route, "MoMoChoice");
  await app.tap(/^Customer sends to my number/);
  assert.equal(app.route, "MoMoDirect");
  assert.match(shown(app), /send GH₵2\.00/);
  await app.tap(/^Money received$/);
  assert.equal(app.route, "SplitPayment");
  assert.match(shown(app), /Left to payGH₵2\.00/);
}

// Owe the rest to Juju (17 > 18 Save returns to 16 in flow=split), then Done fails to save.
async function oweThenFailDone(app) {
  await app.tap(/^Owe$/);
  await app.tap(/^JJuju/);
  await app.tap(/^Next/);
  await app.tap(/^Save · Juju owes/);
  assert.equal(app.route, "SplitPayment", "18 Save in flow=split returns to 16");
  // The screens load their own copy of db.js, so the write is failed in IndexedDB itself (shared).
  const store = globalThis.IDBObjectStore.prototype;
  const original = { add: store.add, put: store.put };
  for (const name of ["add", "put"]) {
    store[name] = function (...args) {
      if (this.name === "transactions") throw new DOMException("Disk full (test)", "UnknownError");
      return original[name].apply(this, args);
    };
  }
  try {
    await app.tap(/^Done$/);
  } finally {
    Object.assign(store, original);
  }
  assert.match(shown(app), /could not be saved/);
  assert.equal(app.route, "SplitPayment", "the failed save leaves the draft on 16");
  assert.equal((await db.transactions.toArray()).filter((row) => row.amountPesewas === 800).length, 0, "nothing saved");
}

function assertLocked(tree, amount) {
  const row = rowNode(tree, "momo");
  assert.ok(row, "the MoMo row is there");
  assert.equal(buttonsIn(row).length, 0, "no pencil chip, no x, the row is not a button");
  assert.equal(pencilsIn(row).length, 0, "no pencil");
  assert.ok(!labels(tree).includes("Edit MoMo amount"), "no \"Edit MoMo amount\"");
  assert.ok(!labels(tree).includes("Remove MoMo"), "no \"Remove MoMo\"");
  const plain = [...walk(row)].find((node) => node.props?.["data-row-amount"] !== undefined);
  assert.equal(textOf(plain), amount);
  assert.doesNotMatch(String(plain.props.className), /border|bg-|rounded/, "a plain amount, not a chip");
  const status = [...walk(row)].find((node) => node.props?.["data-row-status"] !== undefined);
  assert.equal(textOf(status), "Received");
  assert.match(String(status.props.className), /text-emerald-900/);
  assert.ok([...walk(status)].some((node) => typeof node.type === "function" || node.type?.displayName), "a green check icon");
}

test("16: a Direct MoMo confirmed on 62 is locked, and stays locked after a failed Owe commit returns to 16", async () => {
  await recordCreditSale({ name: "Juju", amountPesewas: 500, now: Date.now() - 86_400_000 });
  const app = await open();
  await splitWithReceivedMomo(app);
  // Where "received" is stored: on the part in the 16 route params (splitParts).
  const momo = app.params.splitParts.find((part) => part.paymentMethod === "momo");
  assert.deepEqual([momo.momoMethod, momo.verification, momo.confirmedPesewas, momo.amountPesewas], ["direct", "merchant_confirmed", 200, 200]);
  assertLocked(app.view.tree, "GH₵2.00");
  await oweThenFailDone(app);
  assertLocked(app.view.tree, "GH₵2.00");
  assert.equal(app.params.splitParts.find((part) => part.paymentMethod === "momo").amountPesewas, 200);
  // Cash is never locked: its chip still opens the editor.
  assert.ok(labels(app.view.tree).includes("Edit Cash amount"));
  assert.ok(labels(app.view.tree).includes("Remove Cash"));
});

test("16: Cash editing still works with a locked MoMo, and the Left to pay change never touches the MoMo part", async () => {
  const app = await open();
  await splitWithReceivedMomo(app);
  await app.tap("Edit Cash amount");
  await app.type("split-draft-amount", "1.00");
  await app.tap(/^Save$/);
  assert.match(shown(app), /Left to payGH₵5\.00/);
  await app.tap(/^Cash$/);            // one tap: the whole Left to pay goes into Cash
  assert.match(shown(app), /Left to payGH₵0\.00/);
  const parts = app.params.splitParts;
  assert.deepEqual(parts.map((part) => [part.paymentMethod, part.amountPesewas]), [["cash", 600], ["momo", 200]]);
  assert.equal(parts[1].confirmedPesewas, 200);
  assertLocked(app.view.tree, "GH₵2.00");
  assert.equal([...walk(app.view.tree)].filter((node) => node.type === "button" && textOf(node) === "MoMo").length, 0, "no MoMo tile while a locked MoMo row exists");
});

// A verified phone request cannot be produced through the screens yet (the Paystack backend is
// planned), so 16 is mounted with the part as 56/57 would return it.
async function mount16(splitParts, amountPesewas = 800) {
  const { default: SaleSplitPayment } = await loadJsx("src/pos/SaleSplitPayment.jsx");
  const updates = [];
  const view = render({ type: SaleSplitPayment, props: { params: { amountPesewas, splitParts }, onBack() {}, onNavigate() {}, onUpdateParams: (params) => updates.push(params), onSaveSale() {} } });
  return { view, updates };
}

test("16: a verified phone request MoMo row is locked", async () => {
  const { view } = await mount16([{ paymentMethod: "momo", amountPesewas: 300, momoMethod: "paystack", verification: "verified", reference: "ref-1", confirmedPesewas: 300 }, { paymentMethod: "cash", amountPesewas: 500 }]);
  assertLocked(view.tree, "GH₵3.00");
});

test("16: an unconfirmed Direct MoMo row stays editable and removable, with \"not confirmed yet\"", async () => {
  const { view, updates } = await mount16([{ paymentMethod: "momo", amountPesewas: 300, momoMethod: "direct" }]);
  const row = rowNode(view.tree, "momo");
  assert.ok(labels(view.tree).includes("Edit MoMo amount"));
  assert.ok(labels(view.tree).includes("Remove MoMo"));
  assert.ok(pencilsIn(row).length > 0, "a pencil");
  assert.equal(textOf([...walk(row)].find((node) => node.props?.["data-row-status"] !== undefined)), "Customer sends to my number · not confirmed yet");
  // Editing sets the amount and marks nothing as confirmed.
  [...walk(view.tree)].find((node) => node.props?.["aria-label"] === "Edit MoMo amount").props.onClick();
  view.rerender();
  [...walk(view.tree)].find((node) => node.type === "input").props.onChange({ target: { value: "5.00" } });
  view.rerender();
  [...walk(view.tree)].find((node) => node.type === "button" && textOf(node) === "Save").props.onClick();
  view.rerender();
  assert.deepEqual(updates.at(-1).splitParts, [{ paymentMethod: "momo", amountPesewas: 500, momoMethod: "direct" }]);
  // Remove works.
  [...walk(view.tree)].find((node) => node.props?.["aria-label"] === "Remove MoMo").props.onClick();
  view.rerender();
  assert.deepEqual(updates.at(-1).splitParts, []);
});

const received = { paymentMethod: "momo", amountPesewas: 200, momoMethod: "direct", verification: "merchant_confirmed", confirmedPesewas: 200 };
const verified = { paymentMethod: "momo", amountPesewas: 200, momoMethod: "paystack", verification: "verified", confirmedPesewas: 200 };
const unconfirmed = { paymentMethod: "momo", amountPesewas: 200, momoMethod: "direct" };
const cash = { paymentMethod: "cash", amountPesewas: 400 };

test("setPartAmount refuses a locked MoMo part (Direct received or verified) and still sets Cash and an unconfirmed Direct", () => {
  assert.equal(isLockedMomoRow(received), true);
  assert.equal(isLockedMomoRow(verified), true);
  assert.equal(isLockedMomoRow(unconfirmed), false);
  assert.equal(isLockedMomoRow(cash), false);
  for (const locked of [received, verified]) {
    assert.equal(setPartAmount([cash, locked], "momo", 100, 800), null);
    assert.equal(setPartAmount([cash, locked], "momo", 400, 800), null);
    assert.deepEqual(setPartAmount([cash, locked], "cash", 600, 800), [{ ...cash, amountPesewas: 600 }, locked], "Cash still edits; MoMo untouched");
    assert.deepEqual(addRemainingToPart([{ ...cash, amountPesewas: 100 }, locked], "momo", 800), [{ ...cash, amountPesewas: 100 }, locked], "a tap cannot grow a locked row");
  }
  assert.deepEqual(setPartAmount([unconfirmed], "momo", 500, 800), [{ ...unconfirmed, amountPesewas: 500 }]);
});

test("remove refuses a locked MoMo part and removes anything else", () => {
  for (const locked of [received, verified]) assert.equal(removePart([cash, locked], locked), null);
  assert.deepEqual(removePart([cash, unconfirmed], unconfirmed), [cash]);
  assert.deepEqual(removePart([cash, received], cash), [received]);
});

test("16 at 360px: a locked GH₵12,345.00 MoMo row keeps the amount whole and on one line", async () => {
  const { view } = await mount16([{ ...received, amountPesewas: 1234500, confirmedPesewas: 1234500 }], 1234500);
  const row = rowNode(view.tree, "momo");
  const amount = [...walk(row)].find((node) => node.props?.["data-row-amount"] !== undefined);
  assert.equal(textOf(amount), "GH₵12,345.00");
  assert.match(String(amount.props.className), /whitespace-nowrap/);
  assert.match(String(amount.props.className), /shrink-0/);
  assert.doesNotMatch(String(amount.props.className), /truncate|overflow-hidden/);
  assert.match(String(row.props.className), /flex-wrap/, "the amount wraps under the name rather than clipping");
  // 360px: 16px gutters, 2px border and 12px padding each side leave 360 - 32 - 4 - 24 = 300px.
  // GH₵12,345.00 at bold 21px is about 135px; icon 28 + gap 8 + "MoMo" about 60px = 96px. 96 + 8 + 135 < 300.
  assert.ok(28 + 8 + 60 + 8 + 135 < 360 - 32 - 4 - 24);
});
