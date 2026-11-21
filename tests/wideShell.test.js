import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { createRouteState, phoneBackState, POS_ROUTES, pushRoute, VIA_SIDEBAR } from "../src/pos/routes.js";
import { getLayout, getLayoutMode, LAYOUT_BREAKPOINTS, readLayout, WIDE_CONTENT_MAX_PX } from "../src/pos/layout.js";
import { formatWeekdayDate } from "../src/lib/formatDate.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { loadJsx, render, textOf, walk } from "./helpers/renderJsx.js";

// rules_global.wide_layout breakpoints, shell and layout_mode_function (decided 21 Nov 2026):
//   below 768px phone (header, Menu button, bottom bar, Menu drawer: unchanged), 768 to 1279px an 84px
//   icon rail, 1280px and up a 300px sidebar; the width alone decides, in layout.js, read in one place.
//   The sidebar replaces the header, the bottom bar and the Menu; every Menu destination is in it.
//   A sidebar tap pushes like the Menu (the draft stays, Back returns); Home follows the header Home rule;
//   the page already showing does nothing. First-run setup shows no sidebar.

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

globalThis.localStorage ??= (() => {
  const store = new Map();
  return { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: (key) => store.delete(key), clear: () => store.clear() };
})();

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  resetBrowserBack();
  localStorage.clear();
  localStorage.setItem("storekeeper-shop-name", "Ama Stores");
  await Promise.all([db.debts, db.customers, db.transactions, db.settings].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
});

async function open(width) {
  const app = await openPosApp({ width });
  after(() => app.restoreConsole());
  return app;
}

const has = (app, predicate) => [...walk(app.view.tree)].some(predicate);
const hasHeader = (app) => has(app, (node) => node.type === "header");
const hasMenuButton = (app) => has(app, (node) => node.type === "button" && node.props?.["aria-label"] === "Open menu");
const hasBottomBar = (app) => has(app, (node) => node.type === "nav" && node.props?.["aria-label"] === "Main navigation" && !node.props?.["data-side-nav"]);

// ---- the one decision ---------------------------------------------------------------------------------

test("getLayoutMode: below 768 phone, 768 to 1279 rail, 1280 and up sidebar; the width alone decides", () => {
  const expected = { 0: "phone", 340: "phone", 767: "phone", 768: "rail", 1023: "rail", 1024: "rail", 1279: "rail", 1280: "sidebar", 1440: "sidebar", 2560: "sidebar" };
  for (const [width, mode] of Object.entries(expected)) assert.equal(getLayoutMode(Number(width)), mode, `${width}px`);
  assert.equal(getLayoutMode(undefined), "phone", "no width is the phone");
  assert.equal(getLayoutMode.length, 1, "one input: the width (no touch, no orientation)");
  assert.deepEqual(LAYOUT_BREAKPOINTS, { rail: 768, wideMyMoney: 1024, sidebar: 1280 });
});

test("getLayout: My money is wide from 1024px only (wide_layout.screens 33)", () => {
  assert.deepEqual({ ...getLayout(767) }, { mode: "phone", wide: false, wideMyMoney: false });
  assert.deepEqual({ ...getLayout(768) }, { mode: "rail", wide: true, wideMyMoney: false });
  assert.deepEqual({ ...getLayout(1023) }, { mode: "rail", wide: true, wideMyMoney: false });
  assert.deepEqual({ ...getLayout(1024) }, { mode: "rail", wide: true, wideMyMoney: true });
  assert.deepEqual({ ...getLayout(1280) }, { mode: "sidebar", wide: true, wideMyMoney: true });
  assert.equal(readLayout({ innerWidth: 1300 }).mode, "sidebar");
  assert.equal(readLayout(undefined).mode, "phone");
});

// Source files that may decide or read the layout width: layout.js only.
function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(js|jsx|css)$/.test(name) ? [path] : [];
  });
}

