import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Wiring 27 and 19 (decided 12 Nov 2026): nothing is received until the confirm step, so the
// split button on 27 is "Done" (not "Received"), and the draft panel on 19 (also after a failed
// save) says "Paying today", "Paid today" and "Total today". A MoMo row confirmed on 62 shows
// "Received ✓". "Payment received today" and "Total received" stay on the result screens.
// The single-method collect screens 25 and 26 keep "Received".

globalThis.HTMLElement ??= class {};

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
const buttonTexts = (app) => nodes(app.view.tree).filter((node) => node.type === "button").map((node) => textOf(node).trim());

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

async function split27From19(app) {
  await to19PayingToday(app);
  await app.tap(/Split payment$/);
  assert.equal(app.route, "SplitPayment");
  await app.tap(/^Cash$/);
  await app.tap("Edit Cash amount");
  await app.type("split-draft-amount", "1.00");
  await app.tap(/^Save$/);
  await app.tap(/^MoMo$/);
  await app.type("split-draft-amount", "2.00");
  await app.tap(/^Save$/);
  await app.tap(/^Customer sends to my number/);
}

async function to27Collect(app, { split = true } = {}) {
  const debt = (await db.debts.toArray()).find((row) => row.status === "unpaid");
  const home = nodes(app.view.tree).find((node) => node.type?.name === "Home");
  home.props.onNavigate("CollectPayment", { debtId: debt.id, customerName: "Juju" });
  await app.settle();
  await app.tap("Pay all");
  if (!split) return;
  await app.tap(/Split payment$/);
  assert.equal(app.route, "SplitPayment");
  await app.tap(/^Cash$/);
}

const DRAFT_WORDS = /Paying today|Total today/;
const RESULT_WORDS = /Payment received today|Total received/;

test("27 collect: the split button says Done, not Received", async () => {
  const app = await open();
  await to27Collect(app);
  const labels = buttonTexts(app);
  assert.ok(labels.includes("Done"), labels.join(" | "));
  assert.ok(!labels.includes("Received"), "no Received button on 27");
});

test("27 from 19: the split button says Done, not Received, and Done returns the parts to 19", async () => {
  const app = await open();
  await split27From19(app);
  assert.equal(app.route, "SplitPayment");
  assert.ok(!buttonTexts(app).includes("Received"));
  await app.tap(/^Done$/);
  assert.equal(app.route, "ALittleAtATime", "same behaviour: back to 19, nothing saved");
});

test("25/26 single-method collect keep Received", async () => {
  const app = await open();
  await to27Collect(app, { split: false });
  await app.tap(/^Cash$/);
  assert.ok(buttonTexts(app).some((label) => /^Received$/.test(label)), buttonTexts(app).join(" | "));
});

test("19 draft panel: Paying today, Paid today and Total today; the MoMo row not confirmed yet", async () => {
  const app = await open();
  await split27From19(app);
  await app.tap(/^Done$/);
  assert.equal(app.route, "ALittleAtATime");
  const text = shown(app);
  assert.match(text, /Paying today/);
  assert.match(text, /Total today/);
  assert.match(text, /Paid today/, "helper text under Amount paid today");
  assert.doesNotMatch(text, RESULT_WORDS);
  assert.match(text, /not confirmed yet/);
});

test("19 after a failed save: still the draft words, and the confirmed MoMo row shows Received ✓", async () => {
  const app = await open();
  await split27From19(app);
  await app.tap(/^Done$/);
  await app.tap(/^Save plan$/);
  await failingWrites(() => app.tap(/^Money received$/));
  assert.equal(app.route, "ALittleAtATime");
  const text = shown(app);
  assert.match(text, DRAFT_WORDS);
  assert.doesNotMatch(text, RESULT_WORDS);
  const status = nodes(app.view.tree).find((node) => node.props["data-recorded-part"] === "momo");
  const line = [...walk(status)].find((node) => node.props?.["data-row-status"] !== undefined);
  assert.equal(textOf(line), "Received ✓", "on its own status line");
});

// rules_global.saved_credit_layout (25 Nov 2026) replaced "Payment received today" and "Total received" on 31
// with one "Paid today" row: the payment taken today (Cash 1.00 + MoMo 2.00) is still shown, as its total,
// between This sale and Now owes; plain "Paid today" because two methods were used.
test("31 shows the payment taken today: Before, This sale, Paid today (the total of the parts), Now owes", async () => {
  const app = await open();
  await split27From19(app);
  await app.tap(/^Done$/);
  await app.tap(/^Save plan$/);
  await app.tap(/^Money received$/);
  assert.equal(app.route, "CreditSaved");
  const text = shown(app);
  assert.doesNotMatch(text, DRAFT_WORDS);
  const box = nodes(app.view.tree).find((node) => node.props["data-debt-saved-rows"] !== undefined);
  const rows = nodes(box).filter((node) => node.props["data-event-detail"] !== undefined).map((node) => [node.props["data-event-detail"], textOf(node)]);
  assert.deepEqual(rows, [["before", "BeforeGH₵10.00"], ["added", "This saleGH₵8.00"], ["paid-today", "Paid today− GH₵3.00"], ["now-owes", "Now owesGH₵15.00"]]);
  // rules_global.soft_tiles (23 Nov 2026): the block is the soft tile (no mint fill, no green border),
  // with #E2E8F0 dividers between the rows.
  const classes = new Set(String(box.props.className).split(/\s+/));
  assert.ok(classes.has("bg-[#F1F5F9]"), "soft tile fill");
  assert.ok(![...classes].some((c) => /emerald|^border(-2)?$|^border-slate/.test(c)), `no border, no green (${box.props.className})`);
  assert.ok(classes.has("[&>div]:border-[#E2E8F0]"), "#E2E8F0 row dividers");
});

test("28 keeps its result wording (Payment received) and never shows the draft words", async () => {
  const app = await open();
  await to27Collect(app);
  await app.tap(/^Done$/);
  assert.equal(app.route, "PaymentReceived");
  const text = shown(app);
  assert.match(text, /Payment received/);
  assert.doesNotMatch(text, DRAFT_WORDS);
});
