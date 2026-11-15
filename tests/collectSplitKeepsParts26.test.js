import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { setLiveQuery, walk } from "./helpers/renderJsx.js";

globalThis.HTMLElement ??= class {};

// Wiring 27 (decided 12 Nov 2026, same fix as 19): Back from 27 opened from 26 (collect split) keeps
// the Cash and MoMo parts on 26; Split payment on 26 reopens 27 with them while the amount is
// unchanged; a changed amount clears them. A locked MoMo part keeps its lock and the leave question.
// Done, header Home, a tab or Leave clear them. Real PosApp screens.

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

const nodes = (tree) => [...walk(tree)].filter((node) => node.props);
const dialogs = (tree) => nodes(tree).filter((node) => node.props.role === "alertdialog");
const partsOf = (app) => (app.params.splitParts ?? []).map(({ paymentMethod, amountPesewas, verification }) => ({ paymentMethod, amountPesewas, verification }));

async function to26(app) {
  const debt = (await db.debts.toArray()).find((row) => row.status === "unpaid");
  const home = nodes(app.view.tree).find((node) => node.type?.name === "Home");
  home.props.onNavigate("CollectPayment", { debtId: debt.id, customerName: "Juju" });
  await app.settle();
  await app.tap("Pay part");
  assert.equal(app.route, "CollectPayPart");
}

// 26: amount 4 > Split payment (27) > Cash 1.00 > MoMo 3.00 > 61 Direct > back on 27.
async function split27(app) {
  await app.keys(["4"]);
  await app.tap(/Split payment$/);
  assert.equal(app.route, "SplitPayment");
  await app.tap(/^Cash$/);
  await app.tap("Edit Cash amount");
  await app.type("split-draft-amount", "1.00");
  await app.tap(/^Save$/);
  await app.tap(/^MoMo$/);
  await app.type("split-draft-amount", "3.00");
  await app.tap(/^Save$/);
  assert.equal(app.route, "MoMoChoice");
  await app.tap(/^Customer sends to my number/);
  assert.equal(app.route, "SplitPayment");
}

const EXPECTED = [
  { paymentMethod: "cash", amountPesewas: 100, verification: undefined },
  { paymentMethod: "momo", amountPesewas: 300, verification: undefined }
];
const sorted = (parts) => [...parts].sort((a, b) => a.paymentMethod.localeCompare(b.paymentMethod));

for (const [name, back] of [["on-screen Back", (app) => app.tap("Back")], ["phone back", (app) => app.phoneBack()]]) {
  test(`27 from 26: Cash and MoMo parts survive ${name} to 26 and Split payment again`, async () => {
    const app = await open();
    await to26(app);
    await split27(app);
    assert.deepEqual(sorted(partsOf(app)), EXPECTED);
    await back(app);
    assert.equal(app.route, "CollectPayPart");
    assert.equal(app.amountShown("Amount to collect"), "GH₵4.00");
    await app.tap(/Split payment$/);
    assert.equal(app.route, "SplitPayment");
    assert.deepEqual(sorted(partsOf(app)), EXPECTED);
    assert.match(app.text().replace(/\s+/g, " "), /Customer sends · not confirmed yet/);
    assert.equal(app.button(/^Done$/).props.disabled, false, "the parts add up");
  });
}

test("27 from 26: a changed amount clears the parts and 27 starts with the new amount", async () => {
  const app = await open();
  await to26(app);
  await split27(app);
  await app.tap("Back");
  await app.tap("Delete last digit");
  await app.keys(["6"]);
  assert.equal(app.amountShown("Amount to collect"), "GH₵6.00");
  await app.tap(/Split payment$/);
  assert.equal(app.route, "SplitPayment");
  assert.deepEqual(partsOf(app), []);
  assert.match(app.text().replace(/\s+/g, " "), /GH₵6\.00/);
  await app.tap("Back");
  // Back to 4 again: the cleared parts do not come back.
  await app.tap("Delete last digit");
  await app.keys(["4"]);
  assert.equal(app.amountShown("Amount to collect"), "GH₵4.00");
  await app.tap(/Split payment$/);
  assert.deepEqual(partsOf(app), []);
});

test("27 from 26: a received (locked) MoMo part kept on 26 stays locked and leaving 26 asks", async () => {
  const { backRoute, getLeaveOnBackRoute, getReceivedMomoInDraft } = await import("../src/pos/routes.js");
  const locked = { paymentMethod: "momo", amountPesewas: 300, momoMethod: "direct", verification: "merchant_confirmed" };
  const twentySix = { debtId: 1, amount: "4" };
  const on26 = backRoute({
    current: "SplitPayment",
    params: { ...twentySix, splitParts: [{ paymentMethod: "cash", amountPesewas: 100 }, locked] },
    history: [{ current: "Home", params: {} }, { current: "CollectPayment", params: { debtId: 1 } }, { current: "CollectPayPart", params: twentySix }]
  });
  assert.equal(on26.current, "CollectPayPart");
  assert.equal(on26.params.collectSplitDraft.totalPesewas, 400);
  assert.deepEqual(on26.params.collectSplitDraft.splitParts[1], locked, "the lock is kept on the part");
  assert.equal(getReceivedMomoInDraft(on26), 300);
  assert.equal(getLeaveOnBackRoute(on26), "Home", "Back from 26 asks first, Leave goes Home");
});

test("27 from 26 in the app: Back from 27 with a locked MoMo part asks the leave question", async () => {
  const app = await open();
  await to26(app);
  await split27(app);
  const store = globalThis.IDBObjectStore.prototype;
  const original = { add: store.add, put: store.put };
  for (const key of ["add", "put"]) {
    store[key] = function (...args) {
      if (this.name === "transactions") throw new DOMException("Disk full (test)", "UnknownError");
      return original[key].apply(this, args);
    };
  }
  try {
    await app.tap(/^Done$/);
    await app.tap(/^Money received$/);
  } finally {
    Object.assign(store, original);
  }
  assert.equal(app.route, "SplitPayment");
  assert.equal(partsOf(app).find((part) => part.paymentMethod === "momo").verification, "merchant_confirmed");
  await app.tap("Back");
  assert.equal(dialogs(app.view.tree).length, 1, "the leave question");
  assert.match(app.text(), /GH₵3\.00 MoMo was already received and will not be recorded\. Leave anyway\?/);
});

test("27 from 26: after Done a new collection starts with an empty 27", async () => {
  const app = await open();
  await to26(app);
  await split27(app);
  await app.tap("Back");
  await app.tap(/Split payment$/);
  await app.tap(/^Done$/);
  assert.equal(app.route, "MoMoDirect");
  await app.tap(/^Money received$/);
  assert.equal(app.route, "PaymentReceived");
  await app.tap("Home");
  await to26(app);
  await app.keys(["4"]);
  await app.tap(/Split payment$/);
  assert.deepEqual(partsOf(app), []);
});

test("27 from 26: header Home clears the kept parts", async () => {
  const app = await open();
  await to26(app);
  await split27(app);
  await app.tap("Back");
  assert.ok(app.params.collectSplitDraft);
  await app.goHome();
  assert.equal(app.route, "Home");
  await to26(app);
  await app.keys(["4"]);
  await app.tap(/Split payment$/);
  assert.deepEqual(partsOf(app), []);
});
