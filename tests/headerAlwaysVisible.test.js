import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, beforeEach, test } from "node:test";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { setLiveQuery, walk } from "./helpers/renderJsx.js";

globalThis.HTMLElement ??= class {};

// rules_global.header_always_visible (14 Nov 2026): on a real phone the sticky header scrolled away
// with a long Home, taking the Menu button with it. Cause: .pos-app, the header's parent, had
// overflow-x: hidden (in theme.css and as a class). A box with overflow hidden on one axis gets
// overflow auto on the other, so it becomes a scroll container; the sticky header then sticks inside
// .pos-app, which never scrolls itself (it grows with the page), while the document is what scrolls.
// overflow-x: clip cuts the sideways overflow without making a scroll container.

const root = fileURLToPath(new URL("..", import.meta.url));

let liveResults = new Map();
setLiveQuery((deps, query) => {
  const key = `${String(query)}|${JSON.stringify(deps)}`;
  if (!liveResults.has(key)) {
    liveResults.set(key, undefined);
    Promise.resolve().then(query).then((value) => liveResults.set(key, value), () => liveResults.set(key, null));
  }
  return liveResults.get(key);
});

after(async () => {
  db.close();
  await db.delete();
});

const NAMES = ["Ama", "Kofi", "Akosua", "Yaw", "Efua", "Kwame", "Abena", "Kojo", "Esi", "Kwesi", "Adwoa", "Fiifi"];

beforeEach(async () => {
  resetBrowserBack();
  liveResults = new Map();
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
  await db.settings.put({ key: "momoReceivingNumber", value: "0241234567" });
  await db.settings.put({ key: "momoReceivingNetwork", value: "MTN" });
  // Enough people owing (some late, some not) that Home and the Owed list are longer than a phone screen.
  for (let index = 0; index < 36; index += 1) {
    const name = `${NAMES[index % NAMES.length]} ${String.fromCharCode(65 + Math.floor(index / NAMES.length))}`;
    await recordCreditSale({ name, amountPesewas: 1000 + index * 137, now: Date.now() - (index % 9) * 86_400_000 });
  }
});

async function open() {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  return app;
}

async function goTo(app, route) {
  if (route === "Home") return app;
  const home = [...walk(app.view.tree)].find((node) => node.type?.name === "Home");
  home.props.onNavigate(route);
  await app.settle();
  assert.equal(app.route, route);
  return app;
}

// The host elements from the root down to the <header>, header last.
function pathToHeader(tree) {
  const search = (node, trail) => {
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = search(child, trail);
        if (found) return found;
      }
      return null;
    }
    if (!node || typeof node !== "object") return null;
    const next = typeof node.type === "string" ? [...trail, node] : trail;
    if (node.type === "header") return next;
    return search("rendered" in node ? node.rendered : node.props?.children, next);
  };
  return search(tree, []);
}

// ---- structure: nothing above the header clips or scrolls ------------------------------------------

const SCROLLING_CLASS = /(^|\s)(overflow|overflow-x|overflow-y)-(hidden|auto|scroll)(\s|$)/;

