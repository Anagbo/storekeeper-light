import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSaleItems, totalSaleItemsPesewas } from "../src/lib/saleItems.js";

test("item sale totals reconcile quantity and unit price in whole pesewas", () => {
  const items = normalizeSaleItems([
    { productId: 1, name: "Bread", quantity: 2, unitPricePesewas: 500 },
    { productId: 2, name: "Water", quantity: 1, unitPricePesewas: 300 }
  ]);

  assert.deepEqual(items.map(({ total_amount }) => total_amount), [1000, 300]);
  assert.equal(totalSaleItemsPesewas(items), 1300);
});

test("carried Sell amount is a valid line without a product id", () => {
  const items = normalizeSaleItems([{
    productId: null,
    name: "Other amount",
    subtitle: "From Sell",
    quantity: 1,
    unitPricePesewas: 500
  }]);

  assert.deepEqual(items[0], {
    productId: null,
    name: "Other amount",
    subtitle: "From Sell",
    quantity: 1,
    unitPricePesewas: 500,
    total_amount: 500
  });
  assert.equal(totalSaleItemsPesewas(items), 500);
  assert.throws(() => normalizeSaleItems([{
    productId: null,
    name: "Other amount",
    subtitle: "Wrong source",
    quantity: 1,
    unitPricePesewas: 500
  }]), TypeError);
});

test("item sale validation rejects invalid quantities, prices and overflowing totals", () => {
  assert.throws(() => normalizeSaleItems([{ productId: 1, name: "Bread", quantity: 0, unitPricePesewas: 100 }]), TypeError);
  assert.throws(() => normalizeSaleItems([{ productId: 1, name: "Bread", quantity: 1, unitPricePesewas: 0 }]), TypeError);
  assert.throws(() => normalizeSaleItems([{ productId: 1, name: "Bread", quantity: Number.MAX_SAFE_INTEGER, unitPricePesewas: 2 }]), RangeError);
  assert.throws(() => totalSaleItemsPesewas([
    { productId: 1, name: "Bread", quantity: 1, unitPricePesewas: Number.MAX_SAFE_INTEGER },
    { productId: 2, name: "Water", quantity: 1, unitPricePesewas: 1 }
  ]), RangeError);
});
