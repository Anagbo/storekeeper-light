import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { createProduct } from "../src/db/products.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { setLiveQuery, walk } from "./helpers/renderJsx.js";

// rules_global.draft_survives_trip_away lists 20 (items in the cart); 15 says any items added are
// kept. Bug (16 Nov 2026): 15 > Add items > 20 (Cabbage, Carrots) > Back > Add items opened an empty
// 20. Decided 16 Nov 2026: the cart is kept in 15's route params as a kept draft (KEPT_ON_BACK), 15
// itself stays as it is (typed amount, no item list, keypad on), the item lines come back when 20 is
// reopened and the "Other amount" line follows 15's current amount. Cleared only by a saved sale,
// the header Home, another bottom-bar tab or Leave.

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
  await createProduct({ name: "Cabbage", pricePesewas: 200 });
  await createProduct({ name: "Carrots", pricePesewas: 300 });
});

async function open() {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  return app;
}

// What 20 shows: the selected tiles (with a count badge) and the cart lines with their quantities.
function shown20(app) {
  assert.equal(app.route, "SellWithItems");
  const tiles = [...walk(app.view.tree)]
    .filter((node) => node.type === "button" && node.props?.["data-item-tile"])
    .filter((node) => [...walk(node)].some((child) => child.props?.["data-count-badge"] !== undefined))
    .map((node) => node.props["data-item-tile"]);
  const lines = (app.params.saleItems ?? []).map((item) => [item.name, item.quantity]);
  return { tiles, lines };
}
const nextLabel = (app) => app.text().match(/Next · GH₵[\d.,]+/)?.[0];

async function to15(app, typed = "") {
  await app.tap(/^Sell$/);
  assert.equal(app.route, "Sell");
  if (typed) await app.keys([...typed]);
}

// 20: Cabbage × 1 and Carrots × 1 (38 Add 1 for each).
async function cartOfTwo(app) {
  await app.tap(/Add items/);
  assert.equal(app.route, "SellWithItems");
  await app.tap(/^CCabbage/);
  await app.tap(/^Add 1/);
  await app.tap(/^CCarrots/);
  await app.tap(/^Add 1/);
  assert.equal(app.route, "SellWithItems");
}

const BACKS = [["on-screen Back", (app) => app.tap("Back")], ["phone back", (app) => app.phoneBack()]];

