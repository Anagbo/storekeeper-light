import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProductInput, STARTER_ITEMS } from "../src/db/products.js";

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
  assert.deepEqual(STARTER_ITEMS, ["Bread", "Water", "Sugar", "Rice", "Cooking oil", "Soap", "Biscuits"]);
  assert.equal(new Set(STARTER_ITEMS.map((name) => name.toLowerCase())).size, STARTER_ITEMS.length);
});
