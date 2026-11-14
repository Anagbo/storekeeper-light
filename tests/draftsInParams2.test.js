import assert from "node:assert/strict";
import { test } from "node:test";
import { POS_ROUTES, backRoute, createRouteState, pushRoute, replaceRoute } from "../src/pos/routes.js";
import { getNextCycleDate, localDateString } from "../src/utils/installments.js";
import { loadJsx, render, textOf, walk } from "./helpers/renderJsx.js";

// Cleanup batch, commit 3: the rest of the typed drafts live in the route params, the same pattern
// as 16, 27, 53's amount and note, 55 and 19's amount paid today: the screen writes what the
// merchant typed or chose with onUpdateParams and reads it back on mount. Menu > Settings > Back
// (and Back from the next screen) then restores them. No new storage.
//   19: How much each time, How often, First payment (Today / Next cycle), Next payment date
//   53: Taken on

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
const dateInput = (tree) => [...walk(tree)].find((node) => node.type === "input" && node.props?.type === "date");
const pressed = (tree, label) => [...walk(tree)].find((node) => node.type === "button" && "aria-pressed" in (node.props ?? {}) && textOf(node).startsWith(label));
const settle = async () => { for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setImmediate(resolve)); };

// ---- 19 -----------------------------------------------------------------------------------------------

async function mount19(app, extra = {}) {
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx");
  return () => render({ type: CreditScreens, props: {
    route: "ALittleAtATime", params: app.state.params, onBack: app.back, onNavigate: app.navigate,
    onUpdateParams: app.updateParams, onReturnToSplit() {}, onSaveCredit() {}, ...extra
  } });
}
const base19 = { amountPesewas: 6000, customer: { name: "Ama", totalDebtPesewas: 0 } };
const FAR = "2099-03-07";

test("19: How much each time survives Menu > Settings > Back", async () => {
  const app = makeApp("ALittleAtATime", base19);
  const mount = await mount19(app);
  let view = mount();
  byLabel(view.tree, "How much each time?").props.onChange({ target: { value: "12.50" } });
  assert.equal(app.state.params.installmentAmount, "12.50", "kept in the route params");
  app.tripToSettings();
  assert.equal(app.state.current, "ALittleAtATime");
  view = mount();
  assert.equal(byLabel(view.tree, "How much each time?").props.value, "12.50");
});

test("19: an amount above the maximum is kept as the capped value that is shown", async () => {
  const app = makeApp("ALittleAtATime", base19);
  const view = (await mount19(app))();
  byLabel(view.tree, "How much each time?").props.onChange({ target: { value: "99" } });
  assert.equal(app.state.params.installmentAmount, "60.00");
});

test("19: How often (and the next date it sets) survives the same trip", async () => {
  const app = makeApp("ALittleAtATime", base19);
  const mount = await mount19(app);
  let view = mount();
  pressed(view.tree, "Every 2 weeks").props.onClick();
  const expectedDate = getNextCycleDate(localDateString(), "bi-weekly");
  assert.equal(app.state.params.frequency, "bi-weekly");
  assert.equal(app.state.params.nextDueDate, expectedDate);
  app.tripToSettings();
  view = mount();
  assert.equal(pressed(view.tree, "Every 2 weeks").props["aria-pressed"], true);
  assert.equal(pressed(view.tree, "Every week").props["aria-pressed"], false);
  assert.equal(dateInput(view.tree).props.value, expectedDate);
});

test("19: the next payment date typed on 19 survives the same trip", async () => {
  const app = makeApp("ALittleAtATime", base19);
  const mount = await mount19(app);
  let view = mount();
  dateInput(view.tree).props.onChange({ target: { value: FAR } });
  assert.equal(app.state.params.nextDueDate, FAR);
  app.tripToSettings();
  view = mount();
  assert.equal(dateInput(view.tree).props.value, FAR);
});

test("19: First payment (Today or Next cycle) survives the same trip", async () => {
  const app = makeApp("ALittleAtATime", base19);
  const mount = await mount19(app);
  let view = mount();
  pressed(view.tree, "Today").props.onClick();
  assert.equal(app.state.params.startToday, true);
  app.tripToSettings();
  view = mount();
  assert.equal(pressed(view.tree, "Today").props["aria-pressed"], true);
  pressed(view.tree, "Next cycle").props.onClick();
  assert.equal(app.state.params.startToday, false);
  app.tripToSettings();
  view = mount();
  assert.equal(pressed(view.tree, "Next cycle").props["aria-pressed"], true);
});

