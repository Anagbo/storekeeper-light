import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Wiring MOMO16 (decided 11 Nov 2026): the same order, lock and leave question on 19's own MoMo
// choice and on 27 opened from 19. Direct on 61 returns unconfirmed; 62
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

async function headerHome(app) {
  const button = nodes(app.view.tree).find((node) => node.type === "button" && node.props["aria-label"] === "Home");
  await button.props.onClick();
  return app.settle();
}

const momoOf = (parts = []) => parts.find((part) => part.paymentMethod === "momo");

// ---- 19: its own MoMo choice --------------------------------------------------------------

// Sell 8.00 > Owe > Juju > 18 > A little at a time (19): GH₵4.00 each time, Today, GH₵3.00 paid today.
async function to19PayingToday(app) {
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Owe");
  await app.tap(/^JJuju/);
  await app.tap(/^Next/);
  await app.tap(/A little at a time/);
  assert.equal(app.route, "ALittleAtATime");
  await app.type("How much each time?", "4");
  await app.tap("Today");
  await app.type("Amount paid today", "3");
}

const juju = async () => {
  const rows = (await db.transactions.toArray()).filter((row) => (row.customer_name ?? row.customerName ?? "").toLowerCase() === "juju");
  return { sales: rows.filter((row) => row.paymentType === "credit" && row.amountPesewas === 800) };
};

test("19 MoMo: Direct returns to 19 not confirmed and saves nothing; Save plan opens 62; Back saves nothing; Money received saves once and lands on 31", async () => {
  const app = await open();
  await to19PayingToday(app);
  const before = await counts();
  await app.tap("MoMo");
  assert.equal(app.route, "MoMoChoice");
  await app.tap(/^Customer sends to my number/);
  assert.equal(app.route, "ALittleAtATime", "Direct returns to 19, not to 62");
  assert.equal(app.params.verification, undefined, "not confirmed");
  assert.deepEqual(await counts(), before);
  await app.tap(/^Save plan$/);
  assert.equal(app.route, "MoMoDirect", "Save plan opens 62");
  assert.match(shown(app), /send GH₵3\.00/);
  await app.tap("Back");
  assert.equal(app.route, "ALittleAtATime");
  assert.deepEqual(await counts(), before, "Back on 62 saves nothing");
  await app.tap(/^Save plan$/);
  await app.tap(/^Money received$/);
  assert.equal(app.route, "CreditSaved");
  assert.equal((await juju()).sales.length, 1, "saved once");
  const momo = (await db.payments.toArray()).filter((row) => row.paymentMethod === "momo" || row.payment_method === "momo");
  assert.equal(momo.length, 1);
  assert.equal(momo[0].momoVerification, "merchant_confirmed");
  assert.equal(app.state.history.length, 0);
});

test("19 MoMo: a failed save after Money received stays on 19 with nothing saved and the MoMo payment locked; leaving asks; Save plan then saves once", async () => {
  const app = await open();
  await to19PayingToday(app);
  await app.tap("MoMo");
  await app.tap(/^Customer sends to my number/);
  await app.tap(/^Save plan$/);
  assert.equal(app.route, "MoMoDirect");
  await failingWrites(() => app.tap(/^Money received$/));
  assert.equal(app.route, "ALittleAtATime");
  assert.equal((await juju()).sales.length, 0, "nothing saved");
  assert.equal(app.params.verification, "merchant_confirmed");
  // Locked: the amount paid today, the method and Next cycle cannot change; "Received" shows.
  const amountInput = nodes(app.view.tree).find((node) => node.type === "input" && node.props["aria-label"] === "Amount paid today");
  assert.equal(amountInput.props.disabled, true);
  assert.ok(!nodes(app.view.tree).some((node) => node.type === "button" && textOf(node).trim() === "MoMo" && !node.props.disabled), "no MoMo method button to change");
  const nextCycle = nodes(app.view.tree).find((node) => node.type === "button" && /^Next cycle/.test(textOf(node).trim()));
  assert.equal(nextCycle.props.disabled, true);
  assert.match(shown(app), /Received/);
  assert.match(shown(app), /GH₵3\.00/);

  for (const leave of [(a) => a.tap("Back"), (a) => a.phoneBack(), headerHome]) {
    await leave(app);
    assert.equal(dialogs(app.view.tree).length, 1);
    assert.ok(textOf(dialogs(app.view.tree)[0]).includes(QUESTION("GH₵3.00")));
    await app.tap("Stay");
    assert.equal(app.route, "ALittleAtATime");
  }
  await app.tap(/^Save plan$/);
  assert.equal(app.route, "CreditSaved", "already confirmed: no 62");
  assert.equal((await juju()).sales.length, 1);
});

