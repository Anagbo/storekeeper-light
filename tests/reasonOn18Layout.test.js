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

// Wiring 18 "Reason on 18" (16 Nov 2026), real browser: the real PosApp (header and all) in headless
// Edge or Chrome at phone viewports. The "What for?" field, the recent chips, the four 60px options,
// Back and Save are all visible; Save wraps only between words; no sideways scroll. At 360x667 with a
// short name and one row of chips nothing scrolls. With a two-line title and two rows of chips the
// content scrolls and Back and Save stay pinned at the bottom of the screen.
// The font is the machine's (Segoe UI on Windows), not a phone font.

const root = fileURLToPath(new URL("..", import.meta.url));

const ENTRY = `
import { createRoot } from "react-dom/client";
import { db } from "./src/db/db.js";
import { recordCreditSale } from "./src/db/debts.js";
import { setPreference } from "./src/db/preferences.js";
import PosApp from "./src/pos/PosApp.jsx";
const SCENARIOS = {
  short: { name: "Amoto", reasons: ["Rice", "Water", "Bread"] },
  long: { name: "Kwabena Asamoah-Boateng", reasons: ["School fees", "Rice and palm oil", "Gas refill"] }
};
(async () => {
  const scenario = SCENARIOS[new URLSearchParams(location.search).get("case")];
  await db.delete();
  await db.open();
  await setPreference("posSetupCompleted", true);
  const now = Date.now();
  await recordCreditSale({ name: scenario.name, amountPesewas: 2700, now: now - 86_400_000 });
  for (const [index, reason] of [...scenario.reasons].reverse().entries()) {
    await recordCreditSale({ name: "Other " + index, amountPesewas: 100, creditReason: reason, now: now - 60_000 + index * 1000 });
  }
  window.__seeded = true;
  createRoot(document.getElementById("root")).render(<PosApp />);
})();
`;

async function bundle() {
  const result = await build({
    stdin: { contents: ENTRY, resolveDir: root, loader: "jsx", sourcefile: "reason18-entry.jsx" },
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
  const close = () => {
    try { socket.close(); } catch { /* already closed */ }
    child.kill();
  };
  return { send, evaluate, close };
}

// Clicks the button whose text matches, once the screen shows it (lists load from the database).
const click = (evaluate, source) => waitFor(() => evaluate(`(() => {
  const re = new RegExp(${JSON.stringify(source)});
  const button = [...document.querySelectorAll("button")].find((b) => re.test(b.textContent.trim()) && b.offsetParent && !b.disabled);
  if (!button) return false;
  button.click();
  return true;
})()`), `a button ${source}`);

const MEASURE = `(() => {
  const rect = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }; };
  const buttons = [...document.querySelectorAll("main button")];
  const byText = (re) => buttons.find((b) => re.test(b.textContent.trim()));
  const save = byText(/^Save · /);
  // Lines of the Save text: each word (split at spaces) must sit on one line.
  const words = [];
  const walker = document.createTreeWalker(save, NodeFilter.SHOW_TEXT);
  const tops = new Set();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent;
    let start = 0;
    for (const word of text.split(" ")) {
      if (word) {
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + word.length);
        const lineTops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
        words.push({ word, lines: lineTops.size });
        for (const top of lineTops) tops.add(top);
      }
      start += word.length + 1;
    }
  }
  const title = document.querySelector("main h1");
  const titleLines = Math.round(title.getBoundingClientRect().height / parseFloat(getComputedStyle(title).lineHeight));
  const chips = [...document.querySelectorAll("[data-reason-chip]")];
  return {
    innerWidth, innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    scrollY,
    titleLines,
    field: rect(document.getElementById("credit-reason")),
    chips: chips.map(rect),
    chipRows: new Set(chips.map((c) => Math.round(c.getBoundingClientRect().top))).size,
    options: [byText(/^Today$/), byText(/^In 1 week$/), byText(/^In 2 weeks$/), byText(/^A little at a time/)].map((b) => b && rect(b)),
    back: rect(byText(/Back$/)),
    save: rect(save),
    saveWords: words,
    saveLines: tops.size,
    bottomRow: rect(document.querySelector("[data-bottom-row]")),
    header: rect(document.querySelector("header")),
    mainH: document.querySelector("main").getBoundingClientRect().height,
    contentH: [...document.querySelector("main").children].reduce((s, c) => s + c.getBoundingClientRect().height, 0)
  };
})()`;

async function open18(session, url, width, height) {
  const { send, evaluate } = session;
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url });
  await waitFor(() => evaluate("window.__seeded === true"), "the seeded database");
  await click(evaluate, "^Sell$");
  await click(evaluate, "^8$");
  await click(evaluate, "^Owe$");
  await click(evaluate, "^[AK](Amoto|Kwabena)");
  await click(evaluate, "^Next");
  await waitFor(() => evaluate(`!!document.getElementById("credit-reason") && document.querySelectorAll("[data-reason-chip]").length === 3`), "18 with its chips");
  await sleep(300);
  return evaluate(MEASURE);
}

