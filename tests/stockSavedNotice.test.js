import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { spentSavedNotice, stockSavedNotice } from "../src/pos/expenseNotice.js";
import { loadJsx, render, setLiveQuery, textOf } from "./helpers/renderJsx.js";

// 45: after saving stock, Home shows a calm message and never the word "Expense".

test("45 message: nothing paid now", () => {
  assert.equal(stockSavedNotice({ amountPesewas: 8000, paidAmountPesewas: 0 }), "Stock of GH₵80.00 saved. You still owe GH₵80.00.");
});

test("45 message: part paid now", () => {
  assert.equal(stockSavedNotice({ amountPesewas: 8000, paidAmountPesewas: 3000 }), "Stock of GH₵80.00 saved. You paid GH₵30.00 and still owe GH₵50.00.");
});

test("45 message: all paid now", () => {
  assert.equal(stockSavedNotice({ amountPesewas: 8000, paidAmountPesewas: 8000 }), "Stock of GH₵80.00 saved. Paid in full.");
});

test("spent money keeps \"Spent GH₵x saved.\"", () => {
  assert.equal(spentSavedNotice({ amountPesewas: 2620 }), "Spent GH₵26.20 saved.");
  for (const message of [
    spentSavedNotice({ amountPesewas: 2620 }),
    stockSavedNotice({ amountPesewas: 8000, paidAmountPesewas: 0 }),
    stockSavedNotice({ amountPesewas: 8000, paidAmountPesewas: 3000 }),
    stockSavedNotice({ amountPesewas: 8000, paidAmountPesewas: 8000 })
  ]) assert.doesNotMatch(message, /expense/i);
  const app = readFileSync(new URL("../src/pos/PosApp.jsx", import.meta.url), "utf8");
  assert.match(app.slice(app.indexOf("async function saveExpense"), app.indexOf("async function saveStockExpense")), /setNotice\(spentSavedNotice\(result\)\)/);
  assert.match(app.slice(app.indexOf("async function saveStockExpense"), app.indexOf("async function paySupplier")), /setNotice\(stockSavedNotice\(result\)\)/);
});

test("45 message is shown on Home as given (Home only shows it)", async () => {
  const { default: Home } = await loadJsx("src/pos/Home.jsx");
  setLiveQuery(() => undefined);
  const message = stockSavedNotice({ amountPesewas: 8000, paidAmountPesewas: 3000 });
  const view = render({ type: Home, props: { onNavigate() {}, notice: message } });
  assert.ok(textOf(view.tree).includes("Stock of GH₵80.00 saved. You paid GH₵30.00 and still owe GH₵50.00."));
  assert.doesNotMatch(textOf(view.tree), /Expense/);
});
