import test from "node:test";
import assert from "node:assert/strict";
import { cleanItemName } from "../src/lib/itemName.js";
import { normalizeProductInput } from "../src/db/products.js";
import { normalizeSaleItems } from "../src/lib/saleItems.js";

test("a lowercase first word gets a capital; other names stay as typed", () => {
  assert.equal(cleanItemName("coffee"), "Coffee");
  assert.equal(cleanItemName("  red bag "), "Red bag");
  assert.equal(cleanItemName("iPhone case"), "iPhone case");
  assert.equal(cleanItemName("Fanta 500ml"), "Fanta 500ml");
  assert.equal(cleanItemName("500ml fanta"), "500ml fanta");
  assert.equal(cleanItemName("USB cable"), "USB cable");
  assert.equal(cleanItemName("café au lait"), "Café au lait");
});

test("saving a product and building a sale line use it", () => {
  assert.equal(normalizeProductInput({ name: "coffee", price: "5" }).name, "Coffee");
  const [line] = normalizeSaleItems([{ productId: 1, name: "red bag", quantity: 1, unitPricePesewas: 100 }]);
  assert.equal(line.name, "Red bag");
});
