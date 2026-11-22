import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { POS_ROUTES } from "../src/pos/routes.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { flushEffects, loadJsx, render, textOf, walk } from "./helpers/renderJsx.js";

// Wiring 23 and rules_global.menu_drawer (14 Nov 2026): the Menu is a left drawer over the current
// page, never a page. Opening it adds no history entry and keeps every draft. Close (X), a tap on the
// dimmed page, Escape and the phone's Back close it. A row closes it and goes to that screen; Back
// from Settings, Items, My money or Today's transactions returns to the page it was opened on.
// Focus moves in, stays in, and returns to the Menu button. role dialog, aria-modal, name Menu.
// Driven through the real PosApp (posAppHarness) and the real MenuDrawer.

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

globalThis.localStorage ??= (() => {
  const store = new Map();
  return { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: (key) => store.delete(key), clear: () => store.clear() };
})();

// A document that keeps its keydown listeners, so Escape and Tab reach the drawer.
const keyListeners = new Set();
globalThis.document = {
  visibilityState: "visible",
  activeElement: null,
  addEventListener(type, listener) { if (type === "keydown") keyListeners.add(listener); },
  removeEventListener(type, listener) { if (type === "keydown") keyListeners.delete(listener); }
};
function press(key, shiftKey = false) {
  const event = { key, shiftKey, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  for (const listener of [...keyListeners]) listener(event);
  return event;
}

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  resetBrowserBack();
  keyListeners.clear();
  localStorage.clear();
  localStorage.setItem("storekeeper-shop-name", "Ama Stores");
  await setPreference("posSetupCompleted", true);
});

async function open() {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  return app;
}

const snapshot = (app) => JSON.stringify({ current: app.state.current, params: app.state.params, history: app.state.history });
const drawerRoot = (app) => [...walk(app.view.tree)].find((node) => node.props?.["data-menu-drawer"] !== undefined);
const scrim = (app) => [...walk(drawerRoot(app))].find((node) => node.type === "div" && node.props?.["aria-hidden"] === "true" && typeof node.props.onClick === "function");
const browserEntries = () => window.history.entries.length;

// 15 with a typed amount: the draft the drawer must never touch.
async function sellDraft(app) {
  await app.tap(/^Sell$/);
  await app.keys(["1", "2", "5"]);
  assert.equal(app.route, "Sell");
  assert.match(app.text(), /125/);
}

// ---- the header ---------------------------------------------------------------------------------

test("22 header: the Menu button is first (hamburger + Menu, 48px), then the shop name (ellipsis), then the status; no green home tile", async () => {
  const { PosHeader } = await loadJsx("src/pos/PosComponents.jsx");
  const view = render({ type: PosHeader, props: { shopName: "Ama Stores", statusLabel: "", onMenu() {} } });
  const row = [...walk(view.tree)].find((node) => node.type === "div" && /min-h-16/.test(node.props?.className ?? ""));
  const parts = [row.props.children].flat(Infinity).filter((child) => child && typeof child === "object");
  assert.equal(parts[0].type, "button");
  assert.equal(parts[0].props["aria-label"], "Open menu");
  assert.equal(parts[0].props["aria-haspopup"], "dialog");
  assert.match(textOf(parts[0]), /Menu/);
  assert.match(parts[0].props.className, /\bh-12\b/, "48px");
  assert.match(parts[0].props.className, /\bshrink-0\b/);
  assert.equal(parts[1].type, "p");
  assert.equal(textOf(parts[1]), "Ama Stores");
  for (const cls of ["truncate", "min-w-0", "flex-1"]) assert.match(parts[1].props.className, new RegExp(`\\b${cls}\\b`), `shop name ${cls}`);
  assert.match(parts[2].props["aria-label"], /Saved on this phone/, "then the connection status");
  assert.ok(![...walk(view.tree)].some((node) => node.type === "button" && node.props?.["aria-label"] === "Home"), "no header Home tile");
  assert.ok(![...walk(view.tree)].some((node) => /bg-emerald-900/.test(node.props?.className ?? "")), "no green tile");
});

// wide_layout (21 Nov 2026): the sidebar now has every Menu destination, so the Menu button is phone-only.
// The decision is layout.js's (PosApp leaves the header out), never a CSS breakpoint on the button.
// tests/wideShell.test.js checks it in the running app at 767, 768 and wider.
test("the Menu button carries no CSS breakpoint of its own (layout.js decides)", async () => {
  const { PosHeader } = await loadJsx("src/pos/PosComponents.jsx");
  const view = render({ type: PosHeader, props: { shopName: "Shop", statusLabel: "", onMenu() {} } });
  const menu = [...walk(view.tree)].find((node) => node.props?.["aria-label"] === "Open menu");
  assert.doesNotMatch(menu.props.className, /(sm|md|lg|xl):hidden/);
});

