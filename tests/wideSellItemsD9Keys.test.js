import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { createProduct } from "../src/db/products.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { isDoneEnter } from "../src/pos/sellKeyboard.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Wide D9 (wide_layout.screens["20 and 55 Sell with items"], same_as_phone (d), wiring 20 "Wide
// keyboard" and "Wide Other amount tile"): 20 and 55 on one screen on the 20 route (and on the 55 route
// when the window is widened there). The phone controls of 20 and 55 with the same names, Next replaced
// by Done, plus the Other amount tile (Back to 15). Done saves exactly what 55 saves. 37 and 38 are
// dialogs over D9; Escape or the dark background is Back. Enter is Done, never in a text field.

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

const WIDTHS = [768, 1024, 1280, 1440];

async function open(width) {
  const app = await openPosApp({ width });
  after(() => app.restoreConsole());
  return app;
}

// 15 > + Add items > Cabbage (38 Add 1).
async function cartOfOne(app) {
  await app.tap(/^Sell$/);
  await app.tap(/Add items/);
  assert.equal(app.route, "SellWithItems");
  await app.tap(/^CCabbage/);
  await app.tap(/^Add 1/);
  assert.equal(app.route, "SellWithItems");
}

const main = (app) => [...walk(app.view.tree)].find((node) => node.type === "main");
const isD9 = (app) => [...walk(app.view.tree)].some((node) => node.props?.["data-sell-items-wide"] !== undefined);
const names = (root) => [...walk(root)]
  .filter((node) => node.type === "button")
  .map((node) => node.props["aria-label"] ?? textOf(node).trim());
const dialog = (app) => [...walk(app.view.tree)].find((node) => node.props?.role === "dialog" && node.props?.["aria-modal"] === "true") ?? null;
const pressKey = (key, target = null) => {
  let prevented = false;
  for (const listener of window.__listeners.keydown ?? []) listener({ key, target, preventDefault() { prevented = true; }, stopPropagation() {} });
  return prevented;
};
const savedRows = async () => (await db.transactions.toArray()).map((row) => Object.fromEntries(Object.entries(row)
  .filter(([key]) => !/id$|Id$|_at$|At$|time|date|attempt|sync/i.test(key))));

test("D9 Enter: Done when enabled; never in Find item, a text field or on a focused button; nothing with an empty sale", async () => {
  const app = await open(1024);
  await app.tap(/^Sell$/);
  await app.tap(/Add items/);
  assert.equal(pressKey("Enter"), false, "empty sale: Done is disabled, Enter does nothing");
  assert.match(app.text(), /Add an item first\. Then press Done or Enter\./);
  await app.tap(/^CCabbage/);
  await app.tap(/^Add 1/);
  const field = { matches: (selector) => selector.includes("input"), closest: () => null };
  assert.equal(pressKey("Enter", field), false, "in Find item Enter is not Done");
  await app.settle();
  assert.equal(app.route, "SellWithItems");
  assert.equal(pressKey("Enter"), true);
  await app.settle();
  assert.equal(app.route, "SaleRecorded");
  assert.equal((await db.transactions.count()), 1);
});

test("isDoneEnter: only a plain Enter outside fields, buttons and links", () => {
  const element = (tag) => ({ matches: (selector) => selector.split(",").map((part) => part.trim()).includes(tag) });
  assert.equal(isDoneEnter({ key: "Enter", target: null }), true);
  assert.equal(isDoneEnter({ key: "Enter", target: element("input") }), false);
  assert.equal(isDoneEnter({ key: "Enter", target: element("textarea") }), false);
  assert.equal(isDoneEnter({ key: "Enter", target: element("button") }), false);
  assert.equal(isDoneEnter({ key: "Enter", target: { matches: () => false, isContentEditable: true } }), false);
  assert.equal(isDoneEnter({ key: "Enter", shiftKey: true, target: null }), false);
  assert.equal(isDoneEnter({ key: "1", target: null }), false);
});

test("37 and 38 are dialogs over D9 (routes unchanged); Escape and a click on the dark background are Back", async () => {
  const app = await open(1280);
  await cartOfOne(app);
  await app.tap("Quantity Cabbage");
  assert.equal(app.route, "HowManyItem");
  assert.ok(dialog(app), "38 is a dialog");
  assert.ok(isD9(app), "D9 behind it");
  const inert = [...walk(app.view.tree)].find((node) => node.props?.inert);
  assert.ok([...walk(inert)].some((node) => node.props?.["data-sell-items-wide"] !== undefined), "D9 behind is inert");
  pressKey("Escape");
  await app.settle();
  assert.equal(app.route, "SellWithItems");
  assert.equal(dialog(app), null);

  await app.tap("Quantity Cabbage");
  const scrim = [...walk(app.view.tree)].find((node) => node.props?.["data-wide-dialog-scrim"] !== undefined);
  scrim.props.onMouseDown({ target: "scrim", currentTarget: "scrim" });
  await app.settle();
  assert.equal(app.route, "SellWithItems");

  // 38 still sets the quantity and returns to D9.
  await app.tap("Quantity Cabbage");
  await app.tap("4");
  await app.tap(/^Add 4/);
  assert.equal(app.route, "SellWithItems");
  assert.deepEqual(app.params.saleItems.map((line) => [line.name, line.quantity]), [["Cabbage", 4]]);
});

test("37 over D9 writes the price as on the phone and adds the item", async () => {
  // An item with no price yet (a starter-list item): its tile opens 37.
  const okraRow = await createProduct({ name: "Okra", pricePesewas: 100 });
  await db.products.update(okraRow.id, { default_price: 0 });
  const app = await open(1280);
  await app.tap(/^Sell$/);
  await app.tap(/Add items/);
  await app.tap(/^OOkra/);
  assert.equal(app.route, "HowMuchIsItem");
  assert.ok(dialog(app));
  await app.keys(["3"]);
  await app.tap("Save price");
  assert.equal(app.route, "SellWithItems");
  const okra = (await db.products.toArray()).find((product) => product.name === "Okra");
  assert.equal(Math.round(Number(okra.default_price) * 100), 300);
  assert.deepEqual(app.params.saleItems.map((line) => [line.name, line.quantity]), [["Okra", 1]]);
});
