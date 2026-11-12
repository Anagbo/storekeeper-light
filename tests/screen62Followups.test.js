import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { setPreference } from "../src/db/preferences.js";
import { recordCashSale } from "../src/db/sales.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { findButton, flushEffects, loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

globalThis.HTMLElement ??= class {};

// Follow-ups on 62 and 27 (owner, 12 Nov 2026). No money logic changes.
// 1. No stored MoMo account name: the name line and "The customer will see this name…" stay hidden.
// 2. "MoMo part of a GH₵{total} sale" on a sale (16); "… payment" on 27 from 25/26 (collection) and
//    from 19 (plan payment). The total is the full payment on that screen.
// 3. 27 opened from 25 (Collect sheet > Split payment) keeps its Cash and MoMo parts as from 26.
// 4. 62 after a failed Money received: the new text, and Money received again never saves twice.

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
const dialogs = (tree) => nodes(tree).filter((node) => node.props.role === "alertdialog");
const partsOf = (app) => (app.params.splitParts ?? []).map(({ paymentMethod, amountPesewas, verification }) => ({ paymentMethod, amountPesewas, verification }));
const sorted = (parts) => [...parts].sort((a, b) => a.paymentMethod.localeCompare(b.paymentMethod));
const NEW_ERROR = "We could not confirm that this was saved. Check Today's transactions first. Tap Money received again only if the payment is not there.";

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

async function headerHome(app) {
  const button = nodes(app.view.tree).find((node) => node.type === "button" && node.props["aria-label"] === "Home");
  await button.props.onClick();
  return app.settle();
}

async function to25(app) {
  const debt = (await db.debts.toArray()).find((row) => row.status === "unpaid");
  const home = nodes(app.view.tree).find((node) => node.type?.name === "Home");
  home.props.onNavigate("CollectPayment", { debtId: debt.id, customerName: "Juju" });
  await app.settle();
  assert.equal(app.route, "CollectPayment");
}

// On 27: Cash {cash}, MoMo {momo} > 61 Direct > back on 27 (MoMo not confirmed yet).
async function cashAndMomo(app, cash, momo) {
  assert.equal(app.route, "SplitPayment");
  await app.tap(/^Cash$/);
  await app.tap("Edit Cash amount");
  await app.type("split-draft-amount", cash);
  await app.tap(/^Save$/);
  await app.tap(/^MoMo$/);
  await app.type("split-draft-amount", momo);
  await app.tap(/^Save$/);
  assert.equal(app.route, "MoMoChoice");
  await app.tap(/^Customer sends to my number/);
  assert.equal(app.route, "SplitPayment");
}

// 25 Pay all (GH₵10.00) > Split payment (27) > Cash 4.00 > MoMo 6.00 > Direct.
async function split27From25(app) {
  await to25(app);
  await app.tap("Pay all");
  await app.tap(/Split payment$/);
  await cashAndMomo(app, "4.00", "6.00");
}

// ---- 1. No stored name: no name line --------------------------------------------------------

test("62: with no stored MoMo account name, no bold name line and no 'The customer will see this name' line", async () => {
  const { MoMoDirect } = await loadJsx("src/pos/MoMoScreens.jsx");
  const view = render({ type: MoMoDirect, props: { params: { amountPesewas: 1300 }, onBack() {}, onConfirm: async () => {}, onPick() {} } });
  flushEffects(view);
  for (let index = 0; index < 50 && findButton(view.tree, "Money received").props.disabled; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    view.rerender();
  }
  const text = textOf(view.tree).replace(/\s+/g, " ");
  assert.match(text, /024 123 4567/);
  assert.doesNotMatch(text, /will see this name/);
  assert.equal(nodes(view.tree).filter((node) => /text-\[19px\]/.test(String(node.props.className ?? ""))).length, 0, "no name line");
});

// ---- 2. Split line wording ------------------------------------------------------------------

