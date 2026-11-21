import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { loadStarterCategories, saveStarterCategories } from "../src/db/preferences.js";
import { getAllStarterItems, getPopularCategories, mergeStarterItems, OTHER_CATEGORY_ID, starterChipCategories, starterItemsForChip } from "../src/db/starterItems.js";
import starterData from "../src/data/starter-items.json" with { type: "json" };
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";
import { waitFor } from "./helpers/waitFor.js";

// Wiring 36, "Starter list opened from My items 39" (decided 20 Nov 2026; setup 35/36/51/52 unchanged):
// heading "Add from starter list" and "Tick what you want to add."; nothing ticked; chips All, the
// categories chosen at setup (popular ones when none were saved), More categories; search across every
// category; items already in My items shown as "Added" and not tickable (name, case ignored); "Add N
// items" disabled at 0; Back, no Skip; back to 39 after adding.

after(async () => {
  setLiveQuery(null);
  db.close();
  await db.delete();
});
beforeEach(async () => {
  setLiveQuery(null);
  await Promise.all([db.products.clear(), db.settings.clear()]);
});

const settle = () => new Promise((resolve) => setImmediate(resolve));
const text = (node) => textOf(node).replace(/\s+/g, " ").trim();
const buttons = (tree) => [...walk(tree)].filter((node) => node.type === "button");
const button = (tree, label) => buttons(tree).find((node) => text(node) === label);
const chipGroups = (tree) => [...walk(tree)].filter((node) => node.props?.role === "group");
const chipLabels = (tree) => chipGroups(tree).flatMap((group) => buttons(group).map(text));
const itemRows = (tree) => {
  const chips = new Set(chipGroups(tree).flatMap(buttons));
  return buttons(tree).filter((node) => node.props["aria-pressed"] !== undefined && !chips.has(node));
};
const addedRows = (tree) => [...walk(tree)].filter((node) => node.props?.["data-added"] !== undefined);
const category = (id) => starterData.categories.find((entry) => entry.id === id);

// The browse mode, with these products in My items and these categories saved at setup.
async function browse({ products = [], setupCategories = [], onBack = () => {} } = {}) {
  const { default: ItemScreens } = await loadJsx("src/pos/ItemScreens.jsx");
  setLiveQuery((deps) => deps[0] === "starterCategories" ? { setupCategories } : { products, error: "" });
  return render({ type: ItemScreens, props: { route: "YourStarterList", params: { returnRoute: "MyItems" }, onBack, onNavigate() {} } });
}

// ---- the chip and item helpers ----

test("chips: the saved setup categories, in order; Something else and unknown ids are never chips", () => {
  const { chosen, more } = starterChipCategories(["hair", OTHER_CATEGORY_ID, "nope", "provisions", "hair"]);
  assert.deepEqual(chosen.map(({ id }) => id), ["hair", "provisions"]);
  assert.equal(more.length, starterData.categories.length - 2);
  assert.ok(!more.some(({ id }) => ["hair", "provisions", OTHER_CATEGORY_ID].includes(id)));
});

test("chips: with no saved categories the popular categories are the chips", () => {
  for (const saved of [undefined, [], [OTHER_CATEGORY_ID], "provisions"]) {
    const { chosen, more } = starterChipCategories(saved);
    assert.deepEqual(chosen.map(({ id }) => id), getPopularCategories().map(({ id }) => id));
    assert.equal(chosen.length + more.length, starterData.categories.length);
  }
});

test("a category chip shows only that category's items; All shows every starter item once, setup ones first", () => {
  const chips = starterChipCategories(["paint"]);
  const paint = starterItemsForChip("paint", chips).map(({ name }) => name);
  assert.deepEqual(paint, [...category("paint").core, ...category("paint").more]);
  const all = starterItemsForChip("all", chips).map(({ name }) => name);
  assert.deepEqual(all.slice(0, paint.length), paint, "the setup category comes first");
  assert.equal(new Set(all.map((name) => name.toLowerCase())).size, all.length, "no name twice");
  assert.equal(all.length, getAllStarterItems().length, "every starter item");
  const more = starterItemsForChip("more", chips).map(({ name }) => name.toLowerCase());
  assert.ok(more.includes("haircut") && !more.includes("primer"));
});

test("the setup categories are saved and loaded as a list of ids", async () => {
  assert.deepEqual(await loadStarterCategories(), []);
  await saveStarterCategories(["provisions", "hair"]);
  assert.deepEqual(await loadStarterCategories(), ["provisions", "hair"]);
  await assert.rejects(saveStarterCategories("provisions"), TypeError);
});

