import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";
import { appCss, browser } from "./helpers/browserLayout.js";

// rules_global.shell_height (16 Nov 2026): the shell is a column exactly the visible screen high
// (100dvh): header flex-none, page area flex-1 with min-height 0 that scrolls by itself. Nothing
// depends on a header height. Real browser (headless Edge or Chrome, Segoe UI, not a phone font), the
// real PosApp at 360x667 and 340x640 on 1, 15, 16, 17, 18, 29 and 72: the document never scrolls; a
// screen longer than the page area scrolls inside it, with the header on screen and the pinned Save
// row (18) on screen. At 393x852 the header, the bottom bar and the Menu stay on screen.

const root = fileURLToPath(new URL("..", import.meta.url));

const ENTRY = `
import { createRoot } from "react-dom/client";
import { db } from "./src/db/db.js";
import { recordCreditSale } from "./src/db/debts.js";
import { setPreference } from "./src/db/preferences.js";
import PosApp from "./src/pos/PosApp.jsx";
window.__errors = [];
const original = console.error;
console.error = (...args) => { window.__errors.push(args.map((a) => String(a?.stack ?? a)).join(" ")); original(...args); };
(async () => {
  await db.delete();
  await db.open();
  await setPreference("posSetupCompleted", true);
  await recordCreditSale({ name: "Amoto", amountPesewas: 2700, creditReason: "Rice", now: Date.now() - 86_400_000 });
  window.__seeded = true;
  createRoot(document.getElementById("root")).render(<PosApp />);
})();
`;

async function bundle() {
  const result = await build({
    stdin: { contents: ENTRY, resolveDir: root, loader: "jsx", sourcefile: "shell-entry.jsx" },
    bundle: true,
    write: false,
    format: "esm",
    splitting: false,
    platform: "browser",
    jsx: "automatic",
    loader: { ".js": "jsx" },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
    nodePaths: [join(root, "node_modules")],
    logLevel: "silent"
  });
  return result.outputFiles[0].text;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, what, ms = 20_000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
}

async function launch(dir) {
  const profile = join(dir, "profile");
  const child = spawn(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"], { stdio: "ignore" });
  const portFile = join(profile, "DevToolsActivePort");
  const port = await waitFor(() => existsSync(portFile) && readFileSync(portFile, "utf8").split(/\r?\n/)[0], "the DevTools port");
  const page = await waitFor(async () => {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      return list.find((target) => target.type === "page");
    } catch {
      return null;
    }
  }, "a page target");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(`${data.error.message}`));
      else resolve(data.result);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    nextId += 1;
    pending.set(nextId, { resolve, reject });
    socket.send(JSON.stringify({ id: nextId, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const close = async () => {
    try { socket.close(); } catch { /* already closed */ }
    child.kill();
    await Promise.race([exited, sleep(5000)]);
  };
  return { send, evaluate, close };
}

// Clicks the button whose text (or aria-label) matches, once the screen shows it.
const click = (evaluate, source) => waitFor(() => evaluate(`(() => {
  const re = new RegExp(${JSON.stringify(source)});
  const button = [...document.querySelectorAll("button")].find((b) => (re.test(b.textContent.trim()) || re.test(b.getAttribute("aria-label") ?? "")) && b.getClientRects().length && !b.disabled);
  if (!button) return false;
  button.click();
  return true;
})()`), `a button ${source}`);

const waitText = (evaluate, source) => waitFor(() => evaluate(`new RegExp(${JSON.stringify(source)}).test(document.querySelector("[data-page-area]")?.textContent ?? "")`), `text ${source}`);

// Where things are, at the top of the page area and after scrolling it to the end.
const MEASURE = `(async () => {
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  for (const el of document.querySelectorAll("*")) for (const a of el.getAnimations ? el.getAnimations() : []) a.finish();
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top * 10) / 10, bottom: Math.round(r.bottom * 10) / 10, height: Math.round(r.height * 10) / 10 }; };
  const area = document.querySelector("[data-page-area]");
  const buttons = () => [...area.querySelectorAll("button")].filter((b) => b.getClientRects().length);
  const back = () => buttons().find((b) => /Back$/.test(b.textContent.trim()));
  const save = () => buttons().find((b) => /^Save( ·|$)/.test(b.getAttribute("aria-label") ?? b.textContent.trim()));
  const snap = () => ({
    docScrollHeight: document.documentElement.scrollHeight,
    docScrollY: scrollY,
    header: rect(document.querySelector("header")),
    nav: rect(document.querySelector("nav.fixed, nav[class*='fixed']")),
    back: rect(back()),
    save: rect(save()),
    pinned: rect(document.querySelector("[data-bottom-row]"))
  });
  area.scrollTop = 0;
  await frame();
  const top = snap();
  const scrolls = area.scrollHeight > area.clientHeight + 1;
  area.scrollTop = area.scrollHeight;
  await frame();
  const end = { ...snap(), areaScrollTop: area.scrollTop };
  area.scrollTop = 0;
  return { innerWidth, innerHeight, scrollWidth: document.documentElement.scrollWidth, areaScrollHeight: area.scrollHeight, areaClientHeight: area.clientHeight, scrolls, top, end };
})()`;

async function openApp(session, url, width, height) {
  const { send, evaluate } = session;
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url });
  await waitFor(() => evaluate("window.__seeded === true && !!document.querySelector('[data-page-area]')"), "the seeded app");
}

