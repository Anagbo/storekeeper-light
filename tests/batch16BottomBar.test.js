import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { POS_ROUTES, backRoute, createRouteState, showsBottomBar } from "../src/pos/routes.js";
import wiring from "../src/pos/wiring.json" with { type: "json" };

// Batch 16: the bottom bar shows only on 15, 22, 25 and 32 (wiring `bottom_bar`), and no other
// screen is left without a way back, to Home or to finish.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// Wiring component names that differ from the route names (same list as wp5.contract.test.js).
const routeOfComponent = (component) => ({
  SavedAsCredit: "CreditSaved",
  ItemPrice: "HowMuchIsItem",
  ItemQuantity: "HowManyItem",
  Settings: "SettingsProfitTools",
  HowMuchDoTheyOwe: "ManualDebtAmount",
  CorrectBalance: "DebtorDetail"
}[component] ?? component);

// Wiring 23 (14 Nov 2026): the Menu is a drawer over the page, not a route. It has no bar of its own;
// its dimmed layer covers the page's bar.
const OVERLAYS = new Set(["MenuDrawer"]);

test("the bar is shown on exactly the screens whose wiring says bottom_bar", () => {
  const byRoute = new Map();
  for (const [id, screen] of Object.entries(wiring.screens)) {
    assert.equal(typeof screen.bottom_bar, "boolean", `screen ${id} has a bottom_bar flag`);
    if (OVERLAYS.has(screen.component)) {
      assert.equal(screen.bottom_bar, false, `screen ${id} (an overlay) has no bar`);
      assert.equal(POS_ROUTES[screen.component], undefined, `screen ${id} (an overlay) is not a route`);
      continue;
    }
    const route = routeOfComponent(screen.component);
    assert.ok(POS_ROUTES[route], `screen ${id} (${screen.component}) has a route`);
    assert.equal(showsBottomBar(POS_ROUTES[route]), screen.bottom_bar, `screen ${id} ${screen.name}: bar should be ${screen.bottom_bar}`);
    if (byRoute.has(route)) assert.equal(byRoute.get(route), screen.bottom_bar, `${route} is used by screens that disagree about the bar`);
    byRoute.set(route, screen.bottom_bar);
  }
  const withBar = Object.entries(wiring.screens).filter(([, screen]) => screen.bottom_bar).map(([id]) => id).sort();
  assert.deepEqual(withBar, ["15", "22", "25", "32"], "the contract lists the bar on 15, 22, 25 and 32 only");
});

test("no other route shows the bar, including the flow, setup and planned screens", () => {
  const shown = Object.values(POS_ROUTES).filter((route) => showsBottomBar(route)).sort();
  assert.deepEqual(shown, [POS_ROUTES.CollectPayment, POS_ROUTES.Home, POS_ROUTES.PeopleWhoOweYou, POS_ROUTES.Sell].sort());
});

test("the app draws the bar from that same rule, and keeps the header and the side menu", () => {
  const app = read("src/pos/PosApp.jsx");
  assert.match(app, /showsBottomBar\(route\)/);
  assert.doesNotMatch(app, /!isFocusedCollectionScreen && !isSetupFlow && <PosBottomNav/);
  assert.match(app, /<PosBottomNav/);
  // Wiring 22/23 (14 Nov 2026): the header keeps the Menu button (it opens the drawer); the green
  // home tile is gone (Home is a row in the drawer). The side menu stays on wide screens.
  assert.match(app, /<PosHeader[\s\S]*?onMenu=\{openMenu\}/);
  assert.doesNotMatch(app.slice(app.indexOf("<PosHeader"), app.indexOf("/>", app.indexOf("<PosHeader"))), /onHome=/);
  assert.match(app, /\{!isSetupFlow && <PosSideNav/);
  const components = read("src/pos/PosComponents.jsx");
  assert.match(components.slice(components.indexOf("export function PosBottomNav")), /lg:hidden/);
  assert.match(components.slice(components.indexOf("export function PosSideNav")), /hidden w-60[^"]*lg:flex/);
});

// ---- every screen without the bar still has a way back, to Home, or to finish ----

const EXIT_LABEL = /^(‹ )?(back|close|close menu|cancel|cancel request|cancel sale|done|home|skip|keep|continue)/i;
const EXIT_TARGETS = new Set(["BACK", "22", "FROM", "CANCELMOMO", "PAYOTHER"]);
// Actions that save or move forward are not a way out (16 Done saves the sale and stays off until the parts add up).
const FORWARD_TARGETS = new Set(["MOMO16", "MOMO27", "SAVECREDIT", "SAVE19", "NEXT17", "NEXT53", "MOMOOK", "SEND", "SAVEMOMO"]);
const hasContractExit = (screen) => screen.controls.some((control) => control.to && !FORWARD_TARGETS.has(control.to) &&
  (EXIT_LABEL.test(control.label.trim()) || EXIT_TARGETS.has(control.to)));

// The contract gives these no Back or Done; the code does (the extras kept in the contract's
// built_extras_kept / the audit). Each is checked in the source below.
const EXIT_IN_CODE_ONLY = {
  "16": { file: "src/pos/SplitPayment.jsx", fn: "SplitPayment", needle: "onClick={onBack}" },
  "17": { file: "src/pos/CreditScreens.jsx", fn: "WhoOwesYou", needle: "onClick={onBack}" },
  "18": { file: "src/pos/CreditScreens.jsx", fn: "WhenWillTheyPay", needle: "onClick={onBack}" },
  "20": { file: "src/pos/SellWithItems.jsx", fn: "SellWithItems", needle: "onClick={onBack}" },
  ManualDebtSaved: { file: "src/pos/ManualDebtScreens.jsx", fn: "ManualDebtSaved", needle: "onClick={onDone}" }
};

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} exists`);
  const rest = source.slice(start + 10);
  const ends = ["\nexport ", "\nfunction "].map((marker) => rest.indexOf(marker)).filter((index) => index >= 0);
  return ends.length ? rest.slice(0, Math.min(...ends)) : rest;
}

test("every screen without the bar has a contract exit (Back, Done, Cancel, Close or Home)", () => {
  const withoutExit = Object.entries(wiring.screens)
    .filter(([, screen]) => !screen.bottom_bar && !hasContractExit(screen))
    .map(([id]) => id)
    .sort();
  assert.deepEqual(withoutExit, Object.keys(EXIT_IN_CODE_ONLY).sort(),
    "only the listed screens lack a contract exit; a new screen without one must be added to the contract or fixed");
});

test("the screens whose exit is only in the code really have it", () => {
  for (const [id, { file, fn, needle }] of Object.entries(EXIT_IN_CODE_ONLY)) {
    assert.ok(functionBody(read(file), fn).includes(needle), `screen ${id} (${fn}) renders its ${needle} button`);
  }
});

test("Back with no history goes to Home, so a screen with Back can never trap the merchant", () => {
  const empty = createRouteState(POS_ROUTES.HowManyItem);
  assert.equal(backRoute(empty).current, POS_ROUTES.Home);
});