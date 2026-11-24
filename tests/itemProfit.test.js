import assert from "node:assert/strict";
import test from "node:test";
import { getItemProfit } from "../src/lib/itemProfit.js";

const sale = (id, lines, extra = {}) => ({ id, type: "sale", amountPesewas: 1, items_json: JSON.stringify(lines), ...extra });
const line = (productId, unitPricePesewas, quantity, cost) => ({
  productId, name: `Item ${productId}`, quantity, unitPricePesewas, total_amount: unitPricePesewas * quantity,
  ...(cost !== undefined && { cost_at_sale_pesewas: cost })
});
const other = { productId: null, name: "Other amount", subtitle: "From Sell", quantity: 1, unitPricePesewas: 500, total_amount: 500, cost_at_sale_pesewas: null };

test("known costs: (price - cost) x quantity, every line counted", () => {
  assert.deepEqual(getItemProfit([sale("a", [line(1, 1000, 3, 700), line(2, 500, 1, 200)])]), {
    profitPesewas: 1200, countedLines: 2, totalLines: 2
  });
});

test("unknown cost (null or missing) is never treated as zero", () => {
  assert.deepEqual(getItemProfit([sale("a", [line(1, 1000, 1, null), line(2, 1000, 1)])]), {
    profitPesewas: 0, countedLines: 0, totalLines: 2
  });
});

test("a cost of 0 is a real cost: the whole price is profit and the line counts", () => {
  assert.deepEqual(getItemProfit([sale("a", [line(1, 800, 2, 0)])]), { profitPesewas: 1600, countedLines: 1, totalLines: 1 });
});

test("a keypad-only sale (no lines) is one uncounted item", () => {
  assert.deepEqual(getItemProfit([sale("a", []), { id: "b", type: "sale", amountPesewas: 300 }]), {
    profitPesewas: 0, countedLines: 0, totalLines: 2
  });
});

test("an Other amount line is not counted", () => {
  assert.deepEqual(getItemProfit([sale("a", [other, line(1, 1000, 1, 600)])]), { profitPesewas: 400, countedLines: 1, totalLines: 2 });
});

test("mixed: quantity is not used for the count; non-sales and reversed sales are left out", () => {
  const result = getItemProfit([
    sale("a", [line(1, 1000, 5, 700), line(2, 300, 4)]),
    sale("b", [other]),
    sale("c", [], { type: "installment_sale" }),
    sale("gone", [line(1, 1000, 1, 100)]),
    { id: "r", type: "income_reversal", reversalOfTransactionId: "gone" },
    { id: "e", type: "expense", amountPesewas: 900 }
  ]);
  assert.deepEqual(result, { profitPesewas: 1500, countedLines: 1, totalLines: 4 });
});

test("selling below cost gives a negative profit, still counted", () => {
  assert.deepEqual(getItemProfit([sale("a", [line(1, 500, 2, 700)])]), { profitPesewas: -400, countedLines: 1, totalLines: 1 });
});