test("62 from a sale split (16): MoMo part of a GH₵8.00 sale", async () => {
  const app = await open();
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Split payment");
  await cashAndMomo(app, "3.00", "5.00");
  await app.tap(/^Done$/);
  assert.equal(app.route, "MoMoDirect");
  assert.match(shown(app), /send ?GH₵5\.00/);
  assert.ok(shown(app).includes("MoMo part of a GH₵8.00 sale"), shown(app));
  assert.doesNotMatch(shown(app), /MoMo part of a GH₵[\d.,]+ payment/);
});

test("62 from 27 opened from 26 (collection): MoMo part of a GH₵4.00 payment", async () => {
  const app = await open();
  await to25(app);
  await app.tap("Pay part");
  await app.keys(["4"]);
  await app.tap(/Split payment$/);
  await cashAndMomo(app, "1.00", "3.00");
  await app.tap(/^Done$/);
  assert.equal(app.route, "MoMoDirect");
  assert.match(shown(app), /send ?GH₵3\.00/);
  assert.ok(shown(app).includes("MoMo part of a GH₵4.00 payment"), shown(app));
  assert.doesNotMatch(shown(app), /sale/);
});

test("62 from 27 opened from 25 (collection): MoMo part of a GH₵10.00 payment", async () => {
  const app = await open();
  await split27From25(app);
  await app.tap(/^Done$/);
  assert.equal(app.route, "MoMoDirect");
  assert.match(shown(app), /send ?GH₵6\.00/);
  assert.ok(shown(app).includes("MoMo part of a GH₵10.00 payment"), shown(app));
});

test("62 from 27 opened from 19 (plan payment): MoMo part of a GH₵3.00 payment (the payment today)", async () => {
  const app = await open();
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Owe");
  await app.tap(/^JJuju/);
  await app.tap(/^Next/);
  await app.tap(/A little at a time/);
  await app.type("How much each time?", "4");
  await app.tap("Today");
  await app.type("Amount paid today", "3");
  await app.tap(/Split payment$/);
  assert.equal(app.params.installmentSplit, true);
  await cashAndMomo(app, "1.00", "2.00");
  await app.tap(/^Done$/);
  assert.equal(app.route, "ALittleAtATime");
  await app.tap(/^Save plan$/);
  assert.equal(app.route, "MoMoDirect");
  assert.match(shown(app), /send ?GH₵2\.00/);
  assert.ok(shown(app).includes("MoMo part of a GH₵3.00 payment"), shown(app));
  assert.doesNotMatch(shown(app), /GH₵8\.00/, "not the sale total");
});

test("62 with the whole amount in MoMo (25 Pay all > 27 MoMo only): no split line", async () => {
  const app = await open();
  await to25(app);
  await app.tap("Pay all");
  await app.tap(/Split payment$/);
  await app.tap(/^MoMo$/);
  await app.tap(/^Save$/);
  await app.tap(/^Customer sends to my number/);
  await app.tap(/^Done$/);
  assert.equal(app.route, "MoMoDirect");
  assert.doesNotMatch(shown(app), /MoMo part of/);
});

// ---- 3. 27 from 25 keeps and clears its parts -----------------------------------------------

const EXPECTED_25 = [
  { paymentMethod: "cash", amountPesewas: 400, verification: undefined },
  { paymentMethod: "momo", amountPesewas: 600, verification: undefined }
];

for (const [name, back] of [["on-screen Back", (app) => app.tap("Back")], ["phone back", (app) => app.phoneBack()]]) {
  test(`27 from 25: Cash and MoMo parts survive ${name} to 25 and Split payment again`, async () => {
    const app = await open();
    await split27From25(app);
    assert.deepEqual(sorted(partsOf(app)), EXPECTED_25);
    await back(app);
    assert.equal(app.route, "CollectPayment");
    await app.tap(/Split payment$/);
    assert.equal(app.route, "SplitPayment");
    assert.deepEqual(sorted(partsOf(app)), EXPECTED_25);
    assert.match(shown(app), /Customer sends · not confirmed yet/);
    assert.equal(app.button(/^Done$/).props.disabled, false, "the parts add up");
  });
}

