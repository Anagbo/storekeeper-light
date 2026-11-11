import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { textOf, walk } from "./helpers/renderJsx.js";

// Wiring 16 (MOMO16, MOMOPICK, DIRECT; 11 Nov 2026): a Direct MoMo pick is NOT confirmed when it is
// chosen. Direct on 61 returns straight to 16 with the part "not confirmed yet". Done on 16 runs:
// parts sum to the total -> 62 for an unconfirmed Direct part -> commit once -> 30 (or 31).
// Back on 62 returns to 16 with nothing confirmed or saved. A failed commit returns to 16 with the
// MoMo part confirmed, so it is locked. Real PosApp: real screens, route state and writers.

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
const labels = (tree) => nodes(tree).map((node) => node.props["aria-label"]).filter(Boolean);
const rowNode = (tree, method) => nodes(tree).find((node) => node.props["data-split-row"] === method);
const rowStatus = (tree, method) => textOf([...walk(rowNode(tree, method))].find((node) => node.props?.["data-row-status"] !== undefined));
const dialogs = (tree) => nodes(tree).filter((node) => node.props.role === "alertdialog");
const momoPart = (app) => app.params.splitParts.find((part) => part.paymentMethod === "momo");

// Sell {total} > Split payment > Cash (one tap) > Edit Cash to {cash} > MoMo tile > editor {momo} > Save > 61.
async function toMomoChoice(app, { total = "8", cash = "4.00", momo = "4.00" } = {}) {
  await app.tap(/^Sell$/);
  await app.keys(total.split(""));
  await app.tap("Split payment");
  assert.equal(app.route, "SplitPayment");
  await app.tap(/^Cash$/);
  await app.tap("Edit Cash amount");
  await app.type("split-draft-amount", cash);
  await app.tap(/^Save$/);
  await app.tap(/^MoMo$/);
  await app.type("split-draft-amount", momo);
  await app.tap(/^Save$/);
  assert.equal(app.route, "MoMoChoice");
}

async function pickDirect(app, options) {
  await toMomoChoice(app, options);
  await app.tap(/^Customer sends to my number/);
}

test("16: Direct on 61 returns straight to 16 with the MoMo part not confirmed yet; nothing is saved", async () => {
  const app = await open();
  await pickDirect(app);
  assert.equal(app.route, "SplitPayment", "Direct returns to 16, it does not open 62");
  const part = momoPart(app);
  assert.equal(part.momoMethod, "direct");
  assert.equal(part.verification, undefined, "not confirmed");
  assert.equal(part.confirmedPesewas, undefined, "nothing confirmed yet");
  assert.equal(part.amountPesewas, 400);
  assert.equal(rowStatus(app.view.tree, "momo"), "Customer sends to my number · not confirmed yet");
  assert.ok(labels(app.view.tree).includes("Edit MoMo amount"));
  assert.ok(labels(app.view.tree).includes("Remove MoMo"));
  assert.match(shown(app), /Left to payGH₵0\.00/);
  assert.equal((await db.transactions.toArray()).length, 0, "nothing saved");
  for (const key of ["pendingMomoAmountPesewas", "momoMethod", "verification", "pickOnly", "returnRoute"]) {
    assert.equal(app.params[key], undefined, `${key} is not left on 16`);
  }
});

test("16: Done opens 62; Money received saves the sale once and lands on 30, never back on 16", async () => {
  const app = await open();
  await pickDirect(app);
  await app.tap(/^Done$/);
  assert.equal(app.route, "MoMoDirect", "Done opens 62 for the unconfirmed Direct part");
  assert.match(shown(app), /send GH₵4\.00/);
  assert.equal((await db.transactions.toArray()).length, 0, "nothing saved before Money received");
  await app.tap(/^Money received$/);
  assert.equal(app.route, "SaleRecorded");
  const sales = await db.transactions.toArray();
  assert.equal(sales.length, 1, "saved once");
  assert.equal(sales[0].amountPesewas, 800);
  assert.deepEqual([sales[0].cashReceivedPesewas, sales[0].momoReceivedPesewas], [400, 400]);
  assert.equal(sales[0].momoVerification, "merchant_confirmed");
  assert.equal(sales[0].momoConfirmedPesewas, 400);
  assert.equal(app.state.history.length, 0, "30 starts a fresh stack");
  await app.phoneBack();
  assert.notEqual(app.route, "SplitPayment");
  assert.equal((await db.transactions.toArray()).length, 1);
});

