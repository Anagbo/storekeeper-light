import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Wiring MOMO16 (decided 11 Nov 2026): the same order, lock and leave question on the collect split 27. Direct on 61 returns unconfirmed; 62
// opens only at Received (27) or Save plan (19); money confirmed on 62 is locked if the save then
// fails; leaving a draft that holds received MoMo asks the leave question. Real PosApp throughout.

globalThis.HTMLElement ??= class {};

// The test shim's useLiveQuery returns what this handler gives: each query runs once per test (by
// its deps and source) and its result is kept, as Dexie would show it until the data changes.
let liveResults = new Map();
setLiveQuery((deps, query) => {
  const key = `${String(query)}|${JSON.stringify(deps)}`;
  if (!liveResults.has(key)) {
    liveResults.set(key, undefined);
    Promise.resolve().then(query).then((value) => liveResults.set(key, value), () => liveResults.set(key, null));
  }
  return liveResults.get(key);
});

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  resetBrowserBack();
  liveResults = new Map();
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
  await db.settings.put({ key: "momoReceivingNumber", value: "0241234567" });
  await db.settings.put({ key: "momoReceivingNetwork", value: "MTN" });
  await recordCreditSale({ name: "Juju", amountPesewas: 1000, now: Date.now() - 3 * 86_400_000 });
});

async function open() {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  return app;
}

const shown = (app) => app.text().replace(/\s+/g, " ");
const nodes = (tree) => [...walk(tree)].filter((node) => node.props);
const labels = (tree) => nodes(tree).map((node) => node.props["aria-label"]).filter(Boolean);
const dialogs = (tree) => nodes(tree).filter((node) => node.props.role === "alertdialog");
const QUESTION = (amount) => `${amount} MoMo was already received and will not be recorded. Leave anyway?`;
const counts = async () => ({ transactions: (await db.transactions.count()), payments: (await db.payments.count()) });

async function failingWrites(run) {
  const store = globalThis.IDBObjectStore.prototype;
  const original = { add: store.add, put: store.put };
  for (const name of ["add", "put"]) {
    store[name] = function (...args) {
      if (this.name === "transactions") throw new DOMException("Disk full (test)", "UnknownError");
      return original[name].apply(this, args);
    };
  }
  try {
    await run();
  } finally {
    Object.assign(store, original);
  }
}

// Home as the owner reaches it now: Menu > Home (the header Home tile is gone, wiring 23).
const headerHome = (app) => app.goHome();

// ---- 27 collect split ---------------------------------------------------------------------

// Collect (25, Juju owes GH₵10.00) > Pay all > Split payment (27) > Cash > Edit Cash 6.00 > MoMo 4.00 > 61 Direct.
// 25 is opened with Home's own navigate, as the Owed card's Collect does (Home shows that card only
// for a debt that is due soon or late).
async function collectSplitWithDirect(app) {
  const debt = (await db.debts.toArray()).find((row) => row.status === "unpaid");
  const home = nodes(app.view.tree).find((node) => node.type?.name === "Home");
  home.props.onNavigate("CollectPayment", { debtId: debt.id, customerName: "Juju" });
  await app.settle();
  assert.equal(app.route, "CollectPayment");
  await app.tap("Pay all");
  await app.tap(/Split payment$/);
  assert.equal(app.route, "SplitPayment");
  assert.ok(app.params.debtId, "27 (collect)");
  await app.tap(/^Cash$/);
  await app.tap("Edit Cash amount");
  await app.type("split-draft-amount", "6.00");
  await app.tap(/^Save$/);
  await app.tap(/^MoMo$/);
  await app.type("split-draft-amount", "4.00");
  await app.tap(/^Save$/);
  assert.equal(app.route, "MoMoChoice");
  await app.tap(/^Customer sends to my number/);
}

const momoOf = (parts = []) => parts.find((part) => part.paymentMethod === "momo");
// One collection writes one income row per part (Cash, MoMo) under one collectionId.
async function collectionsSaved() {
  const rows = (await db.transactions.toArray()).filter((row) => row.collectionType === "debt_collection");
  return { count: new Set(rows.map((row) => row.collectionId)).size, pesewas: rows.reduce((sum, row) => sum + row.amountPesewas, 0) };
}

