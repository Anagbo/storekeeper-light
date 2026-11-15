import assert from "node:assert/strict";
import { test } from "node:test";
import { loadJsx, render, textOf } from "./helpers/renderJsx.js";

// Wiring 30 "Receipts offline": the Sale line and every amount in the panel use formatGhs (GH₵5.00).

const base = { id: "sale-1", amountPesewas: 500, payment_method: "cash", cashReceivedPesewas: 500, momoReceivedPesewas: 0, timestamp: Date.now() };

async function show(transaction) {
  const { default: SaleRecorded } = await loadJsx("src/pos/SaleRecorded.jsx", { VITE_ENABLE_POS_RECEIPTS: "true" });
  return textOf(render({ type: SaleRecorded, props: { transaction, shopName: "Shop", onDone() {}, onNewSale() {} } }).tree);
}

test("30 the Sale line reads GH₵5.00, not 5.00", async () => {
  const text = await show({ ...base, items_json: "[]" });
  assert.match(text, /SaleGH₵5\.00/);
  assert.doesNotMatch(text, /Sale5\.00/);
});

test("30 item rows read GH₵ too", async () => {
  const text = await show({ ...base, amountPesewas: 750, cashReceivedPesewas: 750, items_json: JSON.stringify([{ name: "Rice", quantity: 3, total_amount: 750 }]) });
  assert.match(text, /Rice × 3GH₵7\.50/);
});

test("30 no amount on the screen is a bare number", async () => {
  const text = await show({ ...base, items_json: "[]" });
  assert.doesNotMatch(text.replace(/GH₵\d[\d,]*\.\d\d/g, ""), /\d+\.\d\d/);
});
