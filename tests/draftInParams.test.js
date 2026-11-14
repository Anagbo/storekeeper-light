import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { db } from "../src/db/db.js";
import { POS_ROUTES, backRoute, createRouteState, pushRoute, replaceRoute } from "../src/pos/routes.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Typed values on 19 (amount paid today and how it is paid), 53 (amount and note) and 55 (the
// Cash/MoMo/Owe choice) live in the route params, like the split parts on 16 and 27, so Menu >
// Settings > Back restores them. No new storage. Not covered, by decision: the
// search text on 17 and taps on 18 that were never carried in the params.
after(async () => {
  setLiveQuery(null);
  db.close();
  await db.delete();
});

const appSource = readFileSync(new URL("../src/pos/PosApp.jsx", import.meta.url), "utf8");

function makeApp(route, params) {
  const app = { state: createRouteState(route, params) };
  app.navigate = (to, next = {}) => { app.state = pushRoute(app.state, to, next); };
  app.back = () => { app.state = backRoute(app.state); };
  app.updateParams = (next) => { app.state = replaceRoute(app.state, app.state.current, { ...app.state.params, ...next }); };
  // Menu > Settings > Back, as the header and the drawer do it: the drawer is not navigation (wiring 23),
  // so Settings is pushed on this screen and Back returns straight to it.
  app.tripToSettings = () => {
    app.navigate(POS_ROUTES.SettingsProfitTools);
    app.back();
  };
  return app;
}
const byLabel = (tree, label) => [...walk(tree)].find((node) => node.props?.["aria-label"] === label);
const exact = (tree, label) => [...walk(tree)].find((node) => node.type === "button" && textOf(node) === label);
const pressedButton = (tree, label) => [...walk(tree)].find((node) => node.type === "button" && "aria-pressed" in (node.props ?? {}) && textOf(node) === label);

// ---- 19 ----------------------------------------------------------------------------------------------

async function mount19(app) {
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx");
  return () => render({ type: CreditScreens, props: {
    route: "ALittleAtATime", params: app.state.params, onBack: app.back, onNavigate: app.navigate,
    onUpdateParams: app.updateParams, onReturnToSplit() {}, onSaveCredit() {}
  } });
}
const params19 = { amountPesewas: 6000, customer: { name: "Ama", totalDebtPesewas: 0 }, installmentAmount: "20", frequency: "weekly", startToday: true };

test("19: the amount paid today survives Menu > Settings > Back", async () => {
  const app = makeApp("ALittleAtATime", params19);
  const mount = await mount19(app);
  let view = mount();
  byLabel(view.tree, "Amount paid today").props.onChange({ target: { value: "15.50" } });
  assert.equal(app.state.params.todayPaymentAmount, "15.50", "kept in the route params");
  app.tripToSettings();
  assert.equal(app.state.current, "ALittleAtATime");
  view = mount();
  assert.equal(byLabel(view.tree, "Amount paid today").props.value, "15.50");
});

test("19: how it is paid (Cash chosen after MoMo) survives the same trip", async () => {
  const app = makeApp("ALittleAtATime", { ...params19, paymentMethod: "momo", momoMethod: "direct" });
  const mount = await mount19(app);
  let view = mount();
  assert.equal(pressedButton(view.tree, "MoMo")?.props["aria-pressed"], true, "starts on MoMo");
  pressedButton(view.tree, "Cash").props.onClick();
  assert.equal(app.state.params.paymentMethod, "cash");
  app.tripToSettings();
  view = mount();
  assert.equal(pressedButton(view.tree, "Cash").props["aria-pressed"], true);
  assert.equal(pressedButton(view.tree, "MoMo").props["aria-pressed"], false);
});

test("19: nothing is written to the params until something is typed or chosen", async () => {
  const app = makeApp("ALittleAtATime", params19);
  const before = JSON.stringify(app.state.params);
  (await mount19(app))();
  assert.equal(JSON.stringify(app.state.params), before);
});

// ---- 53 ----------------------------------------------------------------------------------------------

async function mount53(app) {
  const { ManualDebtAmount } = await loadJsx("src/pos/ManualDebtScreens.jsx");
  return () => render({ type: ManualDebtAmount, props: {
    params: app.state.params, onBack: app.back, onNavigate: app.navigate, onUpdateParams: app.updateParams, onSaveManualDebt: async () => {}
  } });
}
const noteField = (tree) => [...walk(tree)].find((node) => node.type === "input" && node.props?.placeholder === "What for? (optional)");