test("19 MoMo: Leave with received MoMo goes to an empty 15 with nothing behind; without it, Back and Home do not ask", async () => {
  const app = await open();
  await to19PayingToday(app);
  await app.tap("MoMo");
  await app.tap(/^Customer sends to my number/);
  await app.tap("Back");
  assert.equal(dialogs(app.view.tree).length, 0, "not confirmed yet: no question");
  assert.equal(app.route, "WhenWillTheyPay");
  await headerHome(app);
  assert.equal(dialogs(app.view.tree).length, 0);
  assert.equal(app.route, "Home");

  await to19PayingToday(app);
  await app.tap("MoMo");
  await app.tap(/^Customer sends to my number/);
  await app.tap(/^Save plan$/);
  await failingWrites(() => app.tap(/^Money received$/));
  await app.tap("Back");
  await app.tap("Leave");
  assert.equal(app.route, "Sell");
  assert.equal(app.state.history.length, 0);
  assert.match(shown(app), /GH₵0\.00/);
});

// ---- 27 opened from 19 --------------------------------------------------------------------

// 19 paying GH₵3.00 today > Split payment (27) > Cash > Edit Cash 1.00 > MoMo 2.00 > 61 Direct > back on 27.
async function split27From19(app) {
  await to19PayingToday(app);
  await app.tap(/Split payment$/);
  assert.equal(app.route, "SplitPayment");
  assert.equal(app.params.installmentSplit, true);
  await app.tap(/^Cash$/);
  await app.tap("Edit Cash amount");
  await app.type("split-draft-amount", "1.00");
  await app.tap(/^Save$/);
  await app.tap(/^MoMo$/);
  await app.type("split-draft-amount", "2.00");
  await app.tap(/^Save$/);
  await app.tap(/^Customer sends to my number/);
}

test("27 from 19: Direct returns to 27 not confirmed; Done returns to 19 with nothing saved; Save plan opens 62; Money received saves once and lands on 31", async () => {
  const app = await open();
  const before = await counts();
  await split27From19(app);
  assert.equal(app.route, "SplitPayment", "Direct returns to 27");
  assert.equal(momoOf(app.params.splitParts).verification, undefined);
  assert.match(shown(app), /not confirmed yet/);
  await app.tap(/^Done$/);
  assert.equal(app.route, "ALittleAtATime", "Done returns to 19, no 62 yet");
  assert.deepEqual(await counts(), before);
  assert.match(shown(app), /not confirmed yet/);
  await app.tap(/^Save plan$/);
  assert.equal(app.route, "MoMoDirect");
  assert.match(shown(app), /send GH₵2\.00/);
  await app.tap("Back");
  assert.equal(app.route, "ALittleAtATime");
  assert.deepEqual(await counts(), before, "Back on 62 saves nothing");
  await app.tap(/^Save plan$/);
  await app.tap(/^Money received$/);
  assert.equal(app.route, "CreditSaved");
  assert.equal((await juju()).sales.length, 1, "saved once");
  const momo = (await db.payments.toArray()).filter((row) => row.paymentMethod === "momo" || row.payment_method === "momo");
  assert.equal(momo.length, 1);
  assert.equal(momo[0].momoVerification, "merchant_confirmed");
});

test("27 from 19: a failed save stays on 19 with the MoMo part locked (Received) and the leave question; Save plan then saves once", async () => {
  const app = await open();
  await split27From19(app);
  await app.tap(/^Done$/);
  await app.tap(/^Save plan$/);
  await failingWrites(() => app.tap(/^Money received$/));
  assert.equal(app.route, "ALittleAtATime");
  assert.equal((await juju()).sales.length, 0);
  assert.match(shown(app), /MoMo\s*Received|MoMoReceived/);
  const nextCycle = nodes(app.view.tree).find((node) => node.type === "button" && /^Next cycle/.test(textOf(node).trim()));
  assert.equal(nextCycle.props.disabled, true);
  await headerHome(app);
  assert.ok(textOf(dialogs(app.view.tree)[0]).includes(QUESTION("GH₵2.00")));
  await app.tap("Stay");
  await app.tap(/^Save plan$/);
  assert.equal(app.route, "CreditSaved");
  assert.equal((await juju()).sales.length, 1);
});

test("19: Next cycle stays available while the MoMo part back from 27 is not confirmed yet (only received MoMo locks it)", async () => {
  const app = await open();
  await split27From19(app);
  await app.tap(/^Done$/);
  const nextCycle = () => nodes(app.view.tree).find((node) => node.type === "button" && /^Next cycle/.test(textOf(node).trim()));
  assert.equal(Boolean(nextCycle().props.disabled), false, "not confirmed yet: Next cycle still drops the parts");
});
