import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadJsx, render, textOf, walk } from "./helpers/renderJsx.js";

// Cleanup batch, commit 2 (d). pos-prototype.html screen 30 shows the item lines as bare amounts
// ("Bread × 2 10.00", "Other amount 3.00"), while the total at the top and the payment lines carry
// GH₵. The screen matches that. The bare amount comes from the money formatter (formatGhsAmount),
// not from cutting the symbol out of formatGhs's text.

const sale = (items, extra = {}) => ({
  id: "t1", type: "sale", amountPesewas: 1300, total_amount: 1300, payment_method: "cash", cashReceivedPesewas: 1300, momoReceivedPesewas: 0,
  items_json: JSON.stringify(items), timestamp: Date.now(), createdAt: Date.now(), ...extra
});

async function lines(transaction) {
  const { default: SaleRecorded } = await loadJsx("src/pos/SaleRecorded.jsx");
  const view = render({ type: SaleRecorded, props: { transaction, shopName: "Shop", onDone() {}, onNewSale() {} } });
  return [...walk(view.tree)].filter((node) => node.type === "div" && /justify-between/.test(node.props?.className ?? "")).map(textOf);
}

test("30: item lines are bare amounts as in the prototype; the total and the payment line keep GH₵", async () => {
  const rowsText = await lines(sale([{ name: "Bread", quantity: 2, total_amount: 1000 }, { name: "Other amount", quantity: 1, total_amount: 300 }]));
  assert.deepEqual(rowsText, ["Bread × 210.00", "Other amount × 13.00", "CashGH₵13.00"]);
  const { default: SaleRecorded } = await loadJsx("src/pos/SaleRecorded.jsx");
  const text = textOf(render({ type: SaleRecorded, props: { transaction: sale([{ name: "Sale", quantity: 1, total_amount: 1300 }]), shopName: "Shop", onDone() {}, onNewSale() {} } }).tree);
  assert.match(text, /GH₵13\.00/, "the total");
  assert.match(text, /Sale × 113\.00/, "the 'Sale × 1' line is a bare amount");
});

test("30: a thousand or more keeps its grouping, with no symbol, on the item line", async () => {
  const rowsText = await lines(sale([{ name: "Sack of rice", quantity: 1, total_amount: 123456 }], { amountPesewas: 123456, total_amount: 123456, cashReceivedPesewas: 123456 }));
  assert.equal(rowsText[0], "Sack of rice × 11,234.56");
});

test("30: the bare amount is not made by cutting GH₵ out of text", () => {
  const source = readFileSync(new URL("../src/pos/SaleRecorded.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\.replace\(\s*["']GH₵["']/);
  assert.match(source, /formatGhsAmount\(item\.amountPesewas\)/);
  assert.match(source, /formatGhsAmount\(details\.amountPesewas\)/);
});
