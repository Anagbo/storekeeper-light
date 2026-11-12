import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { db } from "../src/db/db.js";
import { POS_LINKS, POS_ROUTES, backRoute, createRouteState, popToRoute, pushRoute, replaceRoute } from "../src/pos/routes.js";
import { findButton, loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// 23 Close menu goes BACK to the screen the menu was opened from, draft intact (not Home). Menu adds
// one history entry however often it is shown; Menu > Settings > Back returns to the menu; 47 Done
// returns like Back. (Close menu used to call navigate("Home"), which wiped the history and the draft.)
after(async () => {
  setLiveQuery(null);
  db.close();
  await db.delete();
});

const appSource = readFileSync(new URL("../src/pos/PosApp.jsx", import.meta.url), "utf8");

// A stand-in for PosApp: the same route functions, the same callbacks. The new menu functions are
// loaded when the app is made so a missing export fails one test, not the whole file.
async function makeApp(route, params = {}) {
  const routes = await import("../src/pos/routes.js");
  const app = { state: createRouteState(route, params) };
  app.navigate = (to, nextParams = {}) => {
    if (to === POS_ROUTES.Menu) { app.state = routes.openMenuState(app.state); return; }
    app.state = pushRoute(app.state, to, nextParams);
  };
  app.back = () => { app.state = backRoute(app.state); };
  app.openMenu = () => { app.state = routes.openMenuState(app.state); };
  app.closeMenu = () => { app.state = routes.closeMenuState(app.state); };
  app.updateParams = (next) => { app.state = replaceRoute(app.state, app.state.current, { ...app.state.params, ...next }); };
  app.returnTo = (to, nextParams = {}) => { app.state = popToRoute(app.state, to, nextParams) ?? pushRoute(app.state, to, nextParams); };
  app.menuEntries = () => [...app.state.history, { current: app.state.current }].filter((entry) => entry.current === POS_ROUTES.Menu).length;
  return app;
}
const snapshot = (state) => JSON.stringify({ current: state.current, params: state.params, history: state.history });
const tile = (tree, label) => [...walk(tree)].filter((node) => node.type === "button" && textOf(node) === label).at(-1);

// ---- the route functions ---------------------------------------------------------------------------

test("opening the menu adds one entry; Close menu returns to the screen it was opened from, params untouched", async () => {
  const origin = { amountPesewas: 6000, splitParts: [{ paymentMethod: "cash", amountPesewas: 2000 }] };
  const app = await makeApp(POS_ROUTES.SplitPayment, origin);
  const before = snapshot(app.state);
  app.openMenu();
  assert.equal(app.state.current, POS_ROUTES.Menu);
  assert.equal(app.state.history.length, 1);
  app.closeMenu();
  assert.equal(snapshot(app.state), before, "exactly the screen and params it left");
});

test("Menu > Settings > Back returns to the menu, and Close menu then returns to the original screen", async () => {
  const app = await makeApp(POS_ROUTES.SplitPayment, { amountPesewas: 800, splitParts: [{ paymentMethod: "cash", amountPesewas: 300 }] });
  const before = snapshot(app.state);
  app.openMenu();
  app.navigate(POS_ROUTES.SettingsProfitTools);
  app.back();
  assert.equal(app.state.current, POS_ROUTES.Menu);
  app.closeMenu();
  assert.equal(snapshot(app.state), before);
});

test("the menu adds only one history entry however often it is shown", async () => {
  const app = await makeApp(POS_ROUTES.SplitPayment, { amountPesewas: 800 });
  const before = snapshot(app.state);
  app.openMenu();
  app.navigate(POS_ROUTES.SettingsProfitTools);
  app.openMenu();                                  // the header Menu button on Settings
  assert.equal(app.menuEntries(), 1);
  assert.equal(app.state.current, POS_ROUTES.Menu);
  app.navigate(POS_ROUTES.MyItems);
  app.openMenu();                                  // and on My items
  assert.equal(app.menuEntries(), 1);
  app.navigate(POS_ROUTES.MyMoney);
  app.navigate(POS_ROUTES.Menu);                   // any navigate to Menu is the same
  assert.equal(app.menuEntries(), 1);
  assert.equal(app.state.history.length, 1, "only the original screen is below the menu");
  app.closeMenu();
  assert.equal(snapshot(app.state), before);
});

test("the header Menu button while the menu is open closes it, back to the original screen (not Home)", async () => {
  const app = await makeApp(POS_ROUTES.ReviewAndPay, { saleItems: [] });
  const before = snapshot(app.state);
  app.openMenu();
  app.openMenu();
  assert.equal(snapshot(app.state), before);
});

test("Close menu with nothing to return to goes to Home", async () => {
  const routes = await import("../src/pos/routes.js");
  assert.equal(routes.closeMenuState(createRouteState(POS_ROUTES.Menu)).current, POS_ROUTES.Home);
});

test("closeMenuState does nothing when the menu is not showing", async () => {
  const routes = await import("../src/pos/routes.js");
  const state = pushRoute(createRouteState(POS_ROUTES.Sell), POS_ROUTES.SettingsProfitTools, {});
  assert.equal(routes.closeMenuState(state), state);
});

// ---- Close menu from each screen -------------------------------------------------------------------

const SCREENS = [
  ["19", "ALittleAtATime", { amountPesewas: 6000, customer: { name: "Ama", totalDebtPesewas: 0 }, installmentAmount: "20", frequency: "weekly", startToday: true, todayPaymentAmount: "20", paymentMethod: "split", firstPaymentParts: [{ paymentMethod: "cash", amountPesewas: 2000 }] }],
  ["16", "SplitPayment", { amountPesewas: 6000, splitParts: [{ paymentMethod: "cash", amountPesewas: 2000 }, { paymentMethod: "momo", amountPesewas: 1000, momoMethod: "direct", verification: "merchant_confirmed", confirmedPesewas: 1000 }] }],
  ["17", "WhoOwesYou", { amountPesewas: 6000, saleItems: [], customer: { name: "Kofi" } }],
  ["18", "WhenWillTheyPay", { amountPesewas: 6000, customer: { name: "Ama", totalDebtPesewas: 0 }, creditDueChoice: "twoWeeks" }],
  ["27", "SplitPayment", { debtId: "d1", amount: "60.00", splitParts: [{ paymentMethod: "cash", amountPesewas: 2000 }] }],
  ["53", "ManualDebtAmount", { customer: { name: "Ama" }, takenOn: "2026-11-01" }],
  ["55", "ReviewAndPay", { saleItems: [{ productId: 1, name: "Sugar", quantity: 2, unitPricePesewas: 500 }] }]
];

for (const [id, route, params] of SCREENS) {
  test(`Close menu from ${id} (${route}) returns to ${id} with its params intact, through Settings and Back too`, async () => {
    const app = await makeApp(POS_ROUTES[route], params);
    const before = snapshot(app.state);
    app.openMenu();
    app.closeMenu();
    assert.equal(snapshot(app.state), before, "straight back");
    app.openMenu();
    app.navigate(POS_ROUTES.SettingsProfitTools);
    app.back();
    app.closeMenu();
    assert.equal(snapshot(app.state), before, "via Settings");
    assert.equal(app.menuEntries(), 0);
  });
}

// ---- the full paths, through the real screens ----------------------------------------------------------

test("19 > Menu > Settings > Back > Close menu > 19: the split draft is intact", async () => {
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx");
  const { default: InstallmentSplitPayment } = await loadJsx("src/pos/InstallmentSplitPayment.jsx");
  const app = await makeApp("ALittleAtATime", {
    amountPesewas: 6000, customer: { name: "Ama", totalDebtPesewas: 0 },
    installmentAmount: "20", frequency: "weekly", startToday: true, todayPaymentAmount: "20"
  });
  // 19 > Split payment (27 from 19)
  const v19 = render({ type: CreditScreens, props: { route: "ALittleAtATime", params: app.state.params, onBack: app.back, onNavigate: app.navigate, onReturnToSplit() {}, onSaveCredit() {} } });
  [...walk(v19.tree)].find((node) => node.props?.["aria-label"] === "Split payment").props.onClick();
  assert.equal(app.state.current, POS_ROUTES.SplitPayment);
  // 27 from 19: Cash for the whole amount paid today, then Done returns to the existing 19.
  const v27 = render({ type: InstallmentSplitPayment, props: { params: app.state.params, onBack: app.back, onNavigate: app.navigate, onReturnTo: app.returnTo, onUpdateParams: app.updateParams } });
  tile(v27.tree, "Cash").props.onClick();
  v27.rerender();
  findButton(v27.tree, "Done").props.onClick();
  assert.equal(app.state.current, "ALittleAtATime");
  assert.deepEqual(app.state.params.firstPaymentParts, [{ paymentMethod: "cash", amountPesewas: 2000 }]);
  const before = snapshot(app.state);
  // 19 > Menu > Settings > Back > Close menu
  app.openMenu();
  app.navigate(POS_ROUTES.SettingsProfitTools);
  app.back();
  assert.equal(app.state.current, POS_ROUTES.Menu);
  app.closeMenu();
  assert.equal(app.state.current, "ALittleAtATime");
  assert.equal(snapshot(app.state), before, "19 and its params are exactly as they were");
  const again = render({ type: CreditScreens, props: { route: "ALittleAtATime", params: app.state.params, onBack: app.back, onNavigate: app.navigate, onReturnToSplit() {}, onSaveCredit() {} } });
  const text = textOf(again.tree);
  assert.match(text, /Paying today/);
  assert.match(text, /CashGH₵20\.00/);
});

test("16 > Menu > Settings > Back > Close menu > 16: the split draft is intact", async () => {
  const { default: SaleSplitPayment } = await loadJsx("src/pos/SaleSplitPayment.jsx");
  const app = await makeApp(POS_ROUTES.SplitPayment, { amountPesewas: 6000 });
  const mount = () => render({ type: SaleSplitPayment, props: { params: app.state.params, onBack: app.back, onNavigate: app.navigate, onUpdateParams: app.updateParams, onSaveSale: async () => {} } });
  let view = mount();
  tile(view.tree, "Cash").props.onClick();
  view.rerender();
  [...walk(view.tree)].find((node) => node.type === "button" && textOf(node) === "Cash").props.onClick();
  view.rerender();
  [...walk(view.tree)].find((node) => node.type === "input").props.onChange({ target: { value: "20.00" } });
  view.rerender();
  findButton(view.tree, "Save").props.onClick();
  view.rerender();
  const before = snapshot(app.state);
  app.openMenu();
  app.navigate(POS_ROUTES.SettingsProfitTools);
  app.back();
  assert.equal(app.state.current, POS_ROUTES.Menu);
  app.closeMenu();
  assert.equal(app.state.current, POS_ROUTES.SplitPayment);
  assert.equal(snapshot(app.state), before);
  view = mount();
  assert.match(textOf(view.tree), /CashGH₵20\.00/);
  assert.match(textOf(view.tree), /Left to payGH₵40\.00/);
});

test("16 > Menu > Settings > Done > Close menu > 16: Done goes back to the menu, not Home", async () => {
  const { SettingsProfitTools } = await loadJsx("src/pos/SettingsScreens.jsx");
  const app = await makeApp(POS_ROUTES.SplitPayment, { amountPesewas: 6000, splitParts: [{ paymentMethod: "cash", amountPesewas: 2000 }] });
  const before = snapshot(app.state);
  app.openMenu();
  app.navigate(POS_ROUTES.SettingsProfitTools);
  const settings = render({ type: SettingsProfitTools, props: { shopName: "My shop", onShopNameChange() {}, onBack: app.back, onOpenBackup() {}, onOpenMomoSettings() {}, onOpenPlan() {}, onOpenSubscription() {} } });
  findButton(settings.tree, "Done").props.onClick();
  assert.equal(app.state.current, POS_ROUTES.Menu, "Done returns like Back");
  app.closeMenu();
  assert.equal(snapshot(app.state), before);
});

// ---- the screens and the app ----------------------------------------------------------------------------

test("Menu: Close menu calls onClose (not Home); the Home item still goes to Home", async () => {
  const { default: Menu } = await loadJsx("src/pos/Menu.jsx");
  const navigations = [];
  let closes = 0;
  const view = render({ type: Menu, props: { onNavigate: (...args) => navigations.push(args), onClose: () => { closes += 1; } } });
  [...walk(view.tree)].find((node) => node.props?.["aria-label"] === "Close menu").props.onClick();
  assert.equal(closes, 1);
  assert.deepEqual(navigations, [], "Close menu does not navigate to Home");
  findButton(view.tree, "Home").props.onClick();
  assert.deepEqual(navigations, [["Home"]]);
});

test("47 Done calls the same handler as Back", async () => {
  const { SettingsProfitTools } = await loadJsx("src/pos/SettingsScreens.jsx");
  for (const [type, props] of [
    [SettingsProfitTools, { shopName: "My shop", onShopNameChange() {}, onOpenBackup() {}, onOpenMomoSettings() {}, onOpenPlan() {}, onOpenSubscription() {} }]
  ]) {
    let backs = 0;
    const view = render({ type, props: { ...props, onBack: () => { backs += 1; } } });
    const exact = (label) => [...walk(view.tree)].find((node) => node.type === "button" && textOf(node).replace(/^‹\s*/, "") === label);
    exact("Done").props.onClick();
    exact("Back").props.onClick();
    assert.equal(backs, 2, `${type.name}: Done and Back are the same`);
  }
});

test("PosApp opens and closes the menu through the route functions and gives Menu onClose", () => {
  assert.match(appSource, /openMenuState/);
  assert.match(appSource, /closeMenuState/);
  const open = appSource.slice(appSource.indexOf("function openMenu()"), appSource.indexOf("function closeMenu"));
  assert.doesNotMatch(open, /switchTab\(POS_ROUTES\.Home\)/, "the header Menu button never goes Home");
  assert.match(open, /openMenuState/);
  assert.match(appSource, /<Menu onNavigate=\{navigate\} onClose=\{closeMenu\} \/>/);
  const nav = appSource.slice(appSource.indexOf("function navigate("), appSource.indexOf("function switchTab"));
  assert.match(nav, /POS_ROUTES\.Menu/, "navigate to Menu goes through openMenuState too");
  assert.match(appSource, /<SettingsProfitTools[\s\S]*?onBack=\{navigateBack\}/);
  assert.doesNotMatch(appSource, /LanguageSettings/, "the Language screen is removed (voice entry was dropped)");
});

test("the Menu close link in POS_LINKS returns through history (the contract's BACK)", () => {
  const close = POS_LINKS.find((link) => link.from === "Menu" && link.action === "close");
  assert.ok(close, "the link exists");
  assert.equal(close.via, "history");
});