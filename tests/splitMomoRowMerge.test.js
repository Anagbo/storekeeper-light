import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { POS_ROUTES, backRoute, createRouteState, pushRoute, replaceRoute, returnFromMomoPickState } from "../src/pos/routes.js";
import { findButton, flushEffects, loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Batch 17, commit 1. After a MoMo pick returns to 16 / 27, the old pending MoMo values stayed in
// the route params and re-created the row (at its old amount) on every remount; a second MoMo
// tap replaced the existing MoMo row instead of growing it; and the parts lived only in
// component state, so a trip to Settings lost the draft. Brief 3.8 rules 2 and 13.
after(async () => {
  setLiveQuery(null);
  db.close();
  await db.delete();
});
beforeEach(async () => {
  await db.settings.clear();
  await db.settings.put({ key: "momoReceivingNumber", value: "0241234567" });
  await db.settings.put({ key: "momoReceivingNetwork", value: "MTN" });
});

const settle = async () => { for (let index = 0; index < 8; index += 1) await new Promise((resolve) => setImmediate(resolve)); };
const direct = { momoMethod: "direct", verification: "merchant_confirmed" };
const tile = (tree, label) => [...walk(tree)].find((node) => node.type === "button" && textOf(node) === label);
const PICK_KEYS = ["pickOnly", "returnRoute", "pendingMomoAmountPesewas", "momoMethod", "verification"];

// A tiny stand-in for PosApp: the real route functions, the same callbacks.
function makeApp(initialRoute, initialParams) {
  const app = { state: createRouteState(initialRoute, initialParams) };
  app.navigate = (route, params = {}) => { app.state = pushRoute(app.state, route, params); };
  app.back = () => { app.state = backRoute(app.state); };
  app.updateParams = (params) => { app.state = replaceRoute(app.state, app.state.current, { ...app.state.params, ...params }); };
  app.returnFromPick = (details) => { app.state = returnFromMomoPickState(app.state, details); };
  return app;
}

async function sale16(app) {
  const { default: SaleSplitPayment } = await loadJsx("src/pos/SaleSplitPayment.jsx");
  return () => render({ type: SaleSplitPayment, props: {
    params: app.state.params, onBack: app.back, onNavigate: app.navigate, onUpdateParams: app.updateParams, onSaveSale: async () => {}
  } });
}

// Run the real 61 and 62 for the pending amount and return what Money received sends back.
async function confirmDirectOn62(app) {
  const { MoMoChoice, MoMoDirect } = await loadJsx("src/pos/MoMoScreens.jsx");
  const v61 = render({ type: MoMoChoice, props: { params: app.state.params, onBack() {}, onNavigate: app.navigate, onReplace() {} } });
  findButton(v61.tree, "Customer sends to my number").props.onClick();
  let picked;
  const v62 = render({ type: MoMoDirect, props: { params: app.state.params, onBack() {}, onConfirm() {}, onPick: (details) => { picked = details; } } });
  flushEffects(v62);
  // Wait for 62 to load the saved number: Money received stays off until it has.
  for (let attempt = 0; attempt < 100 && findButton(v62.tree, "Money received").props.disabled; attempt += 1) {
    await settle();
    v62.rerender();
  }
  assert.equal(findButton(v62.tree, "Money received").props.disabled, false, "62 loaded the saved number");
  findButton(v62.tree, "Money received").props.onClick();
  await settle();
  app.returnFromPick(picked);
  return textOf(v62.tree);
}

// The MoMo tile opens the amount editor prefilled with Left to pay (Batch 17); Save goes to 61.
function tapMomoTile(view, value) {
  tile(view.tree, "MoMo").props.onClick();
  view.rerender();
  if (value) {
    [...walk(view.tree)].find((node) => node.type === "input").props.onChange({ target: { value } });
    view.rerender();
  }
  findButton(view.tree, "Save").props.onClick();
}

// ---- the stale pending values -----------------------------------------------------------------

test("after a MoMo pick returns, no pick values stay in the params and the row is in splitParts", async () => {
  const app = makeApp(POS_ROUTES.SplitPayment, { amountPesewas: 800 });
  const mount = await sale16(app);
  tapMomoTile(mount());
  assert.equal(app.state.params.pendingMomoAmountPesewas, 800);
  const text62 = await confirmDirectOn62(app);
  assert.match(text62, /send ?GH₵8\.00/);
  assert.equal(app.state.current, POS_ROUTES.SplitPayment);
  for (const key of PICK_KEYS) assert.equal(key in app.state.params, false, `${key} is gone from the params`);
  assert.equal(app.state.params.splitParts.length, 1);
  assert.deepEqual({ ...app.state.params.splitParts[0] }, { paymentMethod: "momo", amountPesewas: 800, ...direct, confirmedPesewas: 800 });
});

// A confirmed row can no longer be edited (wiring 16, 11 Nov 2026), so 4.00 is what 62 confirms.
test("a MoMo row is not re-created from the pick values when the screen is mounted again", async () => {
  const app = makeApp(POS_ROUTES.SplitPayment, { amountPesewas: 800 });
  const mount = await sale16(app);
  tapMomoTile(mount(), "4.00");
  await confirmDirectOn62(app);
  const view = mount();
  tile(view.tree, "Cash").props.onClick();
  view.rerender();
  assert.doesNotMatch(textOf(view.tree), /Left to pay/);
  for (let index = 0; index < 3; index += 1) {
    const again = mount();
    const text = textOf(again.tree);
    assert.match(text, /MoMoGH₵4.00Status ?Received ✓/, `mount ${index + 1}`);
    assert.match(text, /CashGH₵4\.00/);
    assert.doesNotMatch(text, /Left to pay/);
  }
});

// ---- a second MoMo tap grows the row ---------------------------------------------------------

// Wiring 16 (11 Nov 2026): a received MoMo row is locked, so there is no second MoMo tap to grow it.
test("a received MoMo row hides the MoMo tile (one row per mode, and that row is final)", async () => {
  const app = makeApp(POS_ROUTES.SplitPayment, { amountPesewas: 6000, splitParts: [{ paymentMethod: "momo", amountPesewas: 2000, ...direct, confirmedPesewas: 2000 }] });
  const mount = await sale16(app);
  const view = mount();
  assert.equal(tile(view.tree, "MoMo"), undefined);
  assert.ok(tile(view.tree, "Cash"));
  assert.match(textOf(view.tree), /Left to payGH₵40\.00/);
});

test("a pick whose method differs from the existing MoMo row is ignored, the row is untouched", async () => {
  const row = { paymentMethod: "momo", amountPesewas: 2000, momoMethod: "paystack", verification: "verified", reference: "ref1", confirmedPesewas: 2000 };
  const state = pushRoute(createRouteState(POS_ROUTES.SplitPayment, { amountPesewas: 6000 }), POS_ROUTES.MoMoChoice, {});
  const next = returnFromMomoPickState(state, {
    amountPesewas: 6000, splitParts: [row], pendingMomoAmountPesewas: 4000, ...direct, returnRoute: "SplitPayment", pickOnly: true
  });
  assert.deepEqual(next.params.splitParts, [row]);
  for (const key of PICK_KEYS) assert.equal(key in next.params, false);
});

test("when the split screen is not in history the pick is still merged and cleaned", () => {
  const state = pushRoute(createRouteState(POS_ROUTES.Home), POS_ROUTES.MoMoChoice, { amountPesewas: 500 });
  const next = returnFromMomoPickState(state, {
    amountPesewas: 500, splitParts: [], pendingMomoAmountPesewas: 500, ...direct, returnRoute: "SplitPayment", pickOnly: true
  });
  assert.equal(next.current, "SplitPayment");
  assert.equal(next.params.splitParts[0].amountPesewas, 500);
  for (const key of PICK_KEYS) assert.equal(key in next.params, false);
});

test("19's own MoMo pick is unchanged: it keeps the method and amount it shows on its button", () => {
  const state = pushRoute(createRouteState("ALittleAtATime", { amountPesewas: 3000 }), POS_ROUTES.MoMoDirect, {});
  const next = returnFromMomoPickState(state, {
    amountPesewas: 3000, pendingMomoAmountPesewas: 1000, ...direct, returnRoute: "ALittleAtATime", pickOnly: true
  });
  assert.equal(next.current, "ALittleAtATime");
  assert.equal(next.params.momoMethod, "direct");
  assert.equal(next.params.pendingMomoAmountPesewas, 1000);
  assert.equal("pickOnly" in next.params, false);
});

// ---- the draft survives a trip to Settings ------------------------------------------------------

test("the draft is restored after Menu > Settings > Back (route params only)", async () => {
  const app = makeApp(POS_ROUTES.SplitPayment, { amountPesewas: 800 });
  const mount = await sale16(app);
  tapMomoTile(mount(), "4.00");
  await confirmDirectOn62(app);
  const view = mount();
  tile(view.tree, "Cash").props.onClick();
  view.rerender();
  // The Menu drawer is not navigation (wiring 23): its Settings row pushes Settings on 16.
  app.navigate(POS_ROUTES.SettingsProfitTools);
  app.back();
  assert.equal(app.state.current, POS_ROUTES.SplitPayment);
  const text = textOf(mount().tree);
  assert.match(text, /MoMoGH₵4.00Status ?Received ✓/);
  assert.match(text, /CashGH₵4\.00/);
  assert.doesNotMatch(text, /Left to pay/);
});

test("a draft with only a Cash row is restored too, and removing a row is remembered", async () => {
  const app = makeApp(POS_ROUTES.SplitPayment, { amountPesewas: 6000 });
  const mount = await sale16(app);
  let view = mount();
  tile(view.tree, "Cash").props.onClick();
  view.rerender();
  app.navigate(POS_ROUTES.SettingsProfitTools);
  app.back();
  view = mount();
  assert.match(textOf(view.tree), /CashGH₵60\.00/);
  [...walk(view.tree)].find((node) => node.type === "button" && String(node.props?.["aria-label"] ?? "").startsWith("Remove")).props.onClick();
  view.rerender();
  app.navigate(POS_ROUTES.SettingsProfitTools);
  app.back();
  assert.match(textOf(mount().tree), /Left to payGH₵60\.00/);
});

test("27 and 27 from 19 also write their parts to the params as they change", async () => {
  const { CollectSplitPayment } = await loadJsx("src/pos/DebtCollection.jsx");
  const { default: InstallmentSplitPayment } = await loadJsx("src/pos/InstallmentSplitPayment.jsx");
  setLiveQuery(([id]) => (id === "d1" ? { id: "d1", amountPesewas: 6000, customerName: "Ama", status: "unpaid" } : undefined));
  const updates = [];
  const v27 = render({ type: CollectSplitPayment, props: { params: { debtId: "d1", amount: "60.00" }, onRecordCollection() {}, onBack() {}, onNavigate() {}, onUpdateParams: (params) => updates.push(params) } });
  setLiveQuery(null);
  tile(v27.tree, "Cash").props.onClick();
  assert.deepEqual(updates.at(-1).splitParts, [{ paymentMethod: "cash", amountPesewas: 6000 }]);
  const v19 = render({ type: InstallmentSplitPayment, props: { params: { splitTotalPesewas: 2000 }, onBack() {}, onNavigate() {}, onReturnTo() {}, onUpdateParams: (params) => updates.push(params) } });
  tile(v19.tree, "Cash").props.onClick();
  assert.deepEqual(updates.at(-1).splitParts, [{ paymentMethod: "cash", amountPesewas: 2000 }]);
});

test("PosApp gives all three split screens onUpdateParams", () => {
  const app = readFileSync(new URL("../src/pos/PosApp.jsx", import.meta.url), "utf8");
  for (const name of ["CollectSplitPayment", "SaleSplitPayment", "InstallmentSplitPayment"]) {
    const at = app.indexOf(`<${name}`);
    assert.ok(at >= 0, `${name} is rendered`);
    assert.match(app.slice(at, app.indexOf("/>", at)), /onUpdateParams=\{updateCurrentParams\}/, name);
  }
});