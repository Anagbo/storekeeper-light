import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as routes from "../src/pos/routes.js";

const read = (file) => readFileSync(new URL(`../src/pos/${file}`, import.meta.url), "utf8");
const creditSource = read("CreditScreens.jsx");
const installmentSource = read("InstallmentSplitPayment.jsx");
const appSource = read("PosApp.jsx");
const momoSource = read("MoMoScreens.jsx");
const entry = (current, params = {}) => ({ current, params });
const slice = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `${start} not found`);
  return source.slice(from, to);
};

test("K4: popToRoute returns to the existing 16 and drops 17/18 from history, so Back reaches 15", () => {
  assert.equal(typeof routes.popToRoute, "function");
  const state = {
    current: "WhenWillTheyPay",
    params: { flow: "split" },
    history: [entry("Sell"), entry("SplitPayment", { amountPesewas: 1000 }), entry("WhoOwesYou"), entry("NewPerson")]
  };
  const next = routes.popToRoute(state, "SplitPayment", { splitParts: [{ paymentMethod: "owe", amountPesewas: 1000 }] }, routes.isSaleSplitHub);
  assert.equal(next.current, "SplitPayment");
  assert.deepEqual(next.params, { amountPesewas: 1000, splitParts: [{ paymentMethod: "owe", amountPesewas: 1000 }] });
  assert.deepEqual(next.history, [entry("Sell")]);
  assert.equal(routes.backRoute(next).current, "Sell");
});

test("K4: the sale hub match skips 27 (installmentSplit) and collection splits (debtId); no match returns null", () => {
  const state = { current: "ALittleAtATime", params: {}, history: [entry("SplitPayment", { installmentSplit: true }), entry("SplitPayment", { debtId: "d1" })] };
  assert.equal(routes.popToRoute(state, "SplitPayment", {}, routes.isSaleSplitHub), null);
});

test("E3: returning from 27 to 19 pops back to the existing 19 instead of stacking another", () => {
  const state = {
    current: "SplitPayment",
    params: { installmentSplit: true },
    history: [entry("Sell"), entry("WhoOwesYou"), entry("WhenWillTheyPay"), entry("ALittleAtATime", { frequency: "weekly" })]
  };
  const next = routes.popToRoute(state, "ALittleAtATime", { paymentMethod: "split" });
  assert.equal(next.current, "ALittleAtATime");
  assert.deepEqual(next.params, { frequency: "weekly", paymentMethod: "split" });
  assert.deepEqual(next.history.map((item) => item.current), ["Sell", "WhoOwesYou", "WhenWillTheyPay"]);
});

test("K9/K10: Cancel request and Pay another way return to the screen that opened MoMo", () => {
  assert.equal(typeof routes.returnToMomoOrigin, "function");
  const mtn = { current: "MoMoWaiting", params: {}, history: [entry("Home"), entry("Sell", { amountPesewas: 500 }), entry("MoMoChoice"), entry("MoMoPayment")] };
  const telecel = { ...mtn, history: [...mtn.history, entry("MoMoCode")] };
  for (const state of [mtn, telecel]) {
    const next = routes.returnToMomoOrigin(state);
    assert.equal(next.current, "Sell");
    assert.deepEqual(next.params, { amountPesewas: 500 });
    assert.deepEqual(next.history, [entry("Home")]);
  }
  assert.equal(routes.returnToMomoOrigin({ current: "MoMoWaiting", params: {}, history: [entry("Home")] }), null);
});

