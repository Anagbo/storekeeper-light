import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { createProduct } from "../src/db/products.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { setLiveQuery } from "./helpers/renderJsx.js";

// draft_survives_trip_away (12 Nov 2026), 20 Sell with items and 55 Review and pay: the items in the
// cart survive 37 (price), 38 (quantity), 41 (new item), 55 and Back, and 55 > Owe (17) > Back.
// (20 and 55 already keep the cart in their route params; this checks it.)

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
  await Promise.all([db.products, db.debts, db.customers, db.transactions, db.payments, db.settings, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
  await createProduct({ name: "Bread", pricePesewas: 500 });
  await createProduct({ name: "Sugar" });
});

async function open() {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  return app;
}

const cart = (app) => (app.params.saleItems ?? []).map((item) => [item.name, item.quantity]);

// 15 > Add items > 20 > Bread > 38 Add 2 > back on 20 with Bread × 2.
async function to20WithBread(app) {
  await app.tap(/^Sell$/);
  await app.tap(/Add items/);
  assert.equal(app.route, "SellWithItems");
  await app.tap(/^BBread/);
  assert.equal(app.route, "HowManyItem");
  await app.tap("2");
  await app.tap(/^Add 2/);
  assert.equal(app.route, "SellWithItems");
  assert.deepEqual(cart(app), [["Bread", 2]]);
}

for (const [name, back] of [["on-screen Back", (app) => app.tap("Back")], ["phone back", (app) => app.phoneBack()]]) {
  test(`20: the cart survives 37 (price), 38 (quantity) and 41 (new item) and ${name}`, async () => {
    const app = await open();
    await to20WithBread(app);
    await app.tap(/^SSugar/);
    assert.equal(app.route, "HowMuchIsItem");
    await back(app);
    assert.deepEqual(cart(app), [["Bread", 2]]);
    await app.tap("Quantity Bread");
    assert.equal(app.route, "HowManyItem");
    await back(app);
    assert.deepEqual(cart(app), [["Bread", 2]]);
    await app.tap(/New item/);
    assert.equal(app.route, "NewItem");
    await back(app);
    assert.equal(app.route, "SellWithItems");
    assert.deepEqual(cart(app), [["Bread", 2]]);
  });

  test(`20 and 55: the cart survives Next > 55 > ${name}, and 55 > Owe > 17 > ${name}`, async () => {
    const app = await open();
    await to20WithBread(app);
    await app.tap(/^Next/);
    assert.equal(app.route, "ReviewAndPay");
    await back(app);
    assert.equal(app.route, "SellWithItems");
    assert.deepEqual(cart(app), [["Bread", 2]]);
    await app.tap(/^Next/);
    await app.tap(/^Owe$/);
    assert.equal(app.route, "WhoOwesYou");
    await back(app);
    assert.equal(app.route, "ReviewAndPay");
    assert.deepEqual(cart(app), [["Bread", 2]]);
    assert.match(app.text(), /GH₵10\.00/);
  });
}