for (const [name, back] of BACKS) {
  test(`A/C: 20 > ${name} to 15 > Add items: the same tiles, quantities and Next total`, async () => {
    const app = await open();
    await to15(app);
    await cartOfTwo(app);
    const before = shown20(app);
    assert.equal(nextLabel(app), "Next · GH₵5.00");
    await back(app);
    assert.equal(app.route, "Sell");
    // 15 is unchanged: no saleItems of its own, amount 0.00, no items listed.
    assert.equal(app.params.saleItems, undefined);
    assert.doesNotMatch(app.text(), /Cabbage|Carrots/);
    assert.notEqual(app.button("2").props.disabled, true, "keypad still on");
    await app.tap(/Add items/);
    assert.deepEqual(shown20(app), before);
    assert.deepEqual(shown20(app).tiles, ["Cabbage", "Carrots"]);
    assert.deepEqual(shown20(app).lines, [["Cabbage", 1], ["Carrots", 1]]);
    assert.equal(nextLabel(app), "Next · GH₵5.00");
  });

  test(`B/D: Other amount 2 typed on 15 first, 20 > ${name} > Add items: the same cart and Next total`, async () => {
    const app = await open();
    await to15(app, "2");
    await cartOfTwo(app);
    assert.equal(nextLabel(app), "Next · GH₵7.00");
    await back(app);
    assert.equal(app.route, "Sell");
    assert.match(app.text(), /GH₵2\.00/);
    await app.tap(/Add items/);
    assert.deepEqual(shown20(app).lines, [["Other amount", 1], ["Cabbage", 1], ["Carrots", 1]]);
    assert.deepEqual(shown20(app).tiles, ["Cabbage", "Carrots"]);
    assert.equal(nextLabel(app), "Next · GH₵7.00");
  });

  test(`The Other amount line follows 15's current amount after ${name} (changed, cleared, unchanged)`, async () => {
    const app = await open();
    await to15(app, "2");
    await cartOfTwo(app);
    await back(app);
    // Changed: 2 > 24.
    await app.tap("4");
    assert.match(app.text(), /GH₵24\.00/);
    await app.tap(/Add items/);
    assert.deepEqual(shown20(app).lines, [["Other amount", 1], ["Cabbage", 1], ["Carrots", 1]]);
    assert.equal(nextLabel(app), "Next · GH₵29.00");
    await back(app);
    // Cleared: the items stay, no Other amount line.
    await app.tap("Delete last digit");
    await app.tap("Delete last digit");
    assert.match(app.text(), /GH₵0\.00/);
    await app.tap(/Add items/);
    assert.deepEqual(shown20(app).lines, [["Cabbage", 1], ["Carrots", 1]]);
    assert.equal(nextLabel(app), "Next · GH₵5.00");
    // Unchanged (0.00 again): the same.
    await back(app);
    await app.tap(/Add items/);
    assert.deepEqual(shown20(app).lines, [["Cabbage", 1], ["Carrots", 1]]);
  });

  test(`20 > 38 (quantity) > ${name}, 20 > 41 (New item) > ${name}, 20 > 55 > ${name}: the same cart; then 15 and back`, async () => {
    const app = await open();
    await to15(app);
    await cartOfTwo(app);
    await app.tap("More Cabbage");
    const expected = { tiles: ["Cabbage", "Carrots"], lines: [["Cabbage", 2], ["Carrots", 1]] };
    const check = () => {
      const now = shown20(app);
      assert.deepEqual({ tiles: now.tiles, lines: now.lines }, expected);
      assert.equal(nextLabel(app), "Next · GH₵7.00");
    };
    check();
    await app.tap("Quantity Cabbage");
    assert.equal(app.route, "HowManyItem");
    await back(app);
    check();
    await app.tap(/New item/);
    assert.equal(app.route, "NewItem");
    await back(app);
    check();
    await app.tap(/^Next/);
    assert.equal(app.route, "ReviewAndPay");
    await back(app);
    check();
    await back(app);
    assert.equal(app.route, "Sell");
    await app.tap(/Add items/);
    check();
  });
}

test("A saved sale (55 Done) clears the kept cart: New sale > Add items opens an empty 20", async () => {
  const app = await open();
  await to15(app);
  await cartOfTwo(app);
  await app.tap("Back");
  await app.tap(/Add items/);
  await app.tap(/^Next/);
  await app.tap(/Done/);
  assert.equal(app.route, "SaleRecorded");
  await app.tap(/New sale/);
  assert.equal(app.route, "Sell");
  await app.tap(/Add items/);
  assert.deepEqual(shown20(app).tiles, []);
  assert.deepEqual(shown20(app).lines, []);
  assert.equal(nextLabel(app), "Next · GH₵0.00");
});

test("A cash sale saved on 15 (Done) with a kept cart behind it: the next sale's 20 opens empty", async () => {
  const app = await open();
  await to15(app);
  await cartOfTwo(app);
  await app.tap("Back");
  await app.keys(["5"]);
  await app.tap(/Done/);
  assert.equal(app.route, "SaleRecorded");
  await app.tap(/New sale/);
  await app.tap(/Add items/);
  assert.deepEqual(shown20(app).lines, []);
});

test("The header Home (Menu > Home) clears the kept cart", async () => {
  const app = await open();
  await to15(app);
  await cartOfTwo(app);
  await app.tap("Back");
  await app.goHome();
  assert.equal(app.route, "Home");
  await to15(app);
  await app.tap(/Add items/);
  assert.deepEqual(shown20(app).lines, []);
});

test("Another bottom-bar tab (Owed) clears the kept cart", async () => {
  const app = await open();
  await to15(app);
  await cartOfTwo(app);
  await app.tap("Back");
  await app.tap(/^Owed$/);
  assert.equal(app.route, "PeopleWhoOweYou");
  await app.tap(/^Sell$/);
  await app.tap(/Add items/);
  assert.deepEqual(shown20(app).lines, []);
});