// Batch 17 (brief 3.8 rule 13): on 16 and 27 the pick is merged into splitParts and the pending
// MoMo values are removed too, so an old amount can never come back.
test("E4: returning from a MoMo pick strips the pick flags and the pending MoMo values and merges the row into splitParts", () => {
  assert.equal(typeof routes.returnFromMomoPickState, "function");
  const state = {
    current: "MoMoDirect",
    params: {},
    history: [entry("Sell"), entry("SplitPayment", { amountPesewas: 900 }), entry("MoMoChoice")]
  };
  const details = { amountPesewas: 900, pickOnly: true, returnRoute: "SplitPayment", momoMethod: "direct", verification: "merchant_confirmed", pendingMomoAmountPesewas: 400 };
  const next = routes.returnFromMomoPickState(state, details);
  assert.equal(next.current, "SplitPayment");
  assert.equal("pickOnly" in next.params, false);
  assert.equal("returnRoute" in next.params, false);
  for (const key of ["momoMethod", "verification", "pendingMomoAmountPesewas"]) assert.equal(key in next.params, false, key);
  assert.deepEqual(next.params.splitParts, [{ paymentMethod: "momo", amountPesewas: 400, momoMethod: "direct", verification: "merchant_confirmed", confirmedPesewas: 400 }]);
  assert.deepEqual(next.history, [entry("Sell")]);
});

test("E4: if the pick target is not in history, the MoMo screens are dropped so Back cannot reach Money received again", () => {
  const state = { current: "MoMoDirect", params: {}, history: [entry("Sell"), entry("MoMoChoice"), entry("MoMoSetup")] };
  const next = routes.returnFromMomoPickState(state, { returnRoute: "ALittleAtATime", pickOnly: true, momoMethod: "direct" });
  assert.equal(next.current, "ALittleAtATime");
  assert.deepEqual(next.history.map((item) => item.current), ["Sell"]);
  assert.equal("pickOnly" in next.params, false);
});

test("K4: 18 and 19 return to the existing 16 in a split; they no longer push a new one", () => {
  const whenWillTheyPay = slice(creditSource, "function WhenWillTheyPay", "function ALittleAtATime");
  const aLittle = slice(creditSource, "function ALittleAtATime", "function buildCreditReceiptLink");
  for (const screen of [whenWillTheyPay, aLittle]) {
    assert.match(screen, /onReturnToSplit\(/);
    assert.doesNotMatch(screen, /if \(params\.flow === "split"\) \{\s*onNavigate\("SplitPayment"/);
  }
  assert.match(appSource, /onReturnToSplit=\{\(details\) => returnTo\(POS_ROUTES\.SplitPayment, details, isSaleSplitHub\)\}/);
});

test("E3: 27 opened from 19 returns with returnTo, not onReplace", () => {
  assert.match(installmentSource, /onReturnTo\("ALittleAtATime", \{/);
  assert.doesNotMatch(installmentSource, /onReplace\("ALittleAtATime"/);
});

test("K5/E2: on 19 the payment section is hidden whenever flow=split, and the parts from 16 pass through unchanged", () => {
  const aLittle = slice(creditSource, "function ALittleAtATime", "function buildCreditReceiptLink");
  assert.match(aLittle, /const paymentAlreadyMadeToday = params\.paymentAlreadyMadeToday === true \|\|\s*params\.flow === "split";/);
  assert.match(aLittle, /\{paymentAlreadyMadeToday && paidTodayPesewas > 0 && splitParts\.length > 0 && \(/);
});

test("K5: Save plan on 19 is disabled until the plan is valid", () => {
  const aLittle = slice(creditSource, "function ALittleAtATime", "function buildCreditReceiptLink");
  assert.match(aLittle, /const planReady = /);
  assert.match(aLittle, /isValidDateString\(nextDueDate\) && nextDueDate >= today/);
  assert.match(aLittle, /disabled=\{saving \|\| !planReady\}/);
});

test("K9/K10: 57 Cancel and 59 Pay another way use the MoMo origin", () => {
  assert.match(appSource, /onCancel=\{\(\) => \{\s*returnToOrigin\(\);/);
  assert.match(appSource, /<MoMoNotCompleted[^>]*onPayAnotherWay=\{returnToOrigin\}/);
  const notCompleted = momoSource.slice(momoSource.indexOf("export function MoMoNotCompleted"));
  assert.match(notCompleted, /onClick=\{onPayAnotherWay\}>Pay another way/);
});