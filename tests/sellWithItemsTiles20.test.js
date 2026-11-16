import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { createProduct } from "../src/db/products.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Wiring 20 "Empty and search states" and "Item tiles" (decided 16 Nov 2026).
// No items and nothing typed: "You have no items yet. Tap + New item to add your first one."
// "No items match that search." only when something is typed and nothing matches. + New item stays.
// A tile shows the price as GH₵x.xx; a tile in the sale is selected (light green, 3px green border,
// badge "×n"), each tap adds one, and the accessible name says so ("Bread, GH₵2.00, 1 in the sale").

globalThis.HTMLElement ??= class {};

after(async () => {
  setLiveQuery(null);
  db.close();
  await db.delete();
});

const EMPTY = "You have no items yet. Tap + New item to add your first one.";
const NO_MATCH = "No items match that search.";
const nodes = (tree) => [...walk(tree)].filter((node) => node.props);
const tiles = (tree) => nodes(tree).filter((node) => node.type === "button" && node.props["data-item-tile"] !== undefined);
const tile = (tree, name) => tiles(tree).find((node) => node.props["data-item-tile"] === name);
const newItemButton = (tree) => nodes(tree).find((node) => node.type === "button" && /New item/.test(textOf(node)));
const shown = (tree) => textOf(tree).replace(/\s+/g, " ");

async function show({ products, saleItems = [], query = "" }) {
  const { default: SellWithItems } = await loadJsx("src/pos/SellWithItems.jsx");
  const updates = [];
  let params = { saleItems };
  setLiveQuery(() => ({ products, error: "" }));
  const view = render({ type: SellWithItems, props: { get params() { return params; }, onBack() {}, onNavigate() {}, onUpdateParams: (next) => { updates.push(next); params = { ...params, ...next }; } } });
  if (query) {
    nodes(view.tree).find((node) => node.type === "input").props.onChange({ target: { value: query } });
    view.rerender();
  }
  return { view, updates };
}

const BREAD = { id: 1, name: "Bread", default_price: 2 };
const RICE = { id: 2, name: "Rice", default_price: 5 };

test("20 empty: no items and nothing typed says how to add the first one, never \"No items match\"", async () => {
  const { view } = await show({ products: [] });
  assert.match(shown(view.tree), new RegExp(EMPTY.replace(/[.+]/g, "\\$&")));
  assert.doesNotMatch(shown(view.tree), /No items match/);
  assert.ok(newItemButton(view.tree), "+ New item stays visible");
  setLiveQuery(null);
});

test("20 empty: \"+ New item\" in the message is a <strong> (bold, dark green); the rest is regular weight", async () => {
  const { view } = await show({ products: [] });
  const message = nodes(view.tree).find((node) => node.type === "p" && /You have no items yet/.test(textOf(node)));
  assert.ok(message, "the empty message is shown");
  const strong = [...walk(message)].find((node) => node.props && node.type === "strong");
  assert.ok(strong, "the message contains a <strong>");
  assert.equal(textOf(strong).replace(/\s+/g, " ").trim(), "+ New item");
  assert.match(strong.props.className, /font-extrabold/);
  assert.match(strong.props.className, /text-emerald-900/, "same dark green as the + New item tile label");
  assert.doesNotMatch(message.props.className, /font-(semibold|bold|extrabold)/, "the rest of the sentence is regular weight");
  setLiveQuery(null);
});

test("20 search: \"No items match that search.\" only when something is typed and nothing matches", async () => {
  const listed = await show({ products: [BREAD, RICE] });
  assert.doesNotMatch(shown(listed.view.tree), /No items match|You have no items yet/, "items and nothing typed: no message");
  const none = await show({ products: [BREAD, RICE], query: "zzz" });
  assert.match(shown(none.view.tree), /No items match that search\./);
  assert.doesNotMatch(shown(none.view.tree), /Add items from your list first/);
  assert.doesNotMatch(shown(none.view.tree), /You have no items yet/);
  assert.ok(newItemButton(none.view.tree), "+ New item stays visible");
  const emptyTyped = await show({ products: [], query: "bre" });
  assert.match(shown(emptyTyped.view.tree), /No items match that search\./, "no items but something typed: the search message");
  setLiveQuery(null);
});

