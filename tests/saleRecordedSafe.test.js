import assert from "node:assert/strict";
import { test } from "node:test";
import { findButton, loadJsx, render, textOf } from "./helpers/renderJsx.js";

// 30 is shown after the sale is saved. If its receipt details cannot be built from the record,
// the owner still sees that the sale was saved and can leave with Done, never the error screen.
// The problem is not hidden: a console warning names the sale.

const GOOD = {
  id: "sale-1", amountPesewas: 800, payment_method: "cash", cashReceivedPesewas: 800, momoReceivedPesewas: 0,
  timestamp: Date.now(), items_json: "[]"
};

const BROKEN = {
  "an unknown payment method": { ...GOOD, payment_method: "credit" },
  "parts that do not add up": { ...GOOD, cashReceivedPesewas: 500 },
  "item lines that do not match the total": { ...GOOD, items_json: JSON.stringify([{ name: "Rice", quantity: 1, total_amount: 300 }]) },
  "items that are not JSON": { ...GOOD, items_json: "{oops" },
  "no time": { ...GOOD, timestamp: undefined, createdAt: undefined }
};

async function show(transaction) {
  const { default: SaleRecorded } = await loadJsx("src/pos/SaleRecorded.jsx");
  const done = [];
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    const view = render({ type: SaleRecorded, props: { transaction, shopName: "Shop", onDone: () => done.push(true), onNewSale() {} } });
    return { view, text: textOf(view.tree), done, warnings };
  } finally {
    console.warn = original;
  }
}

for (const [name, transaction] of Object.entries(BROKEN)) {
  test(`30 with ${name}: "Sale saved." and Done, a warning with the sale id, no error`, async () => {
    const { view, text, done, warnings } = await show(transaction);
    assert.match(text, /^Sale saved\.Done$/);
    findButton(view.tree, "Done").props.onClick();
    assert.equal(done.length, 1, "Done goes where 30's Done goes");
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0][0]), /sale-1/);
    assert.ok(warnings[0].some((arg) => arg instanceof Error), "the validation error is logged");
  });
}

test("30 with a good sale shows the receipt and warns about nothing", async () => {
  const { text, warnings } = await show(GOOD);
  assert.match(text, /Sale recorded/);
  assert.match(text, /CashGH₵8\.00/);
  assert.equal(warnings.length, 0);
});