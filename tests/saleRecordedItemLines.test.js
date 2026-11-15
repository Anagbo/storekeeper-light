import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadJsx, render, textOf, walk } from "./helpers/renderJsx.js";

// Screen 30 shows every amount with GH₵: the total, the item lines, the Sale line and the payment lines.
// (Earlier the item lines were bare amounts as in pos-prototype.html; that was replaced by the 14 Nov 2026
// decision, so each amount goes through formatGhs.)

const sale = (items, extra = {}) => ({
  id: "t1", type: "sale", amountPesewas: 1300, total_amount: 1300, payment_method: "cash", cashReceivedPesewas: 1300, momoReceivedPesewas: 0,
  items_json: JSON.stringify(items), timestamp: Date.now(), createdAt: Date.now(), ...extra
});

async function lines(transaction) {
  const { default: SaleRecorded } = await loadJsx("src/pos/SaleRecorded.jsx");
  const view = render({ type: SaleRecorded, props: { transaction, shopName: "Shop", onDone() {}, onNewSale() {} } });
  return [...walk(view.tree)].filter((node) => node.type === "div" && /justify-between/.test(node.props?.className ?? "")).map(textOf);
}

test("30: item lines carry GH₵ like every other amount", async () => {
  const rowsText = await lines(sale([{ name: "Bread", quantity: 2, total_amount: 1000 }, { name: "Other amount", quantity: 1, total_amount: 300 }]));
  assert.deepEqual(rowsText, ["Bread × 2GH₵10.00", "Other amount × 1GH₵3.00", "CashGH₵13.00"]);
  const { default: SaleRecorded } = await loadJsx("src/pos/SaleRecorded.jsx");
  const text = textOf(render({ type: SaleRecorded, props: { transaction: sale([{ name: "Sale", quantity: 1, total_amount: 1300 }]), shopName: "Shop", onDone() {}, onNewSale() {} } }).tree);
  assert.match(text, /GH₵13\.00/, "the total");
  assert.match(text, /Sale × 1GH₵13\.00/, "the 'Sale × 1' line carries GH₵");
});

test("30: a thousand or more keeps its grouping, with GH₵, on the item line", async () => {
  const rowsText = await lines(sale([{ name: "Sack of rice", quantity: 1, total_amount: 123456 }], { amountPesewas: 123456, total_amount: 123456, cashReceivedPesewas: 123456 }));
  assert.equal(rowsText[0], "Sack of rice × 1GH₵1,234.56");
});

test("30: no amount is made by cutting GH₵ out of text, and none uses the bare formatter", () => {
  const source = readFileSync(new URL("../src/pos/SaleRecorded.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\.replace\(\s*["']GH₵["']/);
  assert.match(source, /formatGhs\(item\.amountPesewas\)/);
  assert.doesNotMatch(source, /formatGhsAmount/);
  assert.match(source, /t\("saleRecorded\.sale"\)[\s\S]{0,120}formatGhs\(details\.amountPesewas\)/);
});