test("no second implementation: only layout.js reads the width or names the breakpoints", () => {
  const offenders = [];
  for (const path of sourceFiles(join(root, "src"))) {
    const file = relative(root, path).replace(/\\/g, "/");
    if (file === "src/pos/layout.js") continue;
    const text = readFileSync(path, "utf8");
    // SignatureBox redraws its canvas on resize; that is drawing, not layout (it reads no width).
    if (/matchMedia|innerWidth|outerWidth|screen\.width|documentElement\.clientWidth/.test(text)) offenders.push(`${file}: reads the window width`);
    if (/\b(768|1023|1279|1280)\b/.test(text)) offenders.push(`${file}: names a layout breakpoint`);
    if (/getLayoutMode\(/.test(text) && file !== "src/pos/PosApp.jsx") offenders.push(`${file}: decides the mode itself`);
  }
  assert.deepEqual(offenders, []);
  const app = read("src/pos/PosApp.jsx");
  assert.equal(app.match(/useLayout\(\)/g)?.length, 1, "PosApp calls the hook once");
  for (const path of sourceFiles(join(root, "src"))) {
    const file = relative(root, path).replace(/\\/g, "/");
    if (file === "src/pos/PosApp.jsx" || file === "src/pos/layout.js") continue;
    assert.doesNotMatch(readFileSync(path, "utf8"), /useLayout\(/, `${file} does not read the layout itself (PosApp passes it down)`);
  }
});

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} exists`);
  const rest = source.slice(start + 10);
  const ends = ["\nexport ", "\nfunction ", "\nconst "].map((marker) => rest.indexOf(marker)).filter((index) => index >= 0);
  return ends.length ? rest.slice(0, Math.min(...ends)) : rest;
}

test("the shell has no CSS breakpoint of its own (header, bottom bar, sidebar, drawer, PosApp)", () => {
  const components = read("src/pos/PosComponents.jsx");
  for (const name of ["PosHeader", "PosBottomNav", "PosSideNav", "SideRow", "SideConnectionStatus"]) {
    assert.doesNotMatch(functionBody(components, name), /\b(md|lg|xl|2xl):/, `${name}`);
  }
  assert.doesNotMatch(read("src/pos/MenuDrawer.jsx"), /\b(md|lg|xl|2xl):/);
  assert.doesNotMatch(read("src/pos/PosApp.jsx"), /\b(md|lg|xl|2xl):/);
});

// ---- every Menu destination is reachable at every width -----------------------------------------------

const WIDTHS = [767, 768, 1023, 1024, 1279, 1280, 1440];
// MENU_ROWS (the drawer, wiring 23) and where each one lands.
const DESTINATIONS = [
  { menu: "Home", route: "Home" },
  { menu: "Today’s transactions", route: "TodaysTransactions" },
  { menu: "My money", route: "MyMoney" },
  { menu: "Items", route: "MyItems" },
  { menu: "Settings", route: "SettingsProfitTools" }
];

test("the sidebar holds every Menu drawer row, in the shell order", async () => {
  const { MENU_ROWS } = await loadJsx("src/pos/MenuDrawer.jsx");
  const { SIDEBAR_ROWS } = await loadJsx("src/pos/PosComponents.jsx");
  assert.deepEqual(SIDEBAR_ROWS.map((row) => row.route), ["Home", "Sell", "PeopleWhoOweYou", "TodaysTransactions", "MyMoney", "MyItems", "SettingsProfitTools"]);
  for (const row of MENU_ROWS) {
    const side = SIDEBAR_ROWS.find((item) => item.route === row.route);
    assert.ok(side, `${row.route} is in the sidebar`);
    assert.equal(side.label, row.label, `${row.route}: same label as the Menu`);
  }
  assert.equal(SIDEBAR_ROWS.at(-1).route, "SettingsProfitTools", "Settings at the bottom");
  assert.equal(SIDEBAR_ROWS.at(-1).bottom, true);
});

for (const width of WIDTHS) {
  test(`${width}px: every Menu destination is reachable; the Menu button ${width >= 768 ? "is hidden" : "shows"}`, async () => {
    const mode = getLayoutMode(width);
    for (const { menu, route } of DESTINATIONS) {
      resetBrowserBack();
      const app = await open(width);
      assert.equal(app.route, "Home");
      if (mode === "phone") {
        assert.equal(hasMenuButton(app), true, "the phone keeps the Menu button");
        assert.equal(hasHeader(app), true);
        assert.equal(app.sideNav(), null, "no sidebar on the phone");
        if (route === "Home") {
          await app.menu("My money");
          await app.menu("Home");
        } else {
          await app.menu(menu);
        }
      } else {
        assert.equal(hasMenuButton(app), false, "no Menu button from 768px");
        assert.equal(hasHeader(app), false, "no header: the sidebar replaces it");
        assert.equal(hasBottomBar(app), false, "no bottom bar: the sidebar replaces it");
        assert.equal(app.sideNav()?.props["data-side-nav"], mode);
        if (route === "Home") {
          await app.side("MyMoney");
          await app.side("Home");
        } else {
          await app.side(route);
        }
      }
      assert.equal(app.route, route, `${menu} reached`);
      app.restoreConsole();
    }
  });
}

test("the shell renders no stray text (a stray JSX brace took 24px of the phone page area once)", async () => {
  for (const width of [360, 1280]) {
    resetBrowserBack();
    const app = await open(width);
    const shell = [...walk(app.view.tree)].find((node) => node.type === "div" && /\bpos-app\b/.test(node.props?.className ?? ""));
    const strays = (Array.isArray(shell.props.children) ? shell.props.children : [shell.props.children]).filter((child) => typeof child === "string" || typeof child === "number");
    assert.deepEqual(strays, [], `${width}px`);
    app.restoreConsole();
  }
});

test("wide: Sell and Owed are in the sidebar too (they were the bottom bar)", async () => {
  const app = await open(1280);
  await app.side("Sell");
  assert.equal(app.route, "Sell");
  await app.side("PeopleWhoOweYou");
  assert.equal(app.route, "PeopleWhoOweYou");
});

test("wide: the page sits in a centred column 1160px at most", async () => {
  const app = await open(1440);
  const column = [...walk(app.view.tree)].find((node) => node.props?.["data-wide-content"] !== undefined);
  assert.ok(column, "the wide column");
  assert.equal(column.props.style.maxWidth, WIDE_CONTENT_MAX_PX);
  assert.equal(WIDE_CONTENT_MAX_PX, 1160);
  assert.match(column.props.className, /\bmx-auto\b/);
});

// ---- sidebar taps: push like the Menu ----------------------------------------------------------------

test("wide: a sidebar tap keeps the Sell draft; Back returns to it", async () => {
  const app = await open(1280);
  await app.side("Sell");
  await app.keys(["1", "2", "5"]);
  assert.match(app.text(), /GH₵125\.00/);
  await app.side("TodaysTransactions");
  assert.equal(app.route, "TodaysTransactions");
  await app.phoneBack();
  assert.equal(app.route, "Sell");
  assert.match(app.text(), /GH₵125\.00/, "the typed amount is still there");
});

test("Owed: Back goes Home on the phone; from the sidebar it returns to the page Owed was opened on", () => {
  const fromSell = pushRoute(createRouteState(POS_ROUTES.Sell, { amountPesewas: 12500 }), POS_ROUTES.PeopleWhoOweYou, {});
  assert.equal(phoneBackState(fromSell).current, "Home", "phone: Owed's Back is Home, as before");
  const viaSidebar = pushRoute(createRouteState(POS_ROUTES.Sell, { amountPesewas: 12500 }), POS_ROUTES.PeopleWhoOweYou, { [VIA_SIDEBAR]: true });
  const back = phoneBackState(viaSidebar);
  assert.equal(back.current, "Sell");
  assert.equal(back.params.amountPesewas, 12500, "the draft is back");
});

test("wide: Owed from the sidebar, then the phone (browser) back, returns to Sell with its draft", async () => {
  const app = await open(1280);
  await app.side("Sell");
  await app.keys(["1", "2", "5"]);
  await app.side("PeopleWhoOweYou");
  await app.phoneBack();
  assert.equal(app.route, "Sell");
  assert.match(app.text(), /GH₵125\.00/, "the typed amount is still there");
});

test("wide: Home from the sidebar leaves the draft (the header Home rule)", async () => {
  const app = await open(1280);
  await app.side("Sell");
  await app.keys(["1", "2", "5"]);
  await app.side("Home");
  assert.equal(app.route, "Home");
  assert.equal(app.state.history.length, 0, "a fresh stack, as the header Home");
});

test("wide: the row for the page already showing does nothing", async () => {
  const app = await open(1280);
  await app.side("Sell");
  await app.keys(["7"]);
  const before = JSON.stringify(app.state);
  const entries = window.history.entries.length;
  await app.side("Sell");
  assert.equal(JSON.stringify(app.state), before);
  assert.equal(window.history.entries.length, entries, "no history entry");
});

test("wide: first-run setup shows no sidebar and no header", async () => {
  await setPreference("posSetupCompleted", false);
  const app = await open(1280);
  assert.equal(app.route, "HowDoYouWantToSell");
  assert.equal(app.sideNav(), null);
  assert.equal(hasHeader(app), false);
});

// ---- the sidebar and the rail themselves --------------------------------------------------------------

const NOW = new Date(2026, 10, 12, 10, 0).getTime();

async function sideNav(props) {
  const { PosSideNav } = await loadJsx("src/pos/PosComponents.jsx");
  return render({ type: PosSideNav, props: { current: "Home", onNavigate() {}, shopName: "Ama Stores", now: NOW, ...props } });
}
const rows = (view) => [...walk(view.tree)].filter((node) => node.type === "button" && node.props?.["data-side-row"]);

test("sidebar (1280+): 300px, shop name with the weekday date, labels 18px bold on one line, rows 54px", async () => {
  const view = await sideNav({ mode: "sidebar" });
  const nav = [...walk(view.tree)].find((node) => node.type === "nav");
  assert.match(nav.props.className, /\bw-\[300px\]/);
  assert.equal(textOf([...walk(view.tree)].find((node) => node.props?.["data-side-shop"] !== undefined)), "Ama Stores");
  assert.equal(textOf([...walk(view.tree)].find((node) => node.props?.["data-side-date"] !== undefined)), formatWeekdayDate(NOW));
  assert.equal(formatWeekdayDate(NOW), "Thursday 12/11/2026");
  const labels = rows(view).map((row) => textOf(row).trim());
  assert.deepEqual(labels, ["Home", "Sell", "Owed", "Today’s transactions", "My money", "Items", "Settings"]);
  for (const row of rows(view)) {
    for (const cls of ["min-h-[54px]", "text-[18px]", "font-extrabold", "whitespace-nowrap"]) assert.ok(row.props.className.split(/\s+/).includes(cls), `${textOf(row)}: ${cls}`);
  }
  const text = textOf(view.tree);
  assert.ok(text.indexOf("Settings") < text.indexOf("Online"), "Settings, then the connection status");
});

test("rail (768 to 1279): 84px, icons only, 60px targets, accessible names", async () => {
  const view = await sideNav({ mode: "rail" });
  const nav = [...walk(view.tree)].find((node) => node.type === "nav");
  assert.match(nav.props.className, /\bw-\[84px\]/);
  for (const row of rows(view)) {
    assert.ok(row.props["aria-label"], "an accessible name");
    assert.equal(textOf(row).trim(), "", `${row.props["aria-label"]}: icon only`);
    for (const cls of ["h-[60px]", "w-[60px]"]) assert.ok(row.props.className.split(/\s+/).includes(cls), `${row.props["aria-label"]}: ${cls}`);
  }
  assert.deepEqual(rows(view).map((row) => row.props["aria-label"]), ["Home", "Sell", "Owed", "Today’s transactions", "My money", "Items", "Settings"]);
});

for (const mode of ["sidebar", "rail"]) {
  test(`${mode}: the active row has a light green background AND a green outline; the others neither`, async () => {
    const view = await sideNav({ mode, current: "MyMoney" });
    for (const row of rows(view)) {
      const classes = row.props.className.split(/\s+/);
      const active = row.props["data-side-row"] === "MyMoney";
      assert.equal(row.props["aria-current"], active ? "page" : undefined);
      assert.ok(classes.includes("border-2"), "every row has the 2px border, so nothing moves");
      assert.equal(classes.includes("bg-emerald-100"), active, `${row.props["data-side-row"]}: background`);
      assert.equal(classes.includes("border-emerald-900"), active, `${row.props["data-side-row"]}: outline`);
      if (!active) assert.ok(classes.includes("border-transparent"));
    }
  });
}

test("the sidebar keeps the connection status (Saved on this device; 62 leaves it out)", async () => {
  const view = await sideNav({ mode: "sidebar" });
  assert.match(textOf(view.tree), /Saved on this device/);
  const hidden = await sideNav({ mode: "sidebar", hideSaved: true });
  assert.doesNotMatch(textOf(hidden.tree), /Saved on this device/);
});
