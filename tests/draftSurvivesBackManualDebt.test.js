import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { setLiveQuery, walk } from "./helpers/renderJsx.js";

// draft_survives_trip_away (12 Nov 2026), 53 Add a debt by hand: the amount, note and Taken on
// survive 18 and Back, and Back to 34 and Next again (17 > 34 > 53 > 18).

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
});

async function open() {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  return app;
}

const byPlaceholder = (app, placeholder) => [...walk(app.view.tree)].find((node) => node.type === "input" && node.props?.placeholder === placeholder);
async function change(app, input, value) {
  input.props.onChange({ target: { value } });
  return app.settle();
}
async function submit34(app) {
  [...walk(app.view.tree)].find((node) => node.type === "form").props.onSubmit({ preventDefault() {} });
  return app.settle();
}

// Owed > Add debt > 17 > New person (Kofi) > Next > 53: GH₵25.00, "Rice".
async function to53(app) {
  await app.tap(/^Owed$/);
  await app.tap(/Add debt/);
  assert.equal(app.route, "WhoOwesYou");
  await app.tap(/New person/);
  await change(app, byPlaceholder(app, "e.g. Kofi Mensah"), "Kofi");
  await submit34(app);
  assert.equal(app.route, "ManualDebtAmount");
  await app.keys(["2", "5"]); // whole cedis on the shared keypad (15 Nov 2026)
  await change(app, byPlaceholder(app, "What for? (optional)"), "Rice");
}

function assert53(app) {
  assert.equal(app.route, "ManualDebtAmount");
  assert.match(app.text(), /GH₵25\.00/);
  assert.equal(byPlaceholder(app, "What for? (optional)").props.value, "Rice");
}

for (const [name, back] of [["on-screen Back", (app) => app.tap("Back")], ["phone back", (app) => app.phoneBack()]]) {
  test(`53: amount and note survive Next > 18 > ${name}`, async () => {
    const app = await open();
    await to53(app);
    await app.tap(/^Next ›/);
    assert.equal(app.route, "WhenWillTheyPay");
    await back(app);
    assert53(app);
  });

  test(`53: amount and note survive ${name} to 34 and Next again`, async () => {
    const app = await open();
    await to53(app);
    await back(app);
    assert.equal(app.route, "NewPerson");
    assert.equal(byPlaceholder(app, "e.g. Kofi Mensah").props.value, "Kofi");
    await submit34(app);
    assert53(app);
  });
}
