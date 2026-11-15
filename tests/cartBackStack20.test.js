import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { createProduct } from "../src/db/products.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { setLiveQuery, walk } from "./helpers/renderJsx.js";

// Cart back stack (decided 12 Nov 2026): returning from 37, 38 or 41 to 20 goes back to the existing
// 20 (pop to it), never pushes a second 20. One Back from 20 then goes to the screen that opened 20
// (15), not to an older 20. The cart keeps its items; on-screen Back and the phone back agree.

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
const routes = (app) => [...app.state.history.map((entry) => entry.current), app.route];
const count20 = (app) => routes(app).filter((route) => route === "SellWithItems").length;

async function to20(app) {
  await app.tap(/^Sell$/);
  await app.tap(/Add items/);
  assert.equal(app.route, "SellWithItems");
  assert.equal(app.state.history.at(-1).current, "Sell", "15 opened 20");
}

// 38: Bread > Add 2.
async function add38(app) {
  await app.tap(/^BBread/);
  assert.equal(app.route, "HowManyItem");
  await app.tap("2");
  await app.tap(/^Add 2/);
  assert.equal(app.route, "SellWithItems");
}

// 37: Sugar (no price) > 3.00 > Save price.
async function price37(app) {
  await app.tap(/^SSugar/);
  assert.equal(app.route, "HowMuchIsItem");
  await app.keys(["3"]);
  await app.tap(/Save price/);
  assert.equal(app.route, "SellWithItems");
}

// 41: New item Rice 4.00 > Save.
async function new41(app) {
  await app.tap(/New item/);
  assert.equal(app.route, "NewItem");
  const field = (index) => [...walk(app.view.tree)].filter((node) => node.type === "input")[index];
  field(0).props.onChange({ target: { value: "Rice" } });
  await app.settle();
  field(1).props.onChange({ target: { value: "4.00" } });
  await app.settle();
  const form = [...walk(app.view.tree)].find((node) => node.type === "form");
  await form.props.onSubmit({ preventDefault() {} });
  await app.settle();
  await app.settle();
  assert.equal(app.route, "SellWithItems");
}

for (const [name, back] of [["on-screen Back", (app) => app.tap("Back")], ["phone back", (app) => app.phoneBack()]]) {
  test(`38 Add returns to the same 20: one ${name} from 20 goes to 15`, async () => {
    const app = await open();
    await to20(app);
    await add38(app);
    assert.equal(count20(app), 1, "no second 20 underneath");
    assert.deepEqual(cart(app), [["Bread", 2]]);
    await back(app);
    assert.equal(app.route, "Sell");
  });

  test(`37 Save price returns to the same 20: one ${name} from 20 goes to 15`, async () => {
    const app = await open();
    await to20(app);
    await add38(app);
    await price37(app);
    assert.equal(count20(app), 1);
    assert.deepEqual(cart(app), [["Bread", 2], ["Sugar", 1]]);
    await back(app);
    assert.equal(app.route, "Sell");
  });

  test(`41 Save returns to the same 20: one ${name} from 20 goes to 15`, async () => {
    const app = await open();
    await to20(app);
    await add38(app);
    await new41(app);
    assert.equal(count20(app), 1);
    assert.deepEqual(cart(app), [["Bread", 2]]);
    await back(app);
    assert.equal(app.route, "Sell");
  });
}

test("38 (new item, then Quantity) and 37: the cart keeps every item and the stack holds one 20 above 15", async () => {
  const app = await open();
  await to20(app);
  await add38(app);
  await app.tap("Quantity Bread");
  assert.equal(app.route, "HowManyItem");
  await app.tap("4");
  await app.tap(/^Add 4/);
  assert.equal(app.route, "SellWithItems");
  await price37(app);
  assert.deepEqual(cart(app), [["Bread", 4], ["Sugar", 1]]);
  assert.deepEqual(routes(app).slice(-2), ["Sell", "SellWithItems"]);
  assert.equal(count20(app), 1);
});

test("the phone back from 15 still does what it did before the fix (Back from 15 never reaches an old 20)", async () => {
  const app = await open();
  await to20(app);
  await app.phoneBack();
  assert.equal(app.route, "Sell");
  const fromFifteen = routes(app);
  await add38Again(app);
  await app.phoneBack();
  assert.equal(app.route, "Sell");
  assert.deepEqual(routes(app), fromFifteen, "the same stack under 15 as without the Add");
  await app.phoneBack();
  assert.notEqual(app.route, "SellWithItems");
});

async function add38Again(app) {
  await app.tap(/Add items/);
  await add38(app);
}