test("20 tiles: the price is GH₵x.xx; a tile in the sale is selected with a ×n badge that follows each tap", async () => {
  const { view, updates } = await show({ products: [BREAD, RICE], saleItems: [{ productId: 1, name: "Bread", quantity: 1, unitPricePesewas: 200 }] });
  const rice = tile(view.tree, "Rice");
  assert.match(textOf(rice), /GH₵5\.00/, "price with the cedi sign");
  assert.equal(rice.props["aria-label"], "Rice, GH₵5.00");
  assert.equal(nodes(rice).some((node) => node.props["data-count-badge"] !== undefined), false, "not in the sale: no badge");
  assert.doesNotMatch(String(rice.props.className), /border-\[3px\]/);

  let bread = tile(view.tree, "Bread");
  assert.equal(bread.props["aria-label"], "Bread, GH₵2.00, 1 in the sale");
  assert.equal(bread.props["aria-pressed"], undefined, "the state is in the name, not a toggle");
  assert.match(String(bread.props.className), /border-\[3px\]/);
  assert.match(String(bread.props.className), /border-emerald-900/);
  assert.match(String(bread.props.className), /bg-green-100/);
  const badge = () => nodes(tile(view.tree, "Bread")).find((node) => node.props["data-count-badge"] !== undefined);
  assert.equal(textOf(badge()), "×1");

  bread.props.onClick();
  view.rerender();
  assert.deepEqual(updates.at(-1).saleItems.map((item) => [item.name, item.quantity]), [["Bread", 2]], "a tap adds one");
  bread = tile(view.tree, "Bread");
  assert.equal(textOf(badge()), "×2", "the badge follows");
  assert.equal(bread.props["aria-label"], "Bread, GH₵2.00, 2 in the sale");
  setLiveQuery(null);
});

test("20 new item: a newly created item appears as a tile and selects like any other", async () => {
  resetBrowserBack();
  await Promise.all([db.products, db.debts, db.customers, db.transactions, db.payments, db.settings, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
  await createProduct({ name: "Bread", pricePesewas: 200 });
  let liveResults = new Map();
  setLiveQuery((deps, query) => {
    const key = `${String(query)}|${JSON.stringify(deps)}`;
    if (!liveResults.has(key)) {
      liveResults.set(key, undefined);
      Promise.resolve().then(query).then((value) => liveResults.set(key, value), () => liveResults.set(key, null));
    }
    return liveResults.get(key);
  });
  const app = await openPosApp();
  after(() => app.restoreConsole());
  await app.tap(/^Sell$/);
  await app.tap(/Add items/);
  assert.equal(app.route, "SellWithItems");
  await app.tap(/New item/);
  assert.equal(app.route, "NewItem");
  const fields = nodes(app.view.tree).filter((node) => node.type === "input");
  fields[0].props.onChange({ target: { value: "Milo" } });
  await app.settle();
  nodes(app.view.tree).filter((node) => node.type === "input")[1].props.onChange({ target: { value: "3" } });
  await app.settle();
  nodes(app.view.tree).find((node) => node.type === "form").props.onSubmit({ preventDefault() {} });
  await app.settle();
  assert.equal(app.route, "SellWithItems");
  liveResults = new Map(); // a live query sees the new row (the shim does not re-run queries itself)
  await app.settle();
  const milo = tile(app.view.tree, "Milo");
  assert.ok(milo, "the new item is a tile");
  assert.equal(milo.props["aria-label"], "Milo, GH₵3.00");
  await app.tap("Milo, GH₵3.00");
  assert.equal(app.route, "HowManyItem");
  await app.tap(/^Add 1/);
  assert.equal(app.route, "SellWithItems");
  const selected = tile(app.view.tree, "Milo");
  assert.equal(selected.props["aria-label"], "Milo, GH₵3.00, 1 in the sale");
  assert.equal(textOf(nodes(selected).find((node) => node.props["data-count-badge"] !== undefined)), "×1");
});