test("19: all four together come back, and Save plan then uses them", async () => {
  const app = makeApp("ALittleAtATime", base19);
  const saved = [];
  const mount = await mount19(app, { onSaveCredit: async (content) => { saved.push(content); } });
  let view = mount();
  byLabel(view.tree, "How much each time?").props.onChange({ target: { value: "12.50" } });
  pressed(view.tree, "Every month").props.onClick();
  dateInput(view.tree).props.onChange({ target: { value: FAR } });   // after the frequency: it sets its own date
  app.tripToSettings();
  view = mount();
  assert.equal(byLabel(view.tree, "How much each time?").props.value, "12.50");
  assert.equal(pressed(view.tree, "Every month").props["aria-pressed"], true);
  assert.equal(dateInput(view.tree).props.value, FAR);
  const save = [...walk(view.tree)].find((node) => node.type === "button" && textOf(node).includes("Save plan"));
  await save.props.onClick();
  await settle();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].installmentPlan.installmentAmount, 1250);
  assert.equal(saved[0].installmentPlan.frequency, "monthly");
  assert.equal(saved[0].installmentPlan.nextDueDate, FAR);
});

test("19: Back from the next screen (MoMo or the split) shows the four values again", async () => {
  const app = makeApp("ALittleAtATime", { ...base19, startToday: true, todayPaymentAmount: "5.00" });
  const mount = await mount19(app);
  let view = mount();
  byLabel(view.tree, "How much each time?").props.onChange({ target: { value: "20" } });
  pressed(view.tree, "Every 2 weeks").props.onClick();
  dateInput(view.tree).props.onChange({ target: { value: FAR } });
  app.navigate("MoMoChoice", { ...app.state.params, pickOnly: true });
  app.back();
  view = mount();
  assert.equal(byLabel(view.tree, "How much each time?").props.value, "20");
  assert.equal(pressed(view.tree, "Every 2 weeks").props["aria-pressed"], true);
  assert.equal(dateInput(view.tree).props.value, FAR);
});

test("19: nothing is written to the params until something is typed or chosen", async () => {
  const app = makeApp("ALittleAtATime", base19);
  const before = JSON.stringify(app.state.params);
  (await mount19(app))();
  assert.equal(JSON.stringify(app.state.params), before);
});

// ---- 53 -----------------------------------------------------------------------------------------------

async function mount53(app) {
  const { ManualDebtAmount } = await loadJsx("src/pos/ManualDebtScreens.jsx");
  return () => render({ type: ManualDebtAmount, props: {
    params: app.state.params, onBack: app.back, onNavigate: app.navigate, onUpdateParams: app.updateParams, onSaveManualDebt: async () => {}
  } });
}
const takenOnButton = (tree) => [...walk(tree)].find((node) => node.type === "button" && textOf(node).startsWith("Taken on"));
const exact = (tree, label) => [...walk(tree)].find((node) => node.type === "button" && textOf(node) === label);

test("53: Taken on survives Menu > Settings > Back, with the amount and note", async () => {
  const app = makeApp(POS_ROUTES.ManualDebtAmount, { customer: { name: "Ama" } });
  const mount = await mount53(app);
  let view = mount();
  assert.match(textOf(takenOnButton(view.tree)), /Taken on: Today/);
  exact(view.tree, "5").props.onClick();
  view.rerender();
  takenOnButton(view.tree).props.onClick();
  view.rerender();
  dateInput(view.tree).props.onChange({ target: { value: "2020-01-15" } });
  assert.equal(app.state.params.takenOn, "2020-01-15", "kept in the route params");
  app.tripToSettings();
  view = mount();
  assert.match(textOf(takenOnButton(view.tree)), /Taken on: 15\/01\/2020/);
  assert.equal(app.state.params.amountDigits, "5", "the amount is still there");
});

test("53: a date in the future or an empty date is refused and writes nothing", async () => {
  const app = makeApp(POS_ROUTES.ManualDebtAmount, { customer: { name: "Ama" } });
  const view = (await mount53(app))();
  takenOnButton(view.tree).props.onClick();
  view.rerender();
  const before = JSON.stringify(app.state.params);
  dateInput(view.tree).props.onChange({ target: { value: FAR } });
  dateInput(view.tree).props.onChange({ target: { value: "" } });
  assert.equal(JSON.stringify(app.state.params), before);
});

test("53: Back from 18 (the next screen) shows the Taken on date again", async () => {
  const app = makeApp(POS_ROUTES.ManualDebtAmount, { customer: { name: "Ama" } });
  const mount = await mount53(app);
  let view = mount();
  takenOnButton(view.tree).props.onClick();
  view.rerender();
  dateInput(view.tree).props.onChange({ target: { value: "2020-01-15" } });
  app.navigate(POS_ROUTES.WhenWillTheyPay, { ...app.state.params, amountPesewas: 500 });
  app.back();
  view = mount();
  assert.match(textOf(takenOnButton(view.tree)), /Taken on: 15\/01\/2020/);
});

test("53: nothing is written to the params until a date is chosen", async () => {
  const app = makeApp(POS_ROUTES.ManualDebtAmount, { customer: { name: "Ama" } });
  const before = JSON.stringify(app.state.params);
  (await mount53(app))();
  assert.equal(JSON.stringify(app.state.params), before);
});