test("53: the typed amount and note survive Menu > Settings > Back", async () => {
  const app = makeApp(POS_ROUTES.ManualDebtAmount, { customer: { name: "Ama" } });
  const mount = await mount53(app);
  let view = mount();
  for (const key of ["1", "2", "5", "0"]) {
    exact(view.tree, key).props.onClick();
    view.rerender();
  }
  noteField(view.tree).props.onChange({ target: { value: "Rice and oil" } });
  view.rerender();
  assert.match(textOf(view.tree), /GH₵12\.50/);
  assert.equal(app.state.params.amountDigits, "1250");
  assert.equal(app.state.params.note, "Rice and oil");
  app.tripToSettings();
  view = mount();
  assert.match(textOf(view.tree), /GH₵12\.50/);
  assert.equal(noteField(view.tree).props.value, "Rice and oil");
});

test("53: Delete is remembered, and a fast second tap in the same frame is not lost", async () => {
  const app = makeApp(POS_ROUTES.ManualDebtAmount, { customer: { name: "Ama" } });
  const mount = await mount53(app);
  const view = mount();
  exact(view.tree, "9").props.onClick();
  exact(view.tree, "9").props.onClick();      // same frame: the screen has not re-rendered in between
  assert.equal(app.state.params.amountDigits, "99");
  byLabel(view.tree, "Delete amount digit").props.onClick();
  assert.equal(app.state.params.amountDigits, "9");
});

test("53: coming Back from 18 (the next screen) shows the amount and note again", async () => {
  const app = makeApp(POS_ROUTES.ManualDebtAmount, { customer: { name: "Ama" } });
  const mount = await mount53(app);
  let view = mount();
  for (const key of ["5", "0", "0"]) {
    exact(view.tree, key).props.onClick();
    view.rerender();
  }
  noteField(view.tree).props.onChange({ target: { value: "Bread" } });
  app.navigate(POS_ROUTES.WhenWillTheyPay, { ...app.state.params, amountPesewas: 500, note: "Bread" });
  app.back();
  view = mount();
  assert.match(textOf(view.tree), /GH₵5\.00/);
  assert.equal(noteField(view.tree).props.value, "Bread");
});

// ---- 55 ----------------------------------------------------------------------------------------------

async function mount55(app) {
  const { default: ReviewAndPay } = await loadJsx("src/pos/ReviewAndPay.jsx");
  return () => render({ type: ReviewAndPay, props: {
    params: app.state.params, onBack: app.back, onNavigate: app.navigate, onUpdateParams: app.updateParams, onSaveSale: async () => {}
  } });
}
const cart = [{ productId: 1, name: "Sugar", quantity: 2, unitPricePesewas: 500 }];

test("55: the Cash choice is kept in the route params and restored after Menu > Settings > Back", async () => {
  const app = makeApp(POS_ROUTES.ReviewAndPay, { saleItems: cart });
  const mount = await mount55(app);
  let view = mount();
  pressedButton(view.tree, "Cash").props.onClick();
  assert.equal(app.state.params.paymentChoice, "cash");
  app.tripToSettings();
  assert.equal(app.state.current, POS_ROUTES.ReviewAndPay);
  view = mount();
  assert.equal(pressedButton(view.tree, "Cash").props["aria-pressed"], true);
  assert.equal(app.state.params.saleItems.length, 1, "the cart is untouched");
});

test("55: MoMo and Owe leave the screen, so they never write a choice that Done could save unconfirmed", async () => {
  const app = makeApp(POS_ROUTES.ReviewAndPay, { saleItems: cart });
  const view = (await mount55(app))();
  pressedButton(view.tree, "MoMo").props.onClick();
  assert.equal(app.state.current, POS_ROUTES.MoMoChoice);
  assert.equal("paymentChoice" in app.state.params, false);
  app.back();
  assert.equal(pressedButton((await mount55(app))().tree, "Cash").props["aria-pressed"], true, "back on Cash, as before");
  // A stray value in the params can only select Cash; it can never pre-select an unconfirmed MoMo save.
  const odd = makeApp(POS_ROUTES.ReviewAndPay, { saleItems: cart, paymentChoice: "momo" });
  const oddView = (await mount55(odd))();
  assert.equal(pressedButton(oddView.tree, "MoMo").props["aria-pressed"], false);
});

// ---- the app -----------------------------------------------------------------------------------------

test("PosApp gives 19, 53 and 55 onUpdateParams", () => {
  for (const name of ["CreditScreens", "ManualDebtAmount", "ReviewAndPay"]) {
    const at = appSource.indexOf(`<${name}`);
    assert.ok(at >= 0, `${name} is rendered`);
    assert.match(appSource.slice(at, appSource.indexOf("/>", at)), /onUpdateParams=\{updateCurrentParams\}/, name);
  }
});