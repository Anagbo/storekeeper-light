import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { setLiveQuery, walk } from "./helpers/renderJsx.js";

globalThis.HTMLElement ??= class {};

// Wiring 62 "No MoMo number saved" (14 Nov 2026, phone test): when Direct MoMo is used and no number
// is saved, 62 shows one card "Your MoMo number is not set up yet" with "Set up MoMo number" (63)
// instead of "Send to my number"; the three steps are hidden; Money received is off. After Save on 63,
// Back is on 62 with the draft intact, the number shown and Money received on. Same for a MoMo sale,
// a MoMo collection, a split MoMo part (16) and Save plan (19). No "Menu › Settings › …" text.

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
  await recordCreditSale({ name: "Juju", amountPesewas: 1000, now: Date.now() - 3 * 86_400_000 });
});

async function open() {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  return app;
}

const shown = (app) => app.text().replace(/\s+/g, " ");
const nodes = (tree) => [...walk(tree)].filter((node) => node.props);

async function to25(app) {
  const debt = (await db.debts.toArray()).find((row) => row.status === "unpaid");
  const home = nodes(app.view.tree).find((node) => node.type?.name === "Home");
  home.props.onNavigate("CollectPayment", { debtId: debt.id, customerName: "Juju" });
  await app.settle();
  assert.equal(app.route, "CollectPayment");
}

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

const FLOWS = {
  "a MoMo sale (15)": {
    async reach(app) {
      await app.tap(/^Sell$/);
      await app.keys(["1", "3"]);
      await app.tap("MoMo");
      await app.tap(/^Customer sends to my number/);
    },
    amount: "GH₵13.00",
    after: "SaleRecorded"
  },
  "a MoMo collection (25)": {
    async reach(app) {
      await to25(app);
      await app.tap("Pay all");
      await app.tap(/^MoMo$/);
      if (app.route === "MoMoChoice") await app.tap(/^Customer sends to my number/);
    },
    amount: "GH₵10.00",
    after: "PaymentReceived"
  },
  "a split MoMo part (16 Done)": {
    async reach(app) {
      await app.tap(/^Sell$/);
      await app.keys(["8"]);
      await app.tap("Split payment");
      await cashAndMomo(app, "3.00", "5.00");
      await app.tap(/^Done$/);
    },
    amount: "GH₵5.00",
    partLine: "MoMo part of a GH₵8.00 sale",
    after: "SaleRecorded"
  },
  "Save plan (19)": {
    async reach(app) {
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
      await cashAndMomo(app, "1.00", "2.00");
      await app.tap(/^Done$/);
      assert.equal(app.route, "ALittleAtATime");
      await app.tap(/^Save plan$/);
    },
    amount: "GH₵2.00",
    partLine: "MoMo part of a GH₵3.00 payment"
  }
};

function assertNotSetUp(app, flow, where) {
  assert.equal(app.route, "MoMoDirect", where);
  const text = shown(app);
  assert.ok(text.includes("Your MoMo number is not set up yet"), `${where}: the card is shown: ${text}`);
  assert.ok(app.button("Set up MoMo number"), `${where}: the Set up MoMo number button`);
  assert.equal(app.button(/^Money received$/).props.disabled, true, `${where}: Money received is off`);
  assert.doesNotMatch(text, /Send to my number/, `${where}: no Send to my number card`);
  assert.doesNotMatch(text, /Before you tap Money received|Wait for the MoMo message/, `${where}: the steps are hidden`);
  assert.doesNotMatch(text, /Menu ›|Settings ›|MoMo payments\./, `${where}: no text path to Settings`);
  assert.ok(text.includes(flow.amount), `${where}: the amount is still shown`);
  if (flow.partLine) assert.ok(text.includes(flow.partLine), `${where}: ${flow.partLine}`);
}

async function saveNumberOn63(app) {
  assert.equal(app.route, "PaymentSettings");
  await app.tap("Customer sends to my number");
  await app.type("My MoMo number", "024 123 4567");
  await app.tap(/^Save$/);
  await app.tap(/^Yes, save$/);
}

for (const [name, flow] of Object.entries(FLOWS)) {
  test(`62 with no MoMo number, ${name}: set-up card, steps hidden, Money received off; after 63 Save the number shows, Money received is on and the draft is intact`, async () => {
    const app = await open();
    await flow.reach(app);
    await app.settle();
    assertNotSetUp(app, flow, `${name}, no number`);
    const draft = structuredClone(app.params);
    const history = app.state.history.map((entry) => ({ current: entry.current, params: structuredClone(entry.params) }));

    await app.tap("Set up MoMo number");
    await saveNumberOn63(app);

    assert.equal(app.route, "MoMoDirect", `${name}: Save on 63 returns to 62`);
    assert.deepEqual(app.params, draft, `${name}: the 62 draft is intact`);
    assert.deepEqual(app.state.history.map((entry) => ({ current: entry.current, params: entry.params })), history, `${name}: the screens behind 62 keep their drafts`);
    const text = shown(app);
    assert.ok(text.includes("024 123 4567"), `${name}: the number is shown: ${text}`);
    assert.ok(text.includes("Send to my number"));
    assert.ok(text.includes("Before you tap Money received"), `${name}: the steps are back`);
    assert.doesNotMatch(text, /not set up yet/);
    assert.ok(text.includes(flow.amount));
    if (flow.partLine) assert.ok(text.includes(flow.partLine));
    assert.equal(app.button(/^Money received$/).props.disabled, false, `${name}: Money received is on`);

    // The draft still works: Money received records the payment once.
    const before = await db.transactions.count() + await db.payments.count();
    await app.tap(/^Money received$/);
    if (flow.after) assert.equal(app.route, flow.after, `${name}: recorded`);
    assert.notEqual(app.route, "MoMoDirect", `${name}: left 62 after Money received`);
    assert.ok(await db.transactions.count() + await db.payments.count() > before, `${name}: something was recorded`);
  });
}

test("62 with no number: Back on 63 without saving returns to 62, still not set up, draft intact", async () => {
  const app = await open();
  await FLOWS["a MoMo sale (15)"].reach(app);
  await app.settle();
  const draft = structuredClone(app.params);
  await app.tap("Set up MoMo number");
  assert.equal(app.route, "PaymentSettings");
  await app.tap("Back");
  assertNotSetUp(app, FLOWS["a MoMo sale (15)"], "after Back from 63");
  assert.deepEqual(app.params, draft);
});

test("no screen tells the owner a Menu › Settings path", () => {
  const source = readFileSync(new URL("../src/pos/MoMoScreens.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Menu ›|Settings first/);
});
