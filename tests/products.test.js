import assert from "node:assert/strict";
import test from "node:test";
import {
  getStarterItemsForCategories,
  normalizeProductInput,
  STARTER_CATEGORIES,
  STARTER_ITEMS
} from "../src/db/products.js";

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

test("starter item names are unique and suitable for bulk selection", () => {
  assert.deepEqual(STARTER_ITEMS.slice(0, 7), ["Bread", "Water", "Sugar", "Rice", "Cooking oil", "Soap", "Biscuits"]);
  assert.equal(new Set(STARTER_ITEMS.map((name) => name.toLowerCase())).size, STARTER_ITEMS.length);
});

test("starter categories provide the seven setup choices and category-specific items", () => {
  assert.deepEqual(STARTER_CATEGORIES.map(({ name }) => name), [
    "Provisions shop",
    "Food and drinks",
    "Hair and beauty",
    "Clothes",
    "Phone and airtime",
    "Repairs",
    "Something else"
  ]);
  assert.deepEqual(getStarterItemsForCategories(["phone-airtime"]), [
    { name: "Airtime", category: "Phone and airtime" },
    { name: "Phone case", category: "Phone and airtime" },
    { name: "Phone charger", category: "Phone and airtime" },
    { name: "Earphones", category: "Phone and airtime" }
  ]);
  assert.equal(getStarterItemsForCategories(["provisions", "food-drinks"])
    .filter(({ name }) => name === "Rice").length, 1);
});