function cssRulesFor(css, className) {
  const rules = [];
  const pattern = new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`, "g");
  for (const match of css.matchAll(pattern)) rules.push(match[1]);
  return rules;
}

test("the header has no ancestor that clips or scrolls (Home, Sell, Owed list, People who owe you)", async () => {
  const app = await open();
  const themeCss = readFileSync(join(root, "src/pos/theme.css"), "utf8");
  for (const route of ["Home", "Sell", "PeopleWhoOweYou"]) {
    if (route === "Sell") await app.tap("Sell");
    else if (route !== "Home") { await app.goHome(); await goTo(app, route); }
    const trail = pathToHeader(app.view.tree);
    assert.ok(trail, `${route}: a header is rendered`);
    const header = trail.at(-1);
    assert.match(header.props.className, /(^|\s)sticky(\s|$)/, `${route}: the header is sticky`);
    assert.match(header.props.className, /(^|\s)top-0(\s|$)/);
    assert.match(header.props.className, /(^|\s)z-30(\s|$)/, `${route}: above content (z-30), below the drawer (z-40) and dialogs (z-50+)`);
    assert.match(header.props.className, /border-b-\[3px\]/, `${route}: 3px bottom border`);
    assert.match(header.props.className, /env\(safe-area-inset-top\)/, `${route}: safe-area inset`);
    for (const ancestor of trail.slice(0, -1)) {
      const className = ancestor.props?.className ?? "";
      assert.doesNotMatch(className, SCROLLING_CLASS, `${route}: <${ancestor.type} class="${className}"> above the header must not clip or scroll`);
      for (const name of className.split(/\s+/).filter(Boolean)) {
        for (const body of cssRulesFor(themeCss, name)) {
          assert.doesNotMatch(body, /overflow(-x|-y)?\s*:\s*(hidden|auto|scroll)/, `theme.css .${name} must not clip or scroll (the header is inside it)`);
        }
      }
    }
  }
  const styles = readFileSync(join(root, "src/styles.css"), "utf8");
  assert.doesNotMatch(styles, /(html|body|#root)\s*\{[^}]*overflow/, "html, body and #root do not set overflow");
});

test("the drawer and dialogs sit above the header", () => {
  const drawer = readFileSync(join(root, "src/pos/MenuDrawer.jsx"), "utf8");
  assert.match(drawer, /fixed inset-0 z-40/);
  const dialog = readFileSync(join(root, "src/pos/LeaveDraftDialog.jsx"), "utf8");
  assert.match(dialog, /fixed inset-0 z-50/);
});

// ---- a real browser: scroll a long Home and a long Owed list ---------------------------------------

const BROWSERS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
];
const browser = process.env.HEADER_TEST_BROWSER || BROWSERS.find((path) => existsSync(path));

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const SVG = new Set(["svg", "path", "circle", "line", "rect", "polyline", "polygon", "g", "ellipse"]);
const UNITLESS = new Set(["fontWeight", "lineHeight", "opacity", "zIndex", "flex", "flexGrow", "flexShrink", "order"]);
const escapeHtml = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kebab = (name) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

// The test renderer's tree as HTML, close enough for layout: tags, classes, styles, attributes, text.
function toHtml(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return escapeHtml(node);
  if (Array.isArray(node)) return node.map(toHtml).join("");
  if ("rendered" in node) return toHtml(node.rendered);
  if (typeof node.type !== "string") return toHtml(node.props?.children);
  const tag = node.type;
  const attributes = [];
  for (const [name, value] of Object.entries(node.props ?? {})) {
    if (name === "children" || name === "key" || name === "ref" || name === "dangerouslySetInnerHTML" || typeof value === "function" || value == null || value === false) continue;
    if (name === "style") {
      const css = Object.entries(value).map(([prop, val]) => `${kebab(prop)}:${typeof val === "number" && !UNITLESS.has(prop) ? `${val}px` : val}`).join(";");
      attributes.push(`style="${escapeHtml(css)}"`);
      continue;
    }
    let attribute = name === "className" ? "class" : name === "htmlFor" ? "for" : name;
    if (!attribute.includes("-") && attribute !== "viewBox") attribute = SVG.has(tag) ? kebab(attribute) : attribute.toLowerCase();
    attributes.push(value === true ? attribute : `${attribute}="${escapeHtml(value)}"`);
  }
  const open = `<${tag}${attributes.length ? ` ${attributes.join(" ")}` : ""}>`;
  if (VOID.has(tag)) return open;
  const inner = node.props?.dangerouslySetInnerHTML?.__html ?? toHtml(node.props?.children);
  return `${open}${inner}</${tag}>`;
}

async function appCss() {
  const base = join(root, "src");
  const compiler = await compile(readFileSync(join(base, "styles.css"), "utf8"), { base, onDependency() {} });
  const scanner = new Scanner({ sources: [...compiler.sources, { base, pattern: "**/*", negated: false }] });
  return compiler.build(scanner.scan()) + readFileSync(join(base, "pos/theme.css"), "utf8");
}

const WIDTHS = [340, 360, 393, 768, 1280];
const HEIGHT = 640;

// Each page goes in iframes of each width (a headless window will not size below ~500px); in each,
// the document is scrolled down and the header's place on screen and every ancestor's overflow are read.
function measuringPage(pages, css) {
  const docs = pages.map(({ name, html }) => ({ name, doc: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>${css}</style></head><body><div id="root">${html}</div></body></html>` }));
  const frames = docs.flatMap(({ name, doc }) => WIDTHS.map((width) => `<iframe data-page="${name}" data-width="${width}" style="width:${width}px;height:${HEIGHT}px;border:0;display:block" srcdoc="${escapeHtml(doc)}"></iframe>`)).join("");
  const script = `
    function measure(frame) {
      const win = frame.contentWindow;
      const doc = frame.contentDocument;
      const header = doc.querySelector("header");
      for (const el of doc.querySelectorAll("*")) for (const a of el.getAnimations ? el.getAnimations() : []) a.finish();
      const scroller = doc.scrollingElement;
      const before = header.getBoundingClientRect();
      const ancestors = [];
      for (let el = header.parentElement; el; el = el.parentElement) {
        const s = win.getComputedStyle(el);
        ancestors.push({ tag: el.tagName.toLowerCase(), cls: el.className, x: s.overflowX, y: s.overflowY });
      }
      const scrollable = scroller.scrollHeight - win.innerHeight;
      const positions = [];
      for (const y of [200, 600, 1200, scroller.scrollHeight]) {
        win.scrollTo(0, y);
        const r = header.getBoundingClientRect();
        positions.push({ scrollY: Math.round(win.scrollY), top: r.top, bottom: r.bottom });
      }
      const menu = doc.querySelector('header button[aria-label="Open menu"], header button[aria-label="Home"]');
      win.scrollTo(0, scroller.scrollHeight);
      const m = menu ? menu.getBoundingClientRect() : null;
      return { page: frame.dataset.page, width: Number(frame.dataset.width), innerWidth: win.innerWidth, headerHeight: before.height, position: win.getComputedStyle(header).position, scrollable, positions, menuTopAtBottom: m && m.top, menuBottomAtBottom: m && m.bottom, ancestors };
    }
    let pending = document.querySelectorAll("iframe").length;
    const results = [];
    for (const frame of document.querySelectorAll("iframe")) {
      const done = () => { results.push(measure(frame)); if (--pending === 0) { const out = document.createElement("pre"); out.id = "out"; out.textContent = JSON.stringify(results); document.body.appendChild(out); } };
      if (frame.contentDocument && frame.contentDocument.readyState === "complete" && frame.contentDocument.querySelector("header")) done(); else frame.addEventListener("load", done, { once: true });
    }`;
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">${frames}<script>${script}</script></body></html>`;
}

