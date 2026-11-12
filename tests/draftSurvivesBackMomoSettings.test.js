import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { getPreference, setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { textOf, walk } from "./helpers/renderJsx.js";

// draft_survives_trip_away (12 Nov 2026), 63 MoMo payments, 60 Phone request setup and 56 MoMo
// payment. Phone request is behind a flag that stays OFF in the app; these tests turn it on for the
// test only (openPosApp's env). Unsaved choices on 63 survive 60 and Back; 60's network and number
// survive 56 and Back, and Back and Set up again; 56's network and number survive 58 and Back, and
// Back to 60 and forward again. Nothing is stored before Save.

globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };

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

const labelled = (app, text) => {
  const label = [...walk(app.view.tree)].find((node) => node.type === "label" && textOf(node).startsWith(text));
  return [...walk(label)].find((node) => node.type === "input");
};
async function change(app, input, value) {
  input.props.onChange({ target: { value } });
  return app.settle();
}
const radio = (app, label) => [...walk(app.view.tree)].find((node) => node.type === "button" && node.props?.role === "radio" && textOf(node).startsWith(label));

async function to63(app) {
  await app.tap(/^Menu$/);
  await app.tap(/^Settings/);
  await app.tap(/^MoMo payments/);
  assert.equal(app.route, "PaymentSettings");
}

const backs = [["on-screen Back", (app) => app.tap("Back")], ["phone back", (app) => app.phoneBack()]];

for (const [name, back] of backs) {
  test(`63: unsaved number, network and When I tap MoMo survive Phone request setup (60) and ${name}`, async () => {
    const app = await open();
    await to63(app);
    await change(app, app.input("My MoMo number"), "0209998887");
    await app.tap("Telecel");
    await radio(app, "Always: customer sends to my number").props.onClick();
    await app.settle();
    await app.tap("Phone request: set up");
    assert.equal(app.route, "MoMoSetup");
    await back(app);
    assert.equal(app.route, "PaymentSettings");
    assert.equal(app.input("My MoMo number").props.value, "0209998887");
    assert.equal(app.button("Telecel").props["aria-pressed"], true);
    assert.equal(radio(app, "Always: customer sends to my number").props["aria-checked"], true);
    assert.equal(await getPreference("momoReceivingNumber", ""), "0241234567", "nothing saved");
    assert.equal(await getPreference("momoReceivingNetwork", ""), "MTN");
  });

  test(`63: the switch turned off survives 60 and ${name}`, async () => {
    const app = await open();
    await to63(app);
    await app.tap("Customer sends to my number");
    assert.equal(app.button("Customer sends to my number").props["aria-checked"], false);
    await app.tap("Phone request: set up");
    await back(app);
    assert.equal(app.button("Customer sends to my number").props["aria-checked"], false);
  });

  test(`60: payout network and number survive ${name} to 63 and Set up again`, async () => {
    const app = await open();
    await to63(app);
    await app.tap("Phone request: set up");
    await app.tap("Payout AirtelTigo");
    await change(app, labelled(app, "Payout MoMo number"), "0270001112");
    await back(app);
    assert.equal(app.route, "PaymentSettings");
    await app.tap("Phone request: set up");
    assert.equal(app.button("Payout AirtelTigo").props["aria-pressed"], true);
    assert.equal(labelled(app, "Payout MoMo number").props.value, "0270001112");
    assert.equal(await getPreference("paystackPayoutNumber", ""), "", "nothing saved");
  });

  test(`56 and 60 in a sale: 60's fields survive 56 and ${name}; 56's survive 58 and ${name}, and 60 and forward again`, async () => {
    const app = await open();
    await app.tap(/^Sell$/);
    await app.keys(["8"]);
    await app.tap(/^MoMo$/);
    assert.equal(app.route, "MoMoChoice");
    await app.tap(/^Phone request/);
    assert.equal(app.route, "MoMoSetup");
    await app.tap("Payout AirtelTigo");
    await change(app, labelled(app, "Payout MoMo number"), "0270001112");
    await app.tap(/^Save and verify/);
    assert.equal(app.route, "MoMoPayment");
    await app.tap("Network Telecel");
    await change(app, app.input("Customer's MoMo number"), "0201112223");
    await app.tap(/^Send request/);
    assert.equal(app.route, "MoMoCode");
    await back(app);
    assert.equal(app.route, "MoMoPayment");
    assert.equal(app.button("Network Telecel").props["aria-pressed"], true);
    assert.equal(app.input("Customer's MoMo number").props.value, "0201112223");
    await back(app);
    assert.equal(app.route, "MoMoSetup");
    assert.equal(app.button("Payout AirtelTigo").props["aria-pressed"], true);
    assert.equal(labelled(app, "Payout MoMo number").props.value, "0270001112");
    await app.tap(/^Save and verify/);
    assert.equal(app.route, "MoMoPayment");
    assert.equal(app.button("Network Telecel").props["aria-pressed"], true);
    assert.equal(app.input("Customer's MoMo number").props.value, "0201112223");
  });
}

test("63: header Home drops the unsaved choices", async () => {
  const app = await open();
  await to63(app);
  await change(app, app.input("My MoMo number"), "0209998887");
  await app.tap("Phone request: set up");
  await app.tap(/^Home$/);
  await to63(app);
  assert.equal(app.input("My MoMo number").props.value, "0241234567");
});