test("27 from 25: a changed amount (Due now / Pay all) clears the parts and 27 starts with the new amount", async () => {
  // A plan debt: Due now GH₵4.00, Pay all GH₵10.00.
  await db.debts.clear();
  const { recordCreditSale: record } = await import("../src/db/debts.js");
  await record({ name: "Juju", amountPesewas: 1000, now: Date.now() - 3 * 86_400_000 });
  const debt = (await db.debts.toArray())[0];
  await db.debts.update(debt.id, { isInstallmentPlan: true, installmentAmount: 400, nextDueDate: new Date().toISOString().slice(0, 10) });
  const app = await open();
  await to25(app);
  await app.tap("Pay all");
  await app.tap(/Split payment$/);
  await cashAndMomo(app, "4.00", "6.00");
  await app.tap("Back");
  assert.equal(app.route, "CollectPayment");
  await app.tap("Due now");
  await app.tap(/Split payment$/);
  assert.equal(app.route, "SplitPayment");
  assert.deepEqual(partsOf(app), []);
  assert.match(shown(app), /GH₵4\.00/);
  await app.tap("Back");
  // Back to Pay all: the cleared parts do not come back.
  await app.tap("Pay all");
  await app.tap(/Split payment$/);
  assert.deepEqual(partsOf(app), []);
});

test("27 from 25: a received (locked) MoMo part kept on 25 stays locked and leaving 25 asks", async () => {
  const { backRoute, getLeaveOnBackRoute, getReceivedMomoInDraft } = await import("../src/pos/routes.js");
  const locked = { paymentMethod: "momo", amountPesewas: 600, momoMethod: "direct", verification: "merchant_confirmed" };
  const on25 = backRoute({
    current: "SplitPayment",
    params: { debtId: 1, customerName: "Juju", amount: "10.00", splitParts: [{ paymentMethod: "cash", amountPesewas: 400 }, locked] },
    history: [{ current: "Home", params: {} }, { current: "CollectPayment", params: { debtId: 1, customerName: "Juju" } }]
  });
  assert.equal(on25.current, "CollectPayment");
  assert.equal(on25.params.collectSplitDraft.totalPesewas, 1000);
  assert.deepEqual(on25.params.collectSplitDraft.splitParts[1], locked, "the lock is kept on the part");
  assert.equal(getReceivedMomoInDraft(on25), 600);
  assert.equal(getLeaveOnBackRoute(on25), "Home", "Back from 25 asks first, Leave goes Home");
});

test("27 from 25 in the app: a locked MoMo part kept after Back keeps its lock; Back from 27 and header Home ask; Leave clears", async () => {
  const app = await open();
  await split27From25(app);
  await app.tap(/^Done$/);
  await failingWrites(() => app.tap(/^Money received$/));
  assert.equal(app.route, "SplitPayment");
  // Back from 27 with the locked part asks (the existing rule for 27).
  await app.tap("Back");
  assert.equal(dialogs(app.view.tree).length, 1);
  assert.match(app.text(), /GH₵6\.00 MoMo was already received and will not be recorded\. Leave anyway\?/);
  await app.tap("Stay");
  assert.equal(app.route, "SplitPayment");
  // The kept parts on 25 (as Back would leave them): the lock stays and leaving 25 asks.
  const { backRoute } = await import("../src/pos/routes.js");
  const on25 = backRoute(app.state);
  assert.equal(on25.current, "CollectPayment");
  assert.equal(on25.params.collectSplitDraft.splitParts.find((part) => part.paymentMethod === "momo").verification, "merchant_confirmed");
  await headerHome(app);
  assert.equal(dialogs(app.view.tree).length, 1, "header Home asks");
  await app.tap("Leave");
  assert.equal(app.route, "Home");
  await to25(app);
  await app.tap("Pay all");
  await app.tap(/Split payment$/);
  assert.deepEqual(partsOf(app), [], "Leave cleared the parts");
});