// Visits 1, 15, 16, 17, 18, 72 (Save on 18 for GH₵80, over the 50 signature threshold) and 29.
async function walkScreens(session, url, width, height) {
  const { evaluate } = session;
  const results = {};
  const measure = async (screen) => { await sleep(250); results[screen] = await evaluate(MEASURE); };
  await openApp(session, url, width, height);
  await waitText(evaluate, "Amoto");
  await measure("1");
  await click(evaluate, "^Sell$");
  await click(evaluate, "^8$");
  await click(evaluate, "^0$");
  await measure("15");
  await click(evaluate, "^Split payment");
  await waitText(evaluate, "Split|split");
  await measure("16");
  await click(evaluate, "Back$");
  await click(evaluate, "^Owe$");
  await waitText(evaluate, "Who owes you");
  await measure("17");
  await click(evaluate, "^A?Amoto");
  await click(evaluate, "^Next");
  await waitFor(() => evaluate(`!!document.getElementById("credit-reason")`), "18");
  await measure("18");
  await click(evaluate, "^Save · ");
  await waitFor(() => evaluate(`!!document.querySelector("canvas")`), "72").catch(async (error) => { throw new Error(`${error.message}: ${await evaluate(`JSON.stringify(window.__errors)`)}`); });
  await measure("72");
  await openApp(session, url, width, height);
  await waitText(evaluate, "Amoto");
  await click(evaluate, "^A?Amoto");
  await waitText(evaluate, "Edit contact");
  await measure("29");
  return results;
}

function checkScreen(label, m) {
  assert.ok(m.scrollWidth <= m.innerWidth, `${label}: no sideways scroll (${m.scrollWidth} > ${m.innerWidth})`);
  for (const [when, s] of [["top", m.top], ["end", m.end]]) {
    assert.equal(s.docScrollHeight, m.innerHeight, `${label} (${when}): the document is exactly the screen high (${s.docScrollHeight} vs ${m.innerHeight})`);
    assert.equal(s.docScrollY, 0, `${label} (${when}): the document never scrolls`);
    assert.ok(s.header && s.header.top === 0 && s.header.bottom > 0, `${label} (${when}): the header is at the top of the screen`);
    if (s.pinned) assert.ok(s.pinned.top >= 0 && s.pinned.bottom <= m.innerHeight + 0.5, `${label} (${when}): the pinned Save row is on screen (${s.pinned.top}-${s.pinned.bottom})`);
    if (s.nav) assert.ok(s.nav.bottom <= m.innerHeight + 0.5 && s.nav.top >= 0, `${label} (${when}): the bottom bar is on screen`);
  }
  if (m.scrolls) assert.ok(m.end.areaScrollTop > 0, `${label}: a longer screen scrolls inside the page area`);
}