test("16: MoMo + Owe: Done > 62 > Money received saves once and lands on 30", async () => {
  await recordCreditSale({ name: "Juju", amountPesewas: 500, now: Date.now() - 86_400_000 });
  const app = await open();
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Split payment");
  await app.tap(/^MoMo$/);
  await app.type("split-draft-amount", "3.00");
  await app.tap(/^Save$/);
  await app.tap(/^Customer sends to my number/);
  assert.equal(app.route, "SplitPayment");
  await app.tap(/^Owe$/);
  await app.tap(/^JJuju/);
  await app.tap(/^Next/);
  await app.tap(/^Save · Juju owes/);
  assert.equal(app.route, "SplitPayment");
  assert.equal(momoPart(app).verification, undefined, "still not confirmed after Owe");
  const before = (await db.transactions.toArray()).length;
  await app.tap(/^Done$/);
  assert.equal(app.route, "MoMoDirect");
  await app.tap(/^Money received$/);
  assert.equal(app.route, "SaleRecorded");
  const sales = (await db.transactions.toArray()).filter((row) => row.amountPesewas === 800 && row.paymentType === "credit");
  assert.equal(sales.length, 1, "saved once");
  assert.equal(sales[0].momoVerification, "merchant_confirmed");
  assert.ok((await db.transactions.toArray()).length > before);
});

test("16: Back on 62 returns to 16 with the part still not confirmed and nothing saved", async () => {
  const app = await open();
  await pickDirect(app);
  await app.tap(/^Done$/);
  assert.equal(app.route, "MoMoDirect");
  await app.tap("Back");
  assert.equal(app.route, "SplitPayment");
  assert.equal(momoPart(app).verification, undefined);
  assert.equal(rowStatus(app.view.tree, "momo"), "Customer sends to my number · not confirmed yet");
  assert.match(shown(app), /Left to payGH₵0\.00/);
  assert.equal((await db.transactions.toArray()).length, 0);
  // The phone back on 62 does the same.
  await app.tap(/^Done$/);
  assert.equal(app.route, "MoMoDirect");
  await app.phoneBack();
  assert.equal(app.route, "SplitPayment");
  assert.equal(momoPart(app).verification, undefined);
  assert.equal((await db.transactions.toArray()).length, 0);
});

test("16: an unconfirmed Direct row can be edited and removed before Done; the MoMo tile can raise it", async () => {
  const app = await open();
  await pickDirect(app, { cash: "4.00", momo: "2.00" });
  assert.match(shown(app), /Left to payGH₵2\.00/);
  // The MoMo tile is still there and raises the row (only the extra goes through 61).
  await app.tap(/^MoMo$/);
  await app.type("split-draft-amount", "1.00");
  await app.tap(/^Save$/);
  await app.tap(/^Customer sends to my number/);
  assert.equal(app.route, "SplitPayment");
  assert.equal(app.params.splitParts.filter((part) => part.paymentMethod === "momo").length, 1, "one MoMo row");
  assert.equal(momoPart(app).amountPesewas, 300);
  assert.equal(momoPart(app).verification, undefined);
  // Edit.
  await app.tap("Edit MoMo amount");
  await app.type("split-draft-amount", "4.00");
  await app.tap(/^Save$/);
  assert.equal(momoPart(app).amountPesewas, 400);
  assert.equal(momoPart(app).verification, undefined);
  assert.match(shown(app), /Left to payGH₵0\.00/);
  // Remove.
  await app.tap("Remove MoMo");
  assert.equal(app.params.splitParts.some((part) => part.paymentMethod === "momo"), false);
  assert.match(shown(app), /Left to payGH₵4\.00/);
  assert.equal((await db.transactions.toArray()).length, 0);
});