function runBrowser(html) {
  const dir = mkdtempSync(join(tmpdir(), "header-visible-"));
  try {
    const file = join(dir, "page.html");
    writeFileSync(file, html);
    const result = spawnSync(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${join(dir, "profile")}`, "--window-size=1400,900", "--virtual-time-budget=8000", "--dump-dom", pathToFileURL(file).href], { encoding: "utf8", timeout: 90_000, maxBuffer: 64 * 1024 * 1024 });
    const match = /<pre id="out">([\s\S]*?)<\/pre>/.exec(result.stdout ?? "");
    assert.ok(match, `the browser measured the page (status ${result.status}): ${String(result.stderr).slice(0, 400)}`);
    return JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("scrolling a long Home and a long Owed list keeps the header at the top of the screen", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)" }, async () => {
  const app = await open();
  const pages = [{ name: "Home", html: toHtml(app.view.tree) }];
  await goTo(app, "PeopleWhoOweYou");
  pages.push({ name: "Owed", html: toHtml(app.view.tree) });
  const results = runBrowser(measuringPage(pages, await appCss()));
  assert.equal(results.length, pages.length * WIDTHS.length);
  const heights = {};
  for (const result of results) {
    const where = `${result.page} at ${result.width}px`;
    assert.equal(result.innerWidth, result.width, `${where}: the frame is that wide`);
    assert.equal(result.position, "sticky", where);
    assert.ok(result.scrollable > 100, `${where}: the page is long enough to scroll (${result.scrollable}px)`);
    for (const { scrollY, top, bottom } of result.positions) {
      assert.ok(scrollY > 0, `${where}: the document scrolled`);
      assert.equal(top, 0, `${where}: header top is 0 after scrolling to ${scrollY}`);
      assert.ok(bottom > 0 && bottom <= HEIGHT, `${where}: header is on screen after scrolling to ${scrollY}`);
    }
    for (const ancestor of result.ancestors) {
      assert.ok(["visible", "clip"].includes(ancestor.x) && ["visible", "clip"].includes(ancestor.y), `${where}: <${ancestor.tag} class="${ancestor.cls}"> is overflow ${ancestor.x}/${ancestor.y}; it makes the header stick inside it`);
    }
    assert.ok(result.menuTopAtBottom >= 0 && result.menuBottomAtBottom <= result.headerHeight, `${where}: the Menu button (or home tile) is on screen at the bottom of the page`);
    heights[`${result.page}@${result.width}`] = result.headerHeight;
  }
  console.log(`header heights (Segoe UI, headless ${browser.split(/[\\/]/).pop()}): ${JSON.stringify(heights)}`);
});
