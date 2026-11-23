import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { createProduct } from "../src/db/products.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
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

test("D9 at 768, 1024, 1280, 1440: the controls of phone 20 and 55 with the same names, Next replaced by Done, plus Other amount", async () => {
  const phone = await open();
  await cartOfOne(phone);
  const on20 = names(main(phone)).filter((name) => !name.startsWith("Next"));
  await phone.tap(/^Next/);
  const on55 = names(main(phone));
  const expected = [...new Set([...on20, ...on55, "Other amount"])].sort();
  for (const width of WIDTHS) {
    const wide = await open(width);
    await cartOfOne(wide);
    assert.ok(isD9(wide), `${width}: D9`);
    assert.deepEqual([...new Set(names(main(wide)))].sort(), expected, `${width}: same controls and names`);
    const text = wide.text();
    for (const words of ["Sell with items", "Find item", "This sale", "Total", "How is it paid?", "Tap an item to add it to the sale."]) assert.ok(text.includes(words), `${width}: ${words}`);
    assert.match(text, /TotalGH₵2\.00/);
    assert.doesNotMatch(text, /Next ·/);
  }
});

test("D9 Done saves exactly what phone 55 Done saves (Cash), through the same onSaveSale", async () => {
  const phone = await open();
  await cartOfOne(phone);
  await phone.tap("More Cabbage");
  await phone.tap(/^Next/);
  await phone.tap(/Done/);
  assert.equal(phone.route, "SaleRecorded");
  const phoneRows = await savedRows();
  await db.transactions.clear();

  const wide = await open(1280);
  await cartOfOne(wide);
  await wide.tap("More Cabbage");
  await wide.tap(/Done$/);
  assert.equal(wide.route, "SaleRecorded");
  const wideRows = await savedRows();
  assert.equal(wideRows.length, 1);
  assert.deepEqual(wideRows, phoneRows);
});

test("D9 large_amount_confirm still asks before the save", async () => {
  await createProduct({ name: "Fridge", pricePesewas: 250_000 });
  const app = await open(1280);
  await app.tap(/^Sell$/);
  await app.tap(/Add items/);
  await app.tap(/^FFridge/);
  await app.tap(/^Add 1/);
  await app.tap(/Done$/);
  assert.match(app.text(), /Large amount/);
  assert.equal(await db.transactions.count(), 0, "not saved yet");
});

test("D9 Other amount tile: opens 15 as Back on phone 20 does; Add items brings the same cart back", async () => {
  const app = await open(1280);
  await cartOfOne(app);
  await app.tap("More Cabbage");
  await app.tap("Other amount");
  assert.equal(app.route, "Sell");
  await app.tap("5");
  await app.tap(/Add items/);
  assert.equal(app.route, "SellWithItems");
  assert.deepEqual(app.params.saleItems.map((line) => [line.name, line.quantity]), [["Other amount", 1], ["Cabbage", 2]]);
  assert.match(app.text(), /TotalGH₵9\.00/);
});

test("D9 Split payment > Cash 1.00 > Back: D9 keeps the parts; Owe opens 17 with the cart", async () => {
  const app = await open(1280);
  await cartOfOne(app);
  await app.tap(/Split payment$/);
  assert.equal(app.route, "SplitPayment");
  await app.tap(/^Cash$/);
  await app.tap("Edit Cash amount");
  await app.type("split-draft-amount", "1.00");
  await app.tap(/^Save$/);
  await app.tap("Back");
  assert.equal(app.route, "SellWithItems");
  assert.ok(app.params.splitDraft);
  await app.tap(/Split payment$/);
  assert.deepEqual(app.params.splitParts.map((part) => [part.paymentMethod, part.amountPesewas]), [["cash", 100]]);
  await app.tap("Back");
  await app.tap(/^Owe$/);
  assert.equal(app.route, "WhoOwesYou");
  assert.equal(app.params.amountPesewas, 200);
  assert.deepEqual(app.params.saleItems.map((line) => line.name), ["Cabbage"]);
});

test("Widened while 55 is open: the 55 route shows D9; a cart change reaches 20 too; Back goes to 15 with the cart kept", async () => {
  const app = await open(393);
  await cartOfOne(app);
  await app.tap(/^Next/);
  assert.equal(app.route, "ReviewAndPay");
  assert.equal(isD9(app), false, "phone 55");
  await app.resize(1280);
  assert.equal(app.route, "ReviewAndPay", "route unchanged");
  assert.ok(isD9(app), "D9 on the 55 route");
  await app.tap("More Cabbage");
  assert.deepEqual(app.params.saleItems.map((line) => [line.name, line.quantity]), [["Cabbage", 2]]);
  assert.deepEqual(app.state.history.at(-1).params.saleItems.map((line) => [line.name, line.quantity]), [["Cabbage", 2]], "20 below follows");
  await app.tap("Back");
  assert.equal(app.route, "Sell");
  await app.tap(/Add items/);
  assert.deepEqual(app.params.saleItems.map((line) => [line.name, line.quantity]), [["Cabbage", 2]]);
});

test("Narrowed back to the phone on D9: phone 20 shows the same cart", async () => {
  const app = await open(1280);
  await cartOfOne(app);
  await app.tap("More Cabbage");
  await app.resize(393);
  assert.equal(isD9(app), false);
  assert.match(app.text(), /Next · GH₵4\.00/);
});

