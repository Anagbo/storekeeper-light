import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProductInput } from "../src/db/products.js";

test("item prices are optional but must be positive valid GHS amounts when entered", () => {
  assert.deepEqual(normalizeProductInput({ name: "  Bread  " }), {
    name: "Bread",
    default_price: 0
  });
  assert.deepEqual(normalizeProductInput({ name: "Water", price: "3.50" }), {
    name: "Water",
    default_price: 3.5
  });
  assert.throws(() => normalizeProductInput({ name: "Water", price: "not money" }), /valid item price/);
  assert.throws(() => normalizeProductInput({ name: "Water", price: "0" }), /greater than GHS 0.00/);
});

test("item names are required and limited to 80 characters", () => {
  assert.throws(() => normalizeProductInput({ name: " " }), /item name/);
  assert.throws(() => normalizeProductInput({ name: "x".repeat(81) }), /80 characters/);
});

import {
  getMoreCategoryGroups,
  getPopularCategories,
  isSomethingElseOnly,
  mergeStarterItems,
  groupCoreItemsByCategory,
  searchStarterCategories,
  searchStarterItems,
  shouldGroupStarterList,
  STARTER_GROUP_THRESHOLD,
  STARTER_CATEGORIES,
  STARTER_ITEMS
} from "../src/db/starterItems.js";
import starterData from "../src/data/starter-items.json" with { type: "json" };

test("starter data is version 2 and loaded from the JSON file", () => {
  assert.equal(starterData.version, 2);
  assert.equal(STARTER_CATEGORIES.length, starterData.categories.length + 1);
  assert.equal(new Set(STARTER_ITEMS.map((name) => name.toLowerCase())).size, STARTER_ITEMS.length);
});

test("popular categories come first and the rest are grouped by the group field", () => {
  assert.deepEqual(getPopularCategories().map(({ id }) => id), starterData.categories.filter(({ popular }) => popular).map(({ id }) => id));
  const groups = getMoreCategoryGroups();
  assert.ok(groups.length > 1);
  const grouped = groups.flatMap(({ categories }) => categories);
  assert.ok(grouped.every(({ popular }) => !popular));
  assert.equal(grouped.length + getPopularCategories().length, starterData.categories.length);
  for (const { group, categories } of groups) assert.ok(categories.every((category) => category.group === group));
});

test("merging categories removes case-insensitive duplicates and core wins over more", () => {
  const ids = starterData.categories.map(({ id }) => id);
  const { core, more } = mergeStarterItems(ids);
  const names = [...core, ...more].map(({ name }) => name.toLowerCase());
  assert.equal(new Set(names).size, names.length);
  const coreNames = new Set(core.map(({ name }) => name.toLowerCase()));
  assert.ok(more.every(({ name }) => !coreNames.has(name.toLowerCase())));
  const coreAnywhere = new Set(starterData.categories.flatMap(({ core: items }) => items.map((name) => name.toLowerCase())));
  for (const name of coreAnywhere) assert.ok(coreNames.has(name), name + " should be core");
});

test("an item that is core in one category and more in another is core when both are picked", () => {
  const coreOf = (id) => new Set(starterData.categories.find((category) => category.id === id).core.map((name) => name.toLowerCase()));
  const moreOf = (id) => starterData.categories.find((category) => category.id === id).more.map((name) => name.toLowerCase());
  const ids = starterData.categories.map(({ id }) => id);
  let found;
  for (const a of ids) for (const b of ids) {
    if (a === b) continue;
    const name = moreOf(a).find((item) => coreOf(b).has(item));
    if (name) found = { a, b, name };
  }
  assert.ok(found, "fixture should contain a core/more overlap");
  const alone = mergeStarterItems([found.a]);
  assert.ok(alone.more.some(({ name }) => name.toLowerCase() === found.name));
  const both = mergeStarterItems([found.a, found.b]);
  assert.ok(both.core.some(({ name }) => name.toLowerCase() === found.name));
  assert.ok(!both.more.some(({ name }) => name.toLowerCase() === found.name));
});

test("core items and more items are separated per the file rule", () => {
  const { core, more } = mergeStarterItems(["provisions"]);
  const provisions = starterData.categories.find(({ id }) => id === "provisions");
  assert.deepEqual(core.map(({ name }) => name), provisions.core);
  assert.deepEqual(more.map(({ name }) => name), provisions.more);
  assert.ok(core.every(({ category }) => category === "Provisions shop"));
});

test("Something else has no items and is detected when it is the only category", () => {
  assert.deepEqual(mergeStarterItems(["other"]), { core: [], more: [] });
  assert.equal(isSomethingElseOnly(["other"]), true);
  assert.equal(isSomethingElseOnly(["other", "provisions"]), false);
  assert.equal(isSomethingElseOnly([]), false);
  assert.deepEqual(mergeStarterItems(["other", "clothes"]).core.map(({ name }) => name), starterData.categories.find(({ id }) => id === "clothes").core);
});

test("search covers every starter item, core and more", () => {
  const all = searchStarterItems("");
  assert.equal(all.length, STARTER_ITEMS.length);
  const moreOnly = starterData.categories[0].more[0];
  assert.ok(searchStarterItems(moreOnly.toUpperCase()).some(({ name }) => name === moreOnly));
  assert.deepEqual(searchStarterItems("zzzz-not-an-item"), []);
});

test("several categories group at screen 52 only when the combined core list is over the threshold", () => {
  assert.equal(STARTER_GROUP_THRESHOLD, 30);
  assert.equal(shouldGroupStarterList(["provisions"]), false);
  assert.equal(shouldGroupStarterList(["provisions", "food"]), false);
  assert.equal(shouldGroupStarterList(["provisions", "food", "hair"]), true);
  assert.equal(shouldGroupStarterList(["provisions", "other"]), false);
  assert.equal(shouldGroupStarterList(["other"]), false);
});

test("grouped core list has one group per category and no duplicate items", () => {
  const ids = ["provisions", "food", "hair"];
  const groups = groupCoreItemsByCategory(ids);
  assert.deepEqual(groups.map(({ category }) => category), ["Provisions shop", "Food and drinks", "Hair and beauty"]);
  const names = groups.flatMap(({ items }) => items.map(({ name }) => name.toLowerCase()));
  assert.equal(new Set(names).size, names.length);
  assert.equal(names.length, mergeStarterItems(ids).core.length);
});

test("category search finds categories by name, including hardware splits", () => {
  assert.deepEqual(searchStarterCategories("PLUMB").map(({ id }) => id), ["plumbing"]);
  assert.deepEqual(searchStarterCategories("zzz"), []);
  assert.deepEqual(searchStarterCategories(""), []);
  const ids = starterData.categories.map(({ id }) => id);
  for (const id of ["building", "plumbing", "paint", "tools"]) assert.ok(ids.includes(id));
  assert.equal(starterData.categories.find(({ id }) => id === "electricals").group, "Phones and electronics");
});
