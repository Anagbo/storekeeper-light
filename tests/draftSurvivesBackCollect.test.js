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

// The shim's useLiveQuery: each query runs once per test (by its deps and source), as in momoConfirm27Collect.
let liveResults = new Map();
setLiveQuery((deps, query) => {
  const key = `${String(query)}|${JSON.stringify(deps)}`;
  if (!liveResults.has(key)) {
    liveResults.set(key, undefined);
    Promise.resolve().then(query).then((value) => liveResults.set(key, value), () => liveResults.set(key, null));
  }
  return liveResults.get(key);
});

// draft_survives_trip_away (12 Nov 2026), 25 and 26 (collect): the choice on the Collect sheet (Due
// now / Pay all) and the amount and method typed on 26 survive a trip to 61, 27 or 43 and Back.

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

async function to25(app) {
  const debt = (await db.debts.toArray()).find((row) => row.status === "unpaid");
  const home = [...walk(app.view.tree)].find((node) => node.type?.name === "Home");
  home.props.onNavigate("CollectPayment", { debtId: debt.id, customerName: "Juju" });
  await app.settle();
  assert.equal(app.route, "CollectPayment");
}

const onScreenBack = async (app) => app.tap(app.route === "DebtorDetail" ? "Done" : "Back");
for (const [name, back] of [["on-screen Back", onScreenBack], ["phone back", (app) => app.phoneBack()]]) {
  test(`25: Pay all survives See details (43) and ${name}`, async () => {
    const app = await open();
    await to25(app);
    await app.tap("Pay all");
    assert.equal(app.button("Pay all").props["aria-pressed"], true);
    await app.tap(/See Juju.s details/);
    assert.equal(app.route, "DebtorDetail");
    await back(app);
    assert.equal(app.route, "CollectPayment");
    assert.equal(app.button("Pay all").props["aria-pressed"], true);
    assert.equal(app.button("Due now").props["aria-pressed"], false);
  });

  test(`25: Pay all survives MoMo (61) and ${name}`, async () => {
    const app = await open();
    await to25(app);
    await app.tap("Pay all");
    await app.tap(/^MoMo$/);
    assert.equal(app.route, "MoMoChoice");
    await back(app);
    assert.equal(app.route, "CollectPayment");
    assert.equal(app.button("Pay all").props["aria-pressed"], true);
  });

  test(`26: the amount typed survives Split payment (27) and ${name}, and MoMo (61) and ${name}`, async () => {
    const app = await open();
    await to25(app);
    await app.tap("Pay part");
    assert.equal(app.route, "CollectPayPart");
    await app.keys(["4"]);
    const typed = app.amountShown("Amount to collect");
    assert.ok(typed);
    await app.tap(/Split payment$/);
    assert.equal(app.route, "SplitPayment");
    await back(app);
    assert.equal(app.route, "CollectPayPart");
    assert.equal(app.amountShown("Amount to collect"), typed);
    await app.tap(/^MoMo$/);
    assert.equal(app.route, "MoMoChoice");
    await back(app);
    assert.equal(app.amountShown("Amount to collect"), typed);
    assert.equal(app.button(/^Cash$/).props["aria-pressed"], true);
  });
}

test("25: closing the sheet and opening it again starts on Due now", async () => {
  const app = await open();
  await to25(app);
  await app.tap("Pay all");
  await app.tap("Close");
  assert.equal(app.route, "Home");
  await to25(app);
  assert.equal(app.button("Due now").props["aria-pressed"], true);
});