async function withBrowser(run) {
  const dir = mkdtempSync(join(tmpdir(), "shell-height-"));
  const script = await bundle();
  const css = await appCss();
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>${css}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`;
  const server = createServer((request, response) => {
    if (request.url.startsWith("/app.js")) {
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      response.end(script);
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  let session = null;
  try {
    for (let attempt = 1; ; attempt += 1) {
      try {
        session = await launch(dir);
        break;
      } catch (error) {
        if (attempt >= 2) throw error;
      }
    }
    await session.send("Page.enable");
    await run(session, base);
  } finally {
    await session?.close();
    server.close();
    // A temp folder left behind is harmless; it must not fail a test whose checks passed.
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch (error) {
      console.warn(`could not remove ${dir}: ${error.code}`);
    }
  }
}

test("shell_height: no header number in the shell or the screens", () => {
  const read = (path) => readFileSync(join(root, path), "utf8");
  for (const file of ["src/pos/PosApp.jsx", "src/pos/PosComponents.jsx", "src/pos/Sell.jsx", "src/pos/CreditScreens.jsx", "src/pos/DebtCollection.jsx", "src/pos/SetupScreens.jsx"]) {
    assert.doesNotMatch(read(file), /calc\(100d?vh\s*-|min-h-screen/, `${file}: no height made from the screen minus a header`);
  }
  assert.match(read("src/pos/theme.css"), /\.pos-app\s*\{[^}]*height:\s*100dvh/, ".pos-app is 100dvh high");
  assert.match(read("src/pos/PosApp.jsx"), /data-page-area="" className="[^"]*\bmin-h-0\b[^"]*\bflex-1\b[^"]*\boverflow-y-auto\b/, "the page area takes the rest and scrolls by itself");
});

test("shell_height: 1, 15, 16, 17, 18, 29, 72 at 360x667 and 340x640; header, bottom bar and Menu at 393x852", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 300_000 }, async () => {
  await withBrowser(async (session, base) => {
    const report = {};
    for (const [width, height] of [[360, 667], [340, 640]]) {
      const results = await walkScreens(session, base, width, height);
      for (const [screen, m] of Object.entries(results)) {
        checkScreen(`${screen} at ${width}x${height}`, m);
        const seen = (r) => (r ? (r.top >= 0 && r.bottom <= m.innerHeight + 0.5 ? "on screen" : "off screen") : null);
        const where = (name, key) => (m.top[key] ? `${name} ${seen(m.top[key])} at top, ${seen(m.end[key])} at end` : `no ${name}`);
        report[`${screen}@${width}x${height}`] = m.scrolls
          ? `scrolls ${m.areaScrollHeight - m.areaClientHeight}px in page area; ${where("Back", "back")}; ${where("Save", "save")}${m.top.pinned ? " (pinned row)" : ""}`
          : "fits, no scroll";
      }
    }
    // 393x852: Home and the Menu drawer; the header, bottom bar and Menu stay on screen.
    const { evaluate } = session;
    await openApp(session, base, 393, 852);
    await waitText(evaluate, "Amoto");
    const home = await evaluate(MEASURE);
    checkScreen("1 at 393x852", home);
    assert.ok(home.top.nav && Math.abs(home.top.nav.bottom - 852) < 1, `393x852: the bottom bar sits at the bottom of the screen (${home.top.nav?.bottom})`);
    await click(evaluate, "^Open menu$");
    await sleep(300);
    const menu = await evaluate(`(() => {
      for (const el of document.querySelectorAll("*")) for (const a of el.getAnimations ? el.getAnimations() : []) a.finish();
      const d = document.querySelector('[role="dialog"]').getBoundingClientRect();
      const h = document.querySelector("header").getBoundingClientRect();
      return { dialog: { top: d.top, bottom: d.bottom, left: d.left, right: d.right }, header: { top: h.top, bottom: h.bottom }, docScrollHeight: document.documentElement.scrollHeight, innerHeight };
    })()`);
    assert.equal(menu.docScrollHeight, 852, "393x852 with Menu open: the document does not scroll");
    assert.ok(menu.dialog.top >= 0 && menu.dialog.bottom <= 852.5 && menu.dialog.left >= 0 && menu.dialog.right <= 393.5, `393x852: the Menu is on screen ${JSON.stringify(menu.dialog)}`);
    assert.equal(menu.header.top, 0, "393x852: the header stays at the top with the Menu open");
    console.log(`shell (Segoe UI, headless ${browser.split(/[\\/]/).pop()}): ${JSON.stringify(report, null, 1)}`);
  });
});
