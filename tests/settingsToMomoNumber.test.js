import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { getMerchantMomoSettings } from "../src/pos/momoConfig.js";
import { POS_ROUTES, backRoute, createRouteState, pushRoute } from "../src/pos/routes.js";
import { findButton, flushEffects, loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// 47 Settings -> "MoMo payments" -> 63 -> number -> confirm -> saved -> back on 47, and then 62's
// Money received turns on. (47 opened a route that PosApp never rendered, so the merchant saw
// the planned-screen error and could not set the number customers send to.)
after(async () => {
  setLiveQuery(null);
  db.close();
  await db.delete();
});
beforeEach(async () => {
  await db.settings.clear();
});

const settle = () => new Promise((resolve) => setImmediate(resolve));
const app = readFileSync(new URL("../src/pos/PosApp.jsx", import.meta.url), "utf8");
const byLabel = (tree, label) => [...walk(tree)].find((node) => node.props?.["aria-label"] === label);

async function settled(view) {
  for (let index = 0; index < 8; index += 1) await settle();
  view.rerender();
}

test("PosApp renders 63 for the PaymentSettings route and Back returns to the previous screen", () => {
  assert.match(app, /route === POS_ROUTES\.PaymentSettings \? \(\s*<PaymentSettings[^>]*onBack=\{navigateBack\}/);
  assert.match(app, /onOpenMomoSettings=\{\(\) => navigate\(POS_ROUTES\.PaymentSettings\)\}/);
});

test("47 MoMo payments opens 63; saving a number goes back to 47; 62 Money received is then on", async () => {
  const [{ SettingsProfitTools }, { PaymentSettings, MoMoDirect }] = await Promise.all([
    loadJsx("src/pos/SettingsScreens.jsx"),
    loadJsx("src/pos/MoMoScreens.jsx")
  ]);

  // The app's own route functions, the same ones PosApp's navigate and navigateBack use.
  let state = createRouteState(POS_ROUTES.SettingsProfitTools);
  const navigate = (route, params = {}) => { state = pushRoute(state, route, params); };
  const navigateBack = () => { state = backRoute(state); };

  // 47: the row "MoMo payments" opens the PaymentSettings route.
  const settings = render({ type: SettingsProfitTools, props: {
    shopName: "My shop", onShopNameChange() {}, onBack() {}, onOpenBackup() {},
    onOpenMomoSettings: () => navigate(POS_ROUTES.PaymentSettings), onOpenPlan() {}, onOpenSubscription() {}
  } });
  findButton(settings.tree, "MoMo payments").props.onClick();
  assert.equal(state.current, POS_ROUTES.PaymentSettings);

  // 62 before the number is saved: Money received is off and the number shows a dash.
  const directProps = { params: { amountPesewas: 1000 }, onBack() {}, onConfirm() {}, onPick() {} };
  let direct = render({ type: MoMoDirect, props: directProps });
  flushEffects(direct);
  await settled(direct);
  assert.equal(findButton(direct.tree, "Money received").props.disabled, true, "off with no number");

  // 63: switch on, type the number, Save -> masked confirmation -> Yes, save.
  const screen = render({ type: PaymentSettings, props: { onBack: navigateBack, onNavigate: navigate } });
  flushEffects(screen);
  await settled(screen);
  byLabel(screen.tree, "Customer sends to my number").props.onClick();
  screen.rerender();
  byLabel(screen.tree, "My MoMo number").props.onChange({ target: { value: "024 123 4567" } });
  screen.rerender();
  findButton(screen.tree, "Save").props.onClick();
  await settled(screen);
  assert.match(textOf(screen.tree), /Customers will send money to 024 ••• 4567 \(MTN\)\. Is this your number\?/);
  assert.equal((await getMerchantMomoSettings()).number, "", "nothing is saved before the merchant confirms");
  findButton(screen.tree, "Yes, save").props.onClick();
  await settled(screen);

  // Saved, and Back is on 47 again.
  const saved = await getMerchantMomoSettings();
  assert.equal(saved.number, "0241234567");
  assert.equal(saved.network, "MTN");
  assert.equal(state.current, POS_ROUTES.SettingsProfitTools, "back on 47");
  const log = JSON.parse((await db.settings.get("momoReceivingNumberLog")).value);
  assert.equal(log.length, 1, "the change is logged locally");

  // 62 now: Money received is on.
  direct = render({ type: MoMoDirect, props: directProps });
  flushEffects(direct);
  await settled(direct);
  assert.equal(findButton(direct.tree, "Money received").props.disabled, false, "on once a number is saved");
  assert.match(textOf(direct.tree), /0241234567/);
  assert.doesNotMatch(textOf(direct.tree), /Set your MoMo number in Settings first/);
});

test("a number that is not a Ghana mobile number is not saved", async () => {
  const { PaymentSettings } = await loadJsx("src/pos/MoMoScreens.jsx");
  let backs = 0;
  const screen = render({ type: PaymentSettings, props: { onBack: () => { backs += 1; }, onNavigate() {} } });
  flushEffects(screen);
  await settled(screen);
  byLabel(screen.tree, "Customer sends to my number").props.onClick();
  screen.rerender();
  byLabel(screen.tree, "My MoMo number").props.onChange({ target: { value: "12345" } });
  screen.rerender();
  findButton(screen.tree, "Save").props.onClick();
  await settled(screen);
  assert.match(textOf(screen.tree), /Enter a Ghana mobile number/);
  assert.equal((await getMerchantMomoSettings()).number, "");
  assert.equal(backs, 0);
});