test("27 collect: Direct returns to 27 not confirmed and saves nothing; Done opens 62; Back saves nothing; Money received saves once and lands on 28", async () => {
  const app = await open();
  const before = await counts();
  await collectSplitWithDirect(app);
  assert.equal(app.route, "SplitPayment", "Direct returns to 27, not to 62");
  assert.equal(momoOf(app.params.splitParts).verification, undefined);
  assert.ok(labels(app.view.tree).includes("Edit MoMo amount"));
  assert.match(shown(app), /Status ?Not confirmed yet/);
  assert.deepEqual(await counts(), before, "nothing saved");
  await app.tap(/^Done$/);
  assert.equal(app.route, "MoMoDirect");
  assert.match(shown(app), /send ?GH₵4\.00/);
  await app.tap("Back");
  assert.equal(app.route, "SplitPayment");
  assert.equal(momoOf(app.params.splitParts).verification, undefined);
  assert.deepEqual(await counts(), before, "Back on 62 saves nothing");
  await app.tap(/^Done$/);
  await app.tap(/^Money received$/);
  assert.equal(app.route, "PaymentReceived");
  assert.deepEqual(await collectionsSaved(), { count: 1, pesewas: 1000 }, "saved once");
  const momoPayments = (await db.payments.toArray()).filter((row) => row.paymentMethod === "momo" || row.payment_method === "momo");
  assert.equal(momoPayments.length, 1);
  assert.equal(momoPayments[0].momoVerification, "merchant_confirmed");
  assert.equal(app.state.history.length, 0);
});

test("27 collect: a save that fails after Money received stays on 27 with the MoMo part locked; leaving asks; Done then saves once without 62", async () => {
  const app = await open();
  await collectSplitWithDirect(app);
  await app.tap(/^Done$/);
  assert.equal(app.route, "MoMoDirect");
  await failingWrites(() => app.tap(/^Money received$/));
  assert.equal(app.route, "SplitPayment");
  assert.ok(app.params.debtId);
  const part = momoOf(app.params.splitParts);
  assert.deepEqual([part.verification, part.confirmedPesewas], ["merchant_confirmed", 400]);
  assert.ok(!labels(app.view.tree).includes("Edit MoMo amount"), "no pencil");
  assert.ok(!labels(app.view.tree).includes("Remove MoMo"), "no x");
  assert.match(shown(app), /MoMoGH₵4.00Status ?Received ✓/);
  assert.equal((await collectionsSaved()).count, 0);

  // The leave question: on-screen Back, phone back, header Home. Stay keeps 27.
  for (const leave of [(a) => a.tap("Back"), (a) => a.phoneBack(), headerHome]) {
    await leave(app);
    assert.equal(dialogs(app.view.tree).length, 1);
    assert.ok(textOf(dialogs(app.view.tree)[0]).includes(QUESTION("GH₵4.00")));
    await app.tap("Stay");
    assert.equal(app.route, "SplitPayment");
    assert.equal(momoOf(app.params.splitParts).verification, "merchant_confirmed");
  }
  await app.tap(/^Done$/);
  assert.equal(app.route, "PaymentReceived", "already confirmed: no 62");
  assert.deepEqual(await collectionsSaved(), { count: 1, pesewas: 1000 });
});

test("27 collect: Leave with received MoMo discards the draft (Home, nothing behind); without a locked part leaving does not ask", async () => {
  const app = await open();
  await collectSplitWithDirect(app);
  await headerHome(app);
  assert.equal(dialogs(app.view.tree).length, 0, "not confirmed yet: no question");
  assert.equal(app.route, "Home");

  await collectSplitWithDirect(app);
  await app.tap(/^Done$/);
  await failingWrites(() => app.tap(/^Money received$/));
  await app.tap("Back");
  await app.tap("Leave");
  assert.equal(app.route, "Home");
  assert.equal(app.state.history.length, 0);
});