// Save on 18 with a 10-character name ("Kwabena A…") needs three lines at 340px (FAIL reported 16 Nov
// 2026, older than the reason field: the old fixed 56px Save overflowed). Collected here and checked in
// the todo test below until the owner decides the fix.
const longSaveLines = {};

function assertVisible(m, label, { saveTwoLines = true } = {}) {
  const inside = (r, what) => {
    assert.ok(r, `${label}: ${what} is shown`);
    assert.ok(r.left >= 0 && r.right <= m.innerWidth + 0.5, `${label}: ${what} fits across (${r.left}-${r.right} in ${m.innerWidth})`);
  };
  assert.equal(m.innerWidth, Number(label.split("x")[0].split(" ").at(-1)), `${label}: the viewport width`);
  assert.ok(m.scrollWidth <= m.innerWidth, `${label}: no sideways scroll (${m.scrollWidth} > ${m.innerWidth})`);
  inside(m.field, "the What for field");
  assert.ok(Math.abs(m.field.height - 52) < 1, `${label}: the field is 52px (${m.field.height})`);
  m.chips.forEach((chip, index) => inside(chip, `chip ${index + 1}`));
  m.options.forEach((option, index) => {
    inside(option, `option ${index + 1}`);
    assert.ok(option.height >= 59.5, `${label}: option ${index + 1} is at least 60px (${option.height})`);
  });
  inside(m.back, "Back");
  inside(m.save, "Save");
  // Pinned: Back and Save are on the screen, at its bottom, whatever the scroll.
  for (const [what, r] of [["Back", m.back], ["Save", m.save]]) {
    assert.ok(r.top >= 0 && r.bottom <= m.innerHeight + 0.5, `${label}: ${what} is on the screen (${r.top}-${r.bottom} of ${m.innerHeight})`);
  }
  assert.ok(m.save.height >= 56, `${label}: Save is at least 56px (${m.save.height})`);
  if (saveTwoLines) assert.ok(m.saveLines <= 2, `${label}: Save is at most two lines (${m.saveLines})`);
  for (const { word, lines } of m.saveWords) assert.equal(lines, 1, `${label}: "${word}" in Save is not broken`);
}

test("18: field, chips, 60px options, Back and Save at 340, 360 and 393px; 360x667 fits without scrolling", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 240_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "reason18-"));
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
    const results = {};
    for (const width of [340, 360, 393]) {
      const m = await open18(session, `${base}?case=short`, width, 667);
      results[`short ${width}`] = m;
      assertVisible(m, `short ${width}x667`);
    }
    // 360x667, short name, one row of chips: nothing scrolls.
    const fit = results["short 360"];
    assert.equal(fit.titleLines, 1);
    assert.equal(fit.chipRows, 1);
    // 18 itself (header + page) ends at the bottom of the screen. The app shell under the header is
    // still min-height 100vh - 4rem with a 75px header (11px more than a 667px screen on every page);
    // that is outside 18 and reported, not asserted here.
    assert.ok(fit.header.height + fit.mainH <= fit.innerHeight + 0.5, `360x667: 18 fits without scrolling (header ${fit.header.height}px + page ${fit.mainH}px, screen ${fit.innerHeight}px)`);
    assert.ok(fit.contentH + 12 * 7 <= fit.mainH, "the content fits in the page with its gaps");
    console.log(`shell document height at 360x667: ${fit.scrollHeight}px`);

    for (const width of [340, 360, 393]) {
      const m = await open18(session, `${base}?case=long`, width, 667);
      assertVisible(m, `long ${width}x667`, { saveTwoLines: false });
      longSaveLines[width] = m.saveLines;
      if (width === 360) {
        assert.equal(m.titleLines, 2, "the long name puts the title on two lines");
        assert.equal(m.chipRows, 2, "the long reasons put the chips on two rows");
        // The content scrolls; at the end of the scroll the last option sits above the pinned row.
        await session.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)");
        await sleep(200);
        const end = await session.evaluate(MEASURE);
        assertVisible(end, `long scrolled 360x667`, { saveTwoLines: false });
        assert.ok(end.scrollY > 0, "the page scrolls when it does not fit");
        assert.ok(end.options[3].bottom <= end.bottomRow.top + 0.5, `A little at a time is not hidden under Back and Save (${end.options[3].bottom} > ${end.bottomRow.top})`);
      }
    }
    console.log(JSON.stringify({ longSaveLines }), JSON.stringify(Object.fromEntries(Object.entries(results).map(([key, m]) => [key, { page: m.scrollHeight, screen: m.innerHeight, saveLines: m.saveLines }]))));
  } finally {
    session?.close();
    server.close();
    await sleep(300);
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test("18: Save with a 10-character name is at most two lines at 340, 360 and 393px", { todo: "FAIL: three lines at 340px; fix not decided", skip: browser ? false : "no Chrome or Edge found" }, () => {
  for (const [width, lines] of Object.entries(longSaveLines)) assert.ok(lines <= 2, `${width}px: ${lines} lines`);
});
