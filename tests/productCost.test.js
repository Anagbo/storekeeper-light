import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { createProduct, normalizeProductInput, updateProduct } from "../src/db/products.js";

// Wiring 40/41 COST PRICE: cost_price_pesewas is integer pesewas or null; blank is null, never zero.

beforeEach(async () => {
  db.close();
  await db.delete();
  await db.open();
});

after(async () => {
  db.close();
  await db.delete();
});

test("blank cost is null, never zero; 0 is a real cost", () => {
  assert.equal(normalizeProductInput({ name: "Bread", price: "10", cost: "" }).cost_price_pesewas, null);
  assert.equal(normalizeProductInput({ name: "Bread", price: "10", cost: "   " }).cost_price_pesewas, null);
  assert.equal(normalizeProductInput({ name: "Bread", price: "10", cost: "0" }).cost_price_pesewas, 0);
  assert.equal(normalizeProductInput({ name: "Bread", price: "10", cost: "7.50" }).cost_price_pesewas, 750);
  assert.equal(normalizeProductInput({ name: "Bread", price: "10", costPricePesewas: 0 }).cost_price_pesewas, 0);
  assert.throws(() => normalizeProductInput({ name: "Bread", price: "10", cost: "abc" }), /what you paid/);
  assert.throws(() => normalizeProductInput({ name: "Bread", price: "10", costPricePesewas: -1 }), /what you paid/);
});

test("an absent cost leaves the key out, so the saved cost is kept", () => {
  const details = normalizeProductInput({ name: "Bread", price: "10" });
  assert.equal(Object.hasOwn(details, "cost_price_pesewas"), false);
});

test("updateProduct: absent keeps the cost, explicit null clears it", async () => {
  const product = await createProduct({ name: "Bread", price: "10", cost: "7" });
  assert.equal(product.cost_price_pesewas, 700);

  const kept = await updateProduct(product.id, { name: "Bread", price: "12" });
  assert.equal(kept.cost_price_pesewas, 700);
  assert.equal(kept.default_price, 12);

  const zero = await updateProduct(product.id, { name: "Bread", price: "12", cost: "0" });
  assert.equal(zero.cost_price_pesewas, 0);

  const cleared = await updateProduct(product.id, { name: "Bread", price: "12", cost: "" });
  assert.equal(cleared.cost_price_pesewas, null);

  await updateProduct(product.id, { name: "Bread", price: "12", cost: "7" });
  const clearedByNull = await updateProduct(product.id, { name: "Bread", price: "12", costPricePesewas: null });
  assert.equal(clearedByNull.cost_price_pesewas, null);
});

test("the Set price path (37) sends only name and price and never wipes a cost", async () => {
  const product = await createProduct({ name: "Milo", price: "20", cost: "15" });
  // The exact call SetupScreens makes on 37.
  const updated = await updateProduct(product.id, { name: product.name, pricePesewas: 2500 });
  assert.equal(updated.default_price, 25);
  assert.equal(updated.cost_price_pesewas, 1500);
});

test("a new item without a cost field stores no cost (reads as unknown)", async () => {
  const product = await createProduct({ name: "Sugar", price: "5" });
  assert.equal(product.cost_price_pesewas ?? null, null);
});
