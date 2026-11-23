import assert from "node:assert/strict";
import { test } from "node:test";
import { backRoute, createRouteState, getSplitPaymentParams, navigateState, POS_ROUTES } from "../src/pos/routes.js";

// Wide D9 (23 Nov 2026): 20 and 55 are one screen on the 20 route, so Split payment (16) and Owe (17)
// open from 20. Back to 20 keeps 16's parts (as from 15 and 55) and hands the reason typed on 18 back
// to 20 (as to 15 and 55). Phone 55 > Back > 20 is unchanged.

const ITEMS = [{ productId: 1, name: "Rice", unitPricePesewas: 800, quantity: 1 }];

function on20() {
  const sell = navigateState(createRouteState(POS_ROUTES.Home), POS_ROUTES.Sell, {});
  return navigateState(sell, POS_ROUTES.SellWithItems, { amountPesewas: 800, saleItems: ITEMS });
}

test("20 > 16 > Back: 20 keeps the split parts, and Split payment reopens them while the total is unchanged", () => {
  const split = navigateState(on20(), POS_ROUTES.SplitPayment, { amountPesewas: 800, saleItems: ITEMS });
  const typed = { ...split, params: { ...split.params, splitParts: [{ paymentMethod: "cash", amountPesewas: 300 }] } };
  const back = backRoute(typed);
  assert.equal(back.current, POS_ROUTES.SellWithItems);
  assert.deepEqual(back.params.splitDraft.splitParts, [{ paymentMethod: "cash", amountPesewas: 300 }]);
  const reopened = getSplitPaymentParams(back.params, 800, ITEMS);
  assert.deepEqual(reopened.splitParts, [{ paymentMethod: "cash", amountPesewas: 300 }]);
  assert.equal(getSplitPaymentParams(back.params, 900, ITEMS).splitParts, undefined, "a changed total starts again");
});

test("20 > 17 > 18 (reason typed) > Back > Back: the reason is back on 20 and goes with the next Owe", () => {
  const who = navigateState(on20(), POS_ROUTES.WhoOwesYou, { amountPesewas: 800, saleItems: ITEMS });
  const when = navigateState(who, POS_ROUTES.WhenWillTheyPay, { amountPesewas: 800, saleItems: ITEMS, customer: { name: "Ama" } });
  const typed = { ...when, params: { ...when.params, creditReason: "School fees" } };
  const back17 = backRoute(typed);
  assert.equal(back17.params.creditReason, "School fees");
  const back20 = backRoute(back17);
  assert.equal(back20.current, POS_ROUTES.SellWithItems);
  assert.equal(back20.params.creditReason, "School fees");
});

test("phone 55 > Back > 20 is unchanged: no reason and no split draft land on 20", () => {
  const review = navigateState(on20(), POS_ROUTES.ReviewAndPay, { amountPesewas: 800, saleItems: ITEMS });
  const withReason = { ...review, params: { ...review.params, creditReason: "School fees" } };
  const back = backRoute(withReason);
  assert.equal(back.current, POS_ROUTES.SellWithItems);
  assert.equal(back.params.creditReason, undefined);
  assert.equal(back.params.splitDraft, undefined);
});