test("27 from 25: after Done a new collection starts with an empty 27", async () => {
  const app = await open();
  await split27From25(app);
  await app.tap("Back");
  await app.tap(/Split payment$/);
  await app.tap(/^Done$/);
  assert.equal(app.route, "MoMoDirect");
  await app.tap(/^Money received$/);
  assert.equal(app.route, "PaymentReceived");
  await app.tap("Home");
  await recordCreditSale({ name: "Juju", amountPesewas: 1000, now: Date.now() - 3 * 86_400_000 });
  await to25(app);
  await app.tap("Pay all");
  await app.tap(/Split payment$/);
  assert.deepEqual(partsOf(app), []);
});

test("27 from 25: header Home and another tab clear the kept parts", async () => {
  for (const leave of [headerHome, async (app) => { await app.tap(/^Sell$/); await app.tap(/^Home$/); }]) {
    const app = await open();
    await split27From25(app);
    await app.tap("Back");
    assert.ok(app.params.collectSplitDraft);
    await leave(app);
    assert.equal(app.route, "Home");
    await to25(app);
    await app.tap("Pay all");
    await app.tap(/Split payment$/);
    assert.deepEqual(partsOf(app), []);
  }
});

// ---- 4. 62 failed Money received ------------------------------------------------------------

test("62 (single MoMo sale): a failed Money received shows the new text, stays on 62, and Money received again saves once", async () => {
  const app = await open();
  await app.tap(/^Sell$/);
  await app.keys(["1", "3"]);
  await app.tap("MoMo");
  await app.tap(/^Customer sends to my number/);
  assert.equal(app.route, "MoMoDirect");
  const before = await db.transactions.count();
  await failingWrites(() => app.tap(/^Money received$/));
  assert.equal(app.route, "MoMoDirect");
  assert.ok(shown(app).includes(NEW_ERROR), shown(app));
  assert.doesNotMatch(shown(app), /Could not save the payment|Tap Try again/);
  assert.equal(await db.transactions.count(), before, "nothing saved");
  await app.tap(/^Money received$/);
  assert.equal(app.route, "SaleRecorded");
  assert.equal(await db.transactions.count(), before + 1, "saved once");
});

test("62: an unknown result shows the new text; Money received again reuses the attempt key, so the save that went through is not recorded twice", async () => {
  const { MoMoDirect } = await loadJsx("src/pos/MoMoScreens.jsx");
  const attempts = [];
  const onConfirm = async (details) => {
    attempts.push(details.attemptId);
    // The save goes through, but its result is lost the first time.
    await recordCashSale({ amountPesewas: 1300, cashReceivedPesewas: 0, momoReceivedPesewas: 1300, saleItems: [], parts: [{ paymentMethod: "momo", amountPesewas: 1300, verification: "merchant_confirmed" }], attemptId: details.attemptId });
    if (attempts.length === 1) throw Object.assign(new Error("unknown"), { name: "SaveOutcomeUnknownError" });
  };
  const view = render({ type: MoMoDirect, props: { params: { amountPesewas: 1300 }, onBack() {}, onConfirm, onPick() {} } });
  flushEffects(view);
  const settle = async () => { for (let index = 0; index < 8; index += 1) await new Promise((resolve) => setImmediate(resolve)); view.rerender(); };
  for (let index = 0; index < 50 && findButton(view.tree, "Money received").props.disabled; index += 1) await settle();
  const original = console.error;
  console.error = () => {};
  try {
    findButton(view.tree, "Money received").props.onClick();
    await settle();
    const text = textOf(view.tree).replace(/\s+/g, " ");
    assert.ok(text.includes(NEW_ERROR), text);
    assert.doesNotMatch(text, /Tap Try again|It will not be recorded twice/);
    assert.equal(findButton(view.tree, "Money received").props.disabled, false, "Money received is the retry");
    findButton(view.tree, "Money received").props.onClick();
    await settle();
  } finally {
    console.error = original;
  }
  assert.equal(attempts.length, 2);
  assert.equal(attempts[1], attempts[0], "the same attempt key");
  const sales = (await db.transactions.toArray()).filter((row) => row.amountPesewas === 1300);
  assert.equal(sales.length, 1, "recorded once");
});