// ---- 36 from 39 ----

test("36 from 39: heading, Tick line, nothing ticked, Add 0 items disabled, Back and no Skip", async () => {
  const view = await browse({ setupCategories: ["provisions"] });
  const all = text(view.tree);
  assert.ok([...walk(view.tree)].some((node) => node.type === "h1" && text(node) === "Add from starter list"));
  assert.match(all, /Tick what you want to add\./);
  assert.doesNotMatch(all, /Untick|Your starter list|Skip|Continue/);
  assert.ok(itemRows(view.tree).length > 0);
  assert.ok(itemRows(view.tree).every((node) => node.props["aria-pressed"] === false), "nothing ticked");
  const add = button(view.tree, "Add 0 items");
  assert.ok(add, "Add 0 items");
  assert.equal(add.props.disabled, true);
  assert.ok(buttons(view.tree).some((node) => node.props["aria-label"] === "Back" || text(node) === "Back"), "Back");
});

test("36 from 39: Add N items counts the ticks and is enabled from 1", async () => {
  const view = await browse({ setupCategories: ["provisions"] });
  button(view.tree, "Rice").props.onClick();
  view.rerender();
  assert.equal(button(view.tree, "Add 1 item").props.disabled, false);
  button(view.tree, "Sugar").props.onClick();
  view.rerender();
  assert.equal(button(view.tree, "Add 2 items").props.disabled, false);
  button(view.tree, "Sugar").props.onClick();
  button(view.tree, "Rice").props.onClick();
  view.rerender();
  assert.equal(button(view.tree, "Add 0 items").props.disabled, true);
});

test("36 from 39: chips All, the setup categories, More categories; More shows the other categories", async () => {
  const view = await browse({ setupCategories: ["hair", "provisions"] });
  assert.deepEqual(chipLabels(view.tree), ["All", "Hair and beauty", "Provisions shop", "More categories"]);
  assert.equal(button(view.tree, "All").props["aria-pressed"], true);
  button(view.tree, "More categories").props.onClick();
  view.rerender();
  const labels = chipLabels(view.tree);
  assert.ok(labels.includes("Paint and finishing") && !labels.includes("Something else"));
  assert.equal(labels.filter((label) => label === "Hair and beauty").length, 1, "a setup category is not repeated under More");
  assert.ok(chipGroups(view.tree).every((group) => buttons(group).every((chip) => /min-h-11/.test(chip.props.className))), "chips at least 44px high");
  assert.ok(chipGroups(view.tree).every((group) => /flex-wrap/.test(group.props.className)), "the chip rows wrap, no chip is hidden");
});

test("36 from 39: no saved categories gives the popular categories as chips", async () => {
  const view = await browse({ setupCategories: [] });
  assert.deepEqual(chipLabels(view.tree), ["All", ...getPopularCategories().map(({ name }) => name), "More categories"]);
});

test("36 from 39: tapping a chip shows only that category", async () => {
  const view = await browse({ setupCategories: ["provisions", "hair"] });
  button(view.tree, "Hair and beauty").props.onClick();
  view.rerender();
  assert.equal(button(view.tree, "Hair and beauty").props["aria-pressed"], true);
  assert.deepEqual(itemRows(view.tree).map(text), [...category("hair").core, ...category("hair").more]);
  button(view.tree, "More categories").props.onClick();
  view.rerender();
  button(view.tree, "Paint and finishing").props.onClick();
  view.rerender();
  assert.deepEqual(itemRows(view.tree).map(text), [...category("paint").core, ...category("paint").more]);
  assert.ok(button(view.tree, "Paint and finishing"), "the More chips stay open while one of them is chosen");
  button(view.tree, "All").props.onClick();
  view.rerender();
  assert.equal(itemRows(view.tree).length, getAllStarterItems().length);
});

test("36 from 39: search finds items in every category, whatever chip is chosen", async () => {
  const view = await browse({ setupCategories: ["provisions"] });
  button(view.tree, "Provisions shop").props.onClick();
  view.rerender();
  const input = [...walk(view.tree)].find((node) => node.type === "input");
  input.props.onChange({ target: { value: "PRIMER" } });
  view.rerender();
  assert.deepEqual(itemRows(view.tree).map(text), ["Primer"], "a paint item found from the Provisions chip");
  input.props.onChange({ target: { value: "bread" } });
  view.rerender();
  const names = itemRows(view.tree).map(text);
  assert.ok(names.includes("Bread") && names.includes("Sugar bread") && names.includes("Whole wheat bread"));
  input.props.onChange({ target: { value: "zzzz" } });
  view.rerender();
  assert.match(text(view.tree), /No starter items match your search\./);
});

