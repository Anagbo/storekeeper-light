import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { db } from "../src/db/db.js";
import { createProduct } from "../src/db/products.js";
import { recordCashSale } from "../src/db/sales.js";
import { recordCreditSale } from "../src/db/debts.js";
import { getFinancialTransactions, summarizeFinancialTransactionsSafely } from "../src/lib/money.js";
import { getMoneyPeriodRange } from "../src/pos/money.js";
import { buildSaleReceiptMessage } from "../src/pos/saleReceipt.js";
import { getSaleReceiptText } from "../src/pos/receiptTemplates.js";
import { describeLastSale, loadLastSaleToday } from "../src/pos/lastSale.js";
import { createPosTransactionRows, describeTransactionRow } from "../src/pos/transactionFeed.js";
import { flushEffects, loadJsx, render, setLiveQuery, textOf } from "./helpers/renderJsx.js";

// Wiring COST IS PRIVATE (24 Nov 2026): the cost saved on a sale line never appears on Sell, receipts,
// the WhatsApp receipt or any customer-facing text. The cost here is GH₵70.00 (7000 pesewas) on an item
// sold for GH₵95.00, so no other figure of the sale can contain it.
const COST = /70\.00|7,?000|\b70\b/;
const SHOP = "Ama’s Shop";
let cashSale;
let creditSale;

before(async () => {
  await db.open();
  const milo = await createProduct({ name: "Milo", pricePesewas: 9500, costPricePesewas: 7000 });
  const line = { productId: milo.id, name: "Milo", quantity: 1, unitPricePesewas: 9500 };
  cashSale = await recordCashSale({ amountPesewas: 9500, saleItems: [line] });
  const credit = await recordCreditSale({ amountPesewas: 9500, name: "Kofi", initialPaymentPesewas: 1500, saleItems: [line] });
  creditSale = await db.transactions.get(credit.transactionId);
});

after(async () => {
  db.close();
  await db.delete();
});

test("the saved sales do hold the cost snapshot (so the checks below are meaningful)", () => {
  for (const sale of [cashSale, creditSale]) {
    assert.equal(JSON.parse(sale.items_json)[0].cost_at_sale_pesewas, 7000);
  }
});

test("receipt text and the WhatsApp receipt text never show the cost", () => {
  for (const sale of [cashSale, creditSale]) {
    for (const text of [
      buildSaleReceiptMessage(sale, SHOP),
      getSaleReceiptText(sale, SHOP, {}, true),
      getSaleReceiptText(sale, SHOP, {}, false)
    ]) {
      assert.match(text, /95\.00/, "the receipt shows the price");
      assert.doesNotMatch(text, COST, `no cost in: ${text}`);
    }
  }
});

test("the receipt screen (30) never shows the cost", async () => {
  globalThis.window ??= { addEventListener() {}, removeEventListener() {} };
  const { default: SaleRecorded } = await loadJsx("src/pos/SaleRecorded.jsx");
  const text = textOf(render({ type: SaleRecorded, props: { transaction: cashSale, shopName: SHOP, onDone() {}, onNewSale() {} } }).tree);
  assert.match(text, /95\.00/);
  assert.doesNotMatch(text, COST);
});

test("the Sell cart never shows the cost, even when a line carries a snapshot", async () => {
  const { SaleLines, getCart } = await loadJsx("src/pos/SellItemsParts.jsx");
  const cart = getCart({ saleItems: JSON.parse(cashSale.items_json) });
  const text = textOf(render({ type: SaleLines, props: { cart, onUpdateCart() {}, onQuantity() {} } }).tree);
  assert.match(text, /Milo/);
  assert.doesNotMatch(text, COST);
});

test("the Last sale box never shows the cost", async () => {
  globalThis.window ??= { addEventListener() {}, removeEventListener() {} };
  const found = await loadLastSaleToday(db);
  assert.doesNotMatch(JSON.stringify(found), COST);
  assert.doesNotMatch(JSON.stringify(describeLastSale(cashSale)), COST);
  const { default: LastSaleBox } = await loadJsx("src/pos/LastSaleBox.jsx");
  const view = render({ type: LastSaleBox, props: { load: async () => found } });
  flushEffects(view);
  await new Promise((resolve) => setTimeout(resolve, 10));
  view.rerender();
  const text = textOf(view.tree);
  assert.match(text, /Last sale/);
  assert.doesNotMatch(text, COST);
});

test("Today’s transactions never show the cost", async () => {
  const transactions = await getFinancialTransactions(getMoneyPeriodRange("day"));
  const rows = createPosTransactionRows(transactions, new Map());
  assert.ok(rows.length >= 2);
  for (const row of rows) assert.doesNotMatch(JSON.stringify(describeTransactionRow(row)), COST);
  const { default: TodaysTransactions } = await loadJsx("src/pos/TodaysTransactions.jsx");
  setLiveQuery(() => ({ status: "ready", transactions: rows, totals: summarizeFinancialTransactionsSafely(transactions).totals }));
  try {
    const text = textOf(render({ type: TodaysTransactions, props: { onBack() {} } }).tree);
    assert.match(text, /95\.00/);
    assert.doesNotMatch(text, COST);
  } finally {
    setLiveQuery(null);
  }
});