test("16: a commit that fails after Money received returns to 16 with the MoMo part locked; Done then saves once without 62", async () => {
  const app = await open();
  await pickDirect(app);
  await app.tap(/^Done$/);
  assert.equal(app.route, "MoMoDirect");
  const store = globalThis.IDBObjectStore.prototype;
  const original = { add: store.add, put: store.put };
  for (const name of ["add", "put"]) {
    store[name] = function (...args) {
      if (this.name === "transactions") throw new DOMException("Disk full (test)", "UnknownError");
      return original[name].apply(this, args);
    };
  }
  try {
    await app.tap(/^Money received$/);
  } finally {
    Object.assign(store, original);
  }
  assert.equal(app.route, "SplitPayment", "the failed commit returns to 16");
  assert.match(shown(app), /could not be saved/);
  const part = momoPart(app);
  assert.deepEqual([part.verification, part.confirmedPesewas, part.amountPesewas], ["merchant_confirmed", 400, 400]);
  assert.ok(!labels(app.view.tree).includes("Edit MoMo amount"), "locked: no pencil");
  assert.ok(!labels(app.view.tree).includes("Remove MoMo"), "locked: no x");
  assert.equal(rowStatus(app.view.tree, "momo"), "Received");
  assert.equal((await db.transactions.toArray()).length, 0, "nothing saved");
  // Done again: the part is already confirmed, so it saves straight away, once.
  await app.tap(/^Done$/);
  assert.equal(app.route, "SaleRecorded");
  assert.equal((await db.transactions.toArray()).length, 1);
});

test("16: a large MoMo part asks once at the editor, not on 62; Done asks once about the sale total; the commit after 62 asks nothing", async () => {
  // The dialog's focus code checks `instanceof HTMLElement`; the harness has no DOM classes.
  globalThis.HTMLElement ??= class {};
  const app = await open();
  await app.tap(/^Sell$/);
  await app.keys("1500".split(""));
  await app.tap("Split payment");
  await app.tap(/^Cash$/);
  await app.tap("Edit Cash amount");
  await app.type("split-draft-amount", "300.00");
  await app.tap(/^Save$/);
  await app.tap(/^MoMo$/);
  await app.type("split-draft-amount", "1200.00");
  await app.tap(/^Save$/);
  assert.equal(dialogs(app.view.tree).length, 1, "the editor asks about the MoMo amount");
  assert.match(textOf(dialogs(app.view.tree)[0]), /This MoMo payment is GH₵1,200\.00/);
  await app.tap("Yes, save");
  assert.equal(app.route, "MoMoChoice");
  await app.tap(/^Customer sends to my number/);
  assert.equal(app.route, "SplitPayment");
  assert.equal(dialogs(app.view.tree).length, 0);
  await app.tap(/^Done$/);
  assert.equal(dialogs(app.view.tree).length, 1, "Done asks about the sale total");
  assert.match(textOf(dialogs(app.view.tree)[0]), /This sale is GH₵1,500\.00/);
  await app.tap("Yes, save");
  assert.equal(app.route, "MoMoDirect");
  assert.equal(dialogs(app.view.tree).length, 0, "no dialog on 62");
  await app.tap(/^Money received$/);
  assert.equal(app.route, "SaleRecorded", "no second sale-total ask after 62");
  assert.equal((await db.transactions.toArray()).length, 1);
});

test("16: with \"Always: customer sends to my number\" (63), the MoMo tile still returns to 16 not confirmed; 62 comes at Done", async () => {
  await setPreference("momoDefault", "direct");
  const app = await open();
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Split payment");
  await app.tap(/^MoMo$/);
  await app.tap(/^Save$/);
  assert.equal(app.route, "SplitPayment", "61 is skipped and 62 is not opened");
  assert.equal(momoPart(app).verification, undefined);
  assert.equal(momoPart(app).amountPesewas, 800);
  assert.ok(!app.state.history.some((entry) => entry.current === "MoMoChoice" || entry.current === "MoMoDirect"), "no MoMo screen left behind 16");
  await app.tap(/^Done$/);
  assert.equal(app.route, "MoMoDirect");
  await app.tap(/^Money received$/);
  assert.equal(app.route, "SaleRecorded");
  assert.equal((await db.transactions.toArray()).length, 1);
});