test("36 from 39: items already in My items show Added and cannot be ticked (name, case ignored)", async () => {
  const view = await browse({ setupCategories: ["provisions"], products: [{ id: 1, name: "  rICE ", default_price: 0 }] });
  assert.equal(button(view.tree, "Rice"), undefined, "Rice is not a tickable row");
  const added = addedRows(view.tree);
  assert.equal(added.length, 1);
  assert.equal(added[0].type, "div", "not a control");
  assert.equal(added[0].props.onClick, undefined);
  assert.deepEqual(added[0].props.children.map(text), ["Rice", "Added"]);
});

test("36 from 39: no duplicates can be added; Add returns to 39", async () => {
  await db.products.add({ name: "Rice", category: "Provisions shop", default_price: 0, active: true, updatedAt: Date.now() });
  let backs = 0;
  const products = await db.products.toArray();
  const view = await browse({ setupCategories: ["provisions", "bakery"], products, onBack: () => { backs += 1; } });
  button(view.tree, "Sugar").props.onClick();
  view.rerender();
  // Bread is in Provisions and in Bakery: ticked under one chip, it is the same tick under the other.
  button(view.tree, "Bread").props.onClick();
  view.rerender();
  button(view.tree, "Bakery and pastries").props.onClick();
  view.rerender();
  assert.equal(button(view.tree, "Bread").props["aria-pressed"], true);
  assert.ok(button(view.tree, "Add 2 items"));
  button(view.tree, "Add 2 items").props.onClick();
  await waitFor(() => backs === 1, "back to 39 after adding");
  const names = (await db.products.toArray()).map(({ name }) => name).sort();
  assert.deepEqual(names, ["Bread", "Rice", "Sugar"]);
  assert.equal(backs, 1, "back to 39");
});

// ---- setup mode unchanged ----

test("setup 36: wording unchanged and the chosen categories are passed on when setup finishes", async () => {
  const { default: ItemScreens } = await loadJsx("src/pos/ItemScreens.jsx");
  setLiveQuery(() => ({ products: [], error: "" }));
  const finished = [];
  const view = render({ type: ItemScreens, props: { route: "YourStarterList", params: { setupFlow: true, starterCategories: ["provisions"] }, onBack() {}, onCompleteSetup: async (options) => { finished.push(options); } } });
  const all = text(view.tree);
  assert.ok([...walk(view.tree)].some((node) => node.type === "h1" && text(node) === "Your starter list"));
  assert.match(all, /Untick what you don’t sell\./);
  assert.doesNotMatch(all, /Add from starter list|Tick what you want to add|Added/);
  assert.equal(chipGroups(view.tree).length, 0, "no chips in setup");
  assert.equal([...walk(view.tree)].filter((node) => node.type === "input").length, 0, "no search in setup 36");
  assert.ok(button(view.tree, `Continue · ${category("provisions").core.length} items`), "the core list is ticked, Continue · N items");
  assert.ok(button(view.tree, "Show more (63)"));
  await button(view.tree, "Skip, I’ll add items later").props.onClick();
  await settle();
  assert.deepEqual(finished, [{ starterCategories: ["provisions"] }]);
});

test("setup 52 (grouped): the chosen categories are passed on when items are added", async () => {
  const { default: ItemScreens } = await loadJsx("src/pos/ItemScreens.jsx");
  setLiveQuery(() => ({ products: [], error: "" }));
  const finished = [];
  const view = render({ type: ItemScreens, props: { route: "YourStarterListGrouped", params: { setupFlow: true, starterCategories: ["provisions", "food", "hair"] }, onBack() {}, onCompleteSetup: async (options) => { finished.push(options); } } });
  assert.match(text(view.tree), /Your starter list/);
  const continueButton = buttons(view.tree).find((node) => /^Continue · \d+ items$/.test(text(node)));
  continueButton.props.onClick();
  await waitFor(() => finished.length === 1, "setup finished");
  assert.deepEqual(finished, [{ starterCategories: ["provisions", "food", "hair"] }]);
  assert.equal(await db.products.count(), mergeStarterItems(["provisions", "food", "hair"]).core.length, "the ticked core list was added");
});
