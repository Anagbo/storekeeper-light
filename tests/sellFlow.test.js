import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCashSale } from "../src/db/sales.js";
import { pushRoute, POS_ROUTES, createRouteState, backRoute } from "../src/pos/routes.js";

const sourcePaths = {
  sell: new URL("../src/pos/Sell.jsx", import.meta.url),
  cart: new URL("../src/pos/SellWithItems.jsx", import.meta.url),
  review: new URL("../src/pos/ReviewAndPay.jsx", import.meta.url)
};

before(async () => {
  await db.open();
});

beforeEach(async () => {
  await db.transactions.clear();
});

after(async () => {
  db.close();
  await db.delete();
});

test("sell-flow screens 15, 20 and 55 expose the required contracts", async () => {
  const [sell, cartScreen, reviewScreen, cartParts, reviewSave] = await Promise.all([
    ...Object.values(sourcePaths),
    // 20's cart and 55's save live in shared parts since the wide D9 screen (23 Nov 2026).
    new URL("../src/pos/SellItemsParts.jsx", import.meta.url),
    new URL("../src/pos/useItemsSaleSave.js", import.meta.url)
  ].map((url) => readFile(url, "utf8")));
  const cart = cartScreen + cartParts;
  const review = reviewScreen + reviewSave;

  assert.match(sell, /onNavigate\("SaleRecorded"/);
  assert.match(sell, /onNavigate\("SellWithItems"/);
  assert.match(sell, /disabled=\{!canSave \|\| busy\}/);
  assert.match(sell, /if \(!canSave \|\| busy\) return/);
  assert.match(sell, /disabled=\{value === "credit" && \(!canSave \|\| busy\)\}/);
  assert.match(cart, /name: "Other amount"/);
  assert.match(cart, /subtitle: "From Sell"/);
  assert.match(cart, /return normalizeSaleItems\(\[\{/);
  assert.match(cart, /onNavigate\("ReviewAndPay"/);
  assert.match(cart, /disabled=\{!cart\.length/);
  assert.match(review, /t\("review\.title"\)/);
  assert.match(review, /t\("review\.howPaid"\)/);
  assert.match(review, /onNavigate\("SplitPayment"/);
  assert.match(review, /onNavigate\("WhoOwesYou"/);
  assert.match(review, /onSaveSale/);
});

test("journey C carries the typed amount through the cart and review into screen 30", async () => {
  const otherAmount = {
    productId: null,
    name: "Other amount",
    subtitle: "From Sell",
    quantity: 1,
    unitPricePesewas: 500,
    total_amount: 500
  };
  const bread = {
    productId: 1,
    name: "Bread",
    quantity: 2,
    unitPricePesewas: 400,
    total_amount: 800
  };
  const sell = createRouteState(POS_ROUTES.Sell, { amountPesewas: 500, saleItems: [] });
  const cart = pushRoute(sell, POS_ROUTES.SellWithItems, { amountPesewas: 500, saleItems: [otherAmount] });
  const review = pushRoute(cart, POS_ROUTES.ReviewAndPay, {
    amountPesewas: 1300,
    saleItems: [otherAmount, bread]
  });

  assert.equal(review.current, POS_ROUTES.ReviewAndPay);
  assert.equal(review.params.saleItems[0].name, "Other amount");
  assert.equal(backRoute(review).current, POS_ROUTES.SellWithItems);
  assert.deepEqual(backRoute(review).params.saleItems, [otherAmount]);

  const transaction = await recordCashSale({
    amountPesewas: 1300,
    cashReceivedPesewas: 1300,
    momoReceivedPesewas: 0,
    saleItems: review.params.saleItems,
    now: 123
  });
  assert.equal(transaction.payment_method, "cash");
  assert.deepEqual(JSON.parse(transaction.items_json), [otherAmount, bread]);
});

test("a sale without items completes directly from screen 15", async () => {
  const transaction = await recordCashSale({
    amountPesewas: 500,
    cashReceivedPesewas: 500,
    momoReceivedPesewas: 0,
    saleItems: [],
    now: 456
  });

  assert.equal(transaction.amountPesewas, 500);
  assert.deepEqual(JSON.parse(transaction.items_json), []);
  assert.equal(await db.transactions.count(), 1);
});