test("25: the header behind the Collect sheet is covered by the sheet (z-50 over the header's z-30)", () => {
  assert.match(read("src/pos/DebtCollection.jsx"), /fixed inset-0 z-50/);
  assert.match(read("src/pos/PosComponents.jsx"), /<header className="sticky top-0 z-30/);
});

// ---- the drawer itself --------------------------------------------------------------------------

test("23: a dialog named Menu, 320px at most 86%, dimmed page, slide-in 200ms and none with reduced motion", async () => {
  const app = await open();
  await app.tap("Open menu");
  const dialog = app.drawer();
  assert.ok(dialog, "the drawer opened");
  assert.equal(dialog.props["aria-modal"], "true");
  for (const cls of ["w-[320px]", "max-w-[86%]", "left-0", "inset-y-0", "bg-white", "pos-drawer"]) assert.ok(dialog.props.className.split(" ").includes(cls), cls);
  assert.equal(scrim(app).props.style.backgroundColor, "rgba(15, 23, 42, 0.55)");
  assert.match(drawerRoot(app).props.className, /fixed inset-0 z-40/, "over the page, the header (z-30) and the bottom bar (z-30)");
  const css = read("src/styles.css");
  assert.match(css, /\.pos-drawer \{\s*animation: pos-drawer-in 200ms ease-out;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.pos-drawer \{\s*animation: none;/);
});

test("23 top: home tile, shop name (ellipsis), the date dd/mm/yyyy with the weekday, a 48px Close button", async () => {
  const { default: MenuDrawer } = await loadJsx("src/pos/MenuDrawer.jsx");
  const view = render({ type: MenuDrawer, props: { current: "Home", shopName: "Ama Stores", onClose() {}, onChoose() {}, now: new Date(2026, 10, 12, 9, 0).getTime() } });
  const text = textOf(view.tree);
  assert.match(text, /Ama Stores/);
  assert.match(text, /Thursday 12\/11\/2026/);
  const close = [...walk(view.tree)].find((node) => node.props?.["aria-label"] === "Close menu");
  assert.match(close.props.className, /\bh-12\b/);
  assert.match(close.props.className, /\bw-12\b/);
  const name = [...walk(view.tree)].find((node) => node.type === "span" && textOf(node) === "Ama Stores");
  assert.match(name.props.className, /\btruncate\b/);
});

test("23 rows: Home, Today’s transactions, My money, Items, a divider, Settings; at least 60px; no Language row", async () => {
  const app = await open();
  await app.tap("Open menu");
  const dialog = app.drawer();
  const buttons = [...walk(dialog)].filter((node) => node.type === "button" && node.props?.["aria-label"] !== "Close menu");
  assert.deepEqual(buttons.map(textOf), ["Home", "Today’s transactions" + "Money in, spent, owed", "My money" + "Week and month report", "Items" + "Things you sell", "Settings"]);
  for (const button of buttons) assert.match(button.props.className, /min-h-\[60px\]/);
  assert.doesNotMatch(textOf(dialog), /Language/);
  const divider = [...walk(dialog)].find((node) => node.type === "div" && /h-px/.test(node.props?.className ?? ""));
  assert.ok(divider, "a divider");
  const order = [...walk(dialog)].filter((node) => node === divider || buttons.includes(node));
  assert.equal(order.indexOf(divider), 4, "the divider sits just before Settings");
});

test("23: the row for the current page is highlighted green (Home on 22, Settings on 47); nothing on 15", async () => {
  const app = await open();
  await app.tap("Open menu");
  const highlighted = () => [...walk(app.drawer())].filter((node) => node.type === "button" && node.props?.["aria-current"] === "page");
  assert.deepEqual(highlighted().map(textOf), ["Home"]);
  assert.match(highlighted()[0].props.className, /border-emerald-900 bg-emerald-100 text-emerald-900/);
  await app.menu("Settings");
  await app.tap("Open menu");
  assert.deepEqual(highlighted().map(textOf), ["Settings"]);
  await app.tap("Close menu");
  await app.goHome();
  await sellDraft(app);
  await app.tap("Open menu");
  assert.deepEqual(highlighted(), []);
});

// ---- opening and closing --------------------------------------------------------------------------

const CLOSERS = {
  "the X": (app) => app.tap("Close menu"),
  "a tap on the dimmed page": async (app) => { scrim(app).props.onClick(); return app.settle(); },
  "Escape": async (app) => { assert.equal(press("Escape").defaultPrevented, true); return app.settle(); },
  "the phone's Back": (app) => app.phoneBack()
};

for (const [name, close] of Object.entries(CLOSERS)) {
  test(`23: open, then close with ${name}: 15 and its draft are exactly as they were, no history entry`, async () => {
    const app = await open();
    await sellDraft(app);
    const before = snapshot(app);
    const shown = app.text();
    await app.tap("Open menu");
    assert.ok(app.drawer(), "open");
    assert.equal(snapshot(app), before, "opening is not navigation: route, params and history untouched");
    await close(app);
    assert.equal(app.drawer(), null, "closed");
    assert.equal(snapshot(app), before);
    assert.equal(app.text(), shown, "the page shows the same draft");
  });

  test(`23: on Home with nothing behind, ${name} closes the drawer and stays in the app`, async () => {
    const app = await open();
    await app.tap("Open menu");
    await close(app);
    assert.equal(app.drawer(), null);
    assert.equal(app.route, "Home");
    assert.deepEqual(app.state.history, []);
  });
}

test("23: opening and closing many times adds no in-app entry and at most one browser entry", async () => {
  const app = await open();
  await sellDraft(app);
  const before = snapshot(app);
  const entries = browserEntries();
  for (let index = 0; index < 5; index += 1) {
    await app.tap("Open menu");
    await app.tap("Close menu");
  }
  assert.equal(snapshot(app), before);
  assert.equal(browserEntries(), entries, "no browser entry either");
  await app.phoneBack();
  assert.equal(app.route, "Home", "one Back is the page's own Back");
});

// ---- the rows ------------------------------------------------------------------------------------

const DESTINATIONS = [
  ["Settings", "SettingsProfitTools"],
  ["Items", "MyItems"],
  ["My money", "MyMoney"],
  ["Today’s transactions", "TodaysTransactions"]
];

for (const [label, route] of DESTINATIONS) {
  for (const [how, back] of [["Back", (app) => app.tap(/^\u2039 Back$|^Back$/)], ["the phone's Back", (app) => app.phoneBack()]]) {
    test(`15 > Menu > ${label} > ${how} returns to 15 with its draft (not to the drawer, not Home)`, async () => {
      const app = await open();
      await sellDraft(app);
      const before = snapshot(app);
      const shown = app.text();
      await app.menu(label);
      assert.equal(app.drawer(), null, "choosing a row closes the drawer");
      assert.equal(app.route, route);
      assert.equal(app.state.history.length, JSON.parse(before).history.length + 1, "one screen pushed on 15");
      await back(app);
      assert.equal(app.drawer(), null, "the drawer does not come back");
      assert.equal(snapshot(app), before);
      assert.equal(app.text(), shown);
    });
  }
}

test("22 > Menu > Settings > Back returns to Home; Today’s transactions and My money Back from Home go Home (24, 33)", async () => {
  const app = await open();
  for (const [label, route] of DESTINATIONS) {
    await app.menu(label);
    assert.equal(app.route, route);
    await app.tap(/^\u2039 Back$|^Back$/);
    assert.equal(app.route, "Home", label);
    assert.deepEqual(app.state.history, []);
  }
});

test("15 > Menu > Home leaves the draft (the header Home rule)", async () => {
  const app = await open();
  await sellDraft(app);
  await app.menu("Home");
  assert.equal(app.drawer(), null);
  assert.equal(app.route, "Home");
  assert.deepEqual(app.state.history, []);
  await app.tap(/^Sell$/);
  assert.doesNotMatch(app.text(), /125/, "a new sale starts empty");
});

test("the row for the page already showing only closes the drawer", async () => {
  const app = await open();
  await app.menu("Settings");
  const before = snapshot(app);
  await app.menu("Settings");
  assert.equal(app.drawer(), null);
  assert.equal(snapshot(app), before, "no second Settings pushed");
  await app.menu("Home");
  await app.menu("Home");
  assert.equal(app.route, "Home");
  assert.deepEqual(app.state.history, []);
});

// ---- focus -----------------------------------------------------------------------------------------

function fakeElement(name, log) {
  return { name, focus() { log.push(name); globalThis.document.activeElement = this; } };
}

test("23 focus: moves to Close when the drawer opens; Tab and Shift+Tab stay inside; Escape closes", async () => {
  const { default: MenuDrawer } = await loadJsx("src/pos/MenuDrawer.jsx");
  const log = [];
  let closes = 0;
  const view = render({ type: MenuDrawer, props: { current: "Home", shopName: "Shop", onClose: () => { closes += 1; }, onChoose() {} } });
  const close = [...walk(view.tree)].find((node) => node.props?.["aria-label"] === "Close menu");
  const panel = [...walk(view.tree)].find((node) => node.type === "aside");
  const first = fakeElement("close", log);
  const last = fakeElement("settings", log);
  const inside = new Set([first, last]);
  close.props.ref.current = first;
  panel.props.ref.current = { querySelectorAll: () => [first, last], contains: (element) => inside.has(element) };
  flushEffects(view, { tracked: true });
  assert.deepEqual(log, ["close"], "focus moved into the drawer");
  globalThis.document.activeElement = last;
  assert.equal(press("Tab").defaultPrevented, true);
  assert.equal(globalThis.document.activeElement, first, "Tab on the last goes to the first");
  assert.equal(press("Tab", true).defaultPrevented, true);
  assert.equal(globalThis.document.activeElement, last, "Shift+Tab on the first goes to the last");
  globalThis.document.activeElement = { name: "page behind" };
  press("Tab");
  assert.equal(globalThis.document.activeElement, first, "focus that escaped is brought back in");
  press("Escape");
  assert.equal(closes, 1);
});

test("23 focus: returns to the header Menu button when the drawer closes", async () => {
  const app = await open();
  const log = [];
  const menuButton = [...walk(app.view.tree)].find((node) => node.props?.["aria-label"] === "Open menu");
  menuButton.props.ref.current = fakeElement("menu button", log);
  await app.tap("Open menu");
  assert.equal(menuButton.props["aria-expanded"], false, "the old render");
  assert.equal([...walk(app.view.tree)].find((node) => node.props?.["aria-label"] === "Open menu").props["aria-expanded"], true);
  await app.tap("Close menu");
  assert.deepEqual(log, ["menu button"]);
});

// ---- the route table ---------------------------------------------------------------------------------

test("the Menu page is gone from the route table; PosApp draws MenuDrawer, not a Menu page", () => {
  assert.equal(POS_ROUTES.Menu, undefined);
  const app = read("src/pos/PosApp.jsx");
  // wide_layout (21 Nov 2026): the drawer belongs to the phone layout only (layout.js).
  assert.match(app, /\{!layout\.wide && menuOpen && <MenuDrawer current=\{route\} shopName=\{shopName\} onClose=\{closeMenu\} onChoose=\{chooseFromMenu\} \/>\}/);
  assert.doesNotMatch(app, /POS_ROUTES\.Menu\b/);
  assert.doesNotMatch(app, /from "\.\/Menu\.jsx"/);
  assert.match(app, /useBackHandler\(menuOpen, /, "the phone's Back closes the drawer");
  assert.match(app, /<SettingsProfitTools[\s\S]*?onBack=\{navigateBack\}/);
  assert.match(app, /<TodaysTransactions onBack=\{navigateBack\} layout=\{layout\} \/>/);
  // wide_layout (21 Nov 2026): the layout (layout.js) is passed down; the destinations are unchanged.
  assert.match(app, /<MyMoney onNavigate=\{navigate\} onBack=\{navigateBack\} layout=\{layout\} \/>/);
  assert.doesNotMatch(app, /LanguageSettings/, "the Language screen is removed (voice entry was dropped)");
});

test("47 Done calls the same handler as Back", async () => {
  const { SettingsProfitTools } = await loadJsx("src/pos/SettingsScreens.jsx");
  let backs = 0;
  const view = render({ type: SettingsProfitTools, props: { shopName: "My shop", onShopNameChange() {}, onOpenBackup() {}, onOpenMomoSettings() {}, onOpenPlan() {}, onOpenSubscription() {}, onBack: () => { backs += 1; } } });
  const exact = (label) => [...walk(view.tree)].find((node) => node.type === "button" && textOf(node).replace(/^\u2039\s*/, "") === label);
  exact("Done").props.onClick();
  exact("Back").props.onClick();
  assert.equal(backs, 2, "Done and Back are the same");
});

// ---- 340, 360 and 393px ------------------------------------------------------------------------------
// node cannot lay out a page; these guard what decides the fit (a real browser render at the three
// widths is in the item report). Drawer: 320px but never more than 86% (292px at 340). Header: the
// Menu button and the status do not shrink, the shop name takes what is left and cuts with an ellipsis.

test("340/360/393px: the drawer never exceeds 86% of the screen and its rows wrap instead of overflowing", async () => {
  const { default: MenuDrawer } = await loadJsx("src/pos/MenuDrawer.jsx");
  const view = render({ type: MenuDrawer, props: { current: "Home", shopName: "A very long shop name that would never fit on one line", onClose() {}, onChoose() {} } });
  const panel = [...walk(view.tree)].find((node) => node.type === "aside");
  for (const width of [340, 360, 393]) assert.ok(Math.min(320, width * 0.86) <= width - 40, `${width}px: a strip of the page stays visible`);
  assert.match(panel.props.className, /max-w-\[86%\]/);
  for (const node of [...walk(view.tree)].filter((item) => item.type === "button" && /min-h-\[60px\]/.test(item.props?.className ?? ""))) {
    assert.match(node.props.className, /\bw-full\b/);
    const label = [...walk(node)].find((item) => item.type === "span" && /flex-1/.test(item.props?.className ?? ""));
    assert.match(label.props.className, /\bmin-w-0\b/, "the label can shrink and wrap");
  }
});
