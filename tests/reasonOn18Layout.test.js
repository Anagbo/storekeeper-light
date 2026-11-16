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
// Back and Save are all visible; Save wraps only between words; no sideways scroll. Back and Save are
// two pinned rows at the bottom of the screen; the document never scrolls and the content above the
// rows scrolls inside the page area when it does not fit.
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
  long: { name: "Kwabena Asamoah-Boateng", reasons: ["School fees", "Rice and palm oil", "Gas refill"] },
  // Owes GH₵45.00; a GH₵12,300 sale makes "Kwabena A… owes GH₵12,345.00" on Save.
  big: { name: "Kwabena Asamoah-Boateng", owes: 4500, reasons: ["School fees", "Rice and palm oil", "Gas refill"] }
};
(async () => {
  const scenario = SCENARIOS[new URLSearchParams(location.search).get("case")];
  await db.delete();
  await db.open();
  await setPreference("posSetupCompleted", true);
  const now = Date.now();
  await recordCreditSale({ name: scenario.name, amountPesewas: scenario.owes ?? 2700, now: now - 86_400_000 });
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
  // Waits until the browser has exited, so its profile folder can be removed.
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const close = async () => {
    try { socket.close(); } catch { /* already closed */ }
    child.kill();
    await Promise.race([exited, sleep(5000)]);
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
  // Save on 18 shows two lines ("Save" / "{Name} owes GH₵x"); its accessible name is the whole label.
  const save = buttons.find((b) => /^Save · /.test(b.getAttribute("aria-label") ?? "")) ?? byText(/^Save · /);
  const style = (el) => el && { size: parseFloat(getComputedStyle(el).fontSize), weight: Number(getComputedStyle(el).fontWeight), whiteSpace: getComputedStyle(el).whiteSpace };
  const line1 = save.querySelector('[data-save-line="1"]');
  const line2 = save.querySelector('[data-save-line="2"]');
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
    areaScrollTop: document.querySelector("[data-page-area]").scrollTop,
    area: (() => { const a = document.querySelector("[data-page-area]"); return { clientHeight: a.clientHeight, scrollHeight: a.scrollHeight }; })(),
    titleLines,
    field: rect(document.getElementById("credit-reason")),
    chips: chips.map(rect),
    chipRows: new Set(chips.map((c) => Math.round(c.getBoundingClientRect().top))).size,
    options: [byText(/^Today$/), byText(/^In 1 week$/), byText(/^In 2 weeks$/), byText(/^A little at a time/)].map((b) => b && rect(b)),
    back: rect(byText(/Back$/)),
    save: rect(save),
    saveWords: words,
    saveLines: tops.size,
    saveLabel: save.getAttribute("aria-label") ?? save.textContent.trim(),
    saveLine1: line1 && { text: line1.textContent, ...style(line1), rect: rect(line1) },
    saveLine2: line2 && { text: line2.textContent, ...style(line2), rect: rect(line2) },
    // The content box of Save (inside border and padding) and the width of line 2's own text.
    saveInner: (() => { const r = save.getBoundingClientRect(); const cs = getComputedStyle(save); const left = r.left + save.clientLeft + parseFloat(cs.paddingLeft); return { left, right: left + save.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) }; })(),
    saveLine2Text: line2 && (() => { const range = document.createRange(); range.selectNodeContents(line2); const r = range.getBoundingClientRect(); return { left: r.left, right: r.right }; })(),
    saveOverflow: save.scrollWidth > save.clientWidth,
    bottomRow: rect(document.querySelector("[data-bottom-row]")),
    bottomRowInner: (() => { const row = document.querySelector("[data-bottom-row]"); const cs = getComputedStyle(row); return row.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); })(),
    header: rect(document.querySelector("header")),
    mainH: document.querySelector("main").getBoundingClientRect().height,
    contentH: [...document.querySelector("main").children].reduce((s, c) => s + c.getBoundingClientRect().height, 0)
  };
})()`;

async function open18(session, url, width, height, digits = ["8"]) {
  const { send, evaluate } = session;
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url });
  await waitFor(() => evaluate("window.__seeded === true"), "the seeded database");
  await click(evaluate, "^Sell$");
  for (const digit of digits) await click(evaluate, `^${digit}$`);
  await click(evaluate, "^Owe$");
  await click(evaluate, "^[AK](Amoto|Kwabena)");
  await click(evaluate, "^Next");
  await waitFor(() => evaluate(`!!document.getElementById("credit-reason") && document.querySelectorAll("[data-reason-chip]").length === 3`), "18 with its chips");
  await sleep(300);
  return evaluate(MEASURE);
}

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
  // Two pinned rows (wiring "Save button on 18", final): Back alone on row 1, 52px, left aligned with
  // Save; Save alone on row 2 across the whole row.
  assert.ok(Math.abs(m.back.height - 52) < 0.5, `${label}: Back is 52px (${m.back.height})`);
  assert.ok(Math.abs(m.back.left - m.save.left) < 0.5, `${label}: Back is left aligned (${m.back.left} vs ${m.save.left})`);
  assert.ok(m.back.bottom <= m.save.top, `${label}: Back is on the row above Save`);
  assert.ok(Math.abs(m.save.right - m.save.left - m.bottomRowInner) < 0.5, `${label}: Save is full width (${m.save.right - m.save.left} of ${m.bottomRowInner})`);
  if (saveTwoLines) assert.ok(m.saveLines <= 2, `${label}: Save is at most two lines (${m.saveLines})`);
  for (const { word, lines } of m.saveWords) assert.equal(lines, 1, `${label}: "${word}" in Save is not broken`);
}

async function with18Browser(run) {
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

// Wiring "Save button on 18" (final, 16 Nov 2026): Back and Save are two pinned rows, so 18 is taller
// than a 360x667 screen even with a short name (it fitted while Back and Save shared one row). The
// document never scrolls (rules_global.shell_height); the content above the rows scrolls inside the
// page area; at the top of that scroll the "What for?" field and its chips are above the rows, at the
// end the last option is.
test("18: field, chips, 60px options, Back and Save at 340, 360 and 393px; at 360x667 and 340x640 only the page area scrolls", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 240_000 }, async () => {
  await with18Browser(async (session, base) => {
  for (const width of [340, 360, 393]) {
    assertVisible(await open18(session, `${base}?case=short`, width, 667), `short ${width}x667`);
    assertVisible(await open18(session, `${base}?case=long`, width, 667), `long ${width}x667`, { saveTwoLines: false });
  }
  const heights = {};
  for (const [kind, width, height] of [["short", 360, 667], ["short", 340, 640], ["long", 360, 667], ["long", 340, 640]]) {
    const label = `${kind} ${width}x${height}`;
    const top = await open18(session, `${base}?case=${kind}`, width, height);
    assertVisible(top, label, { saveTwoLines: kind === "short" });
    if (kind === "long" && width === 360) {
      assert.equal(top.titleLines, 2, "the long name puts the title on two lines");
      assert.equal(top.chipRows, 2, "the long reasons put the chips on two rows");
    }
    for (const [what, r] of [["the What for field", top.field], ...top.chips.map((chip, index) => [`chip ${index + 1}`, chip])]) {
      assert.ok(r.top >= top.header.bottom - 0.5 && r.bottom <= top.bottomRow.top + 0.5, `${label}: ${what} is reachable above Back and Save (${r.top}-${r.bottom}, rows from ${top.bottomRow.top})`);
    }
    await session.evaluate("(() => { const area = document.querySelector('[data-page-area]'); area.scrollTop = area.scrollHeight; })()");
    await sleep(200);
    const end = await session.evaluate(MEASURE);
    assertVisible(end, `${label} scrolled`, { saveTwoLines: kind === "short" });
    for (const m of [top, end]) {
      assert.equal(m.scrollY, 0, `${label}: the document does not scroll`);
      assert.equal(m.scrollHeight, m.innerHeight, `${label}: the document is the screen high (${m.scrollHeight}px)`);
    }
    assert.equal(end.areaScrollTop > 0, top.area.scrollHeight > top.area.clientHeight, `${label}: the page area scrolls exactly when it must`);
    assert.ok(end.options[3].bottom <= end.bottomRow.top + 0.5, `${label}: A little at a time is not hidden under Back and Save (${end.options[3].bottom} > ${end.bottomRow.top})`);
    heights[label] = { header: top.header.height, area: top.area.clientHeight, content: top.area.scrollHeight, scrolls: end.areaScrollTop, rows: top.bottomRow.height, back: top.back.height, save: top.save.height, document: top.scrollHeight };
  }
  console.log(`18 heights (Segoe UI): ${JSON.stringify(heights)}`);
  });
});

// Wiring "Save button on 18" (16 Nov 2026): two lines in the same button, line 1 "Save" (800, 18px),
// line 2 "{Name} owes GH₵{amount}" (600, 16px, one line, the name cut at 10 characters). At least 56px.
// Two lines at 340, 360 and 393px with a 10-character name and GH₵12,345.00, never three; words are
// never split; the accessible name stays "Save · {Name} owes GH₵{amount}".
test("18: Save is two lines (Save / Kwabena A… owes GH₵12,345.00) at 340, 360 and 393px, never three", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 240_000 }, async () => {
  await with18Browser(async (session, base) => {
    const measured = {};
    for (const width of [340, 360, 393]) measured[width] = await open18(session, `${base}?case=big`, width, 667, ["1", "2", "3", "0", "0"]);
    const report = Object.fromEntries(Object.entries(measured).map(([width, m]) => [width, { lines: m.saveLines, height: m.save.height, button: m.save.right - m.save.left, text: m.saveLine2Text && Math.round((m.saveLine2Text.right - m.saveLine2Text.left) * 10) / 10, room: Math.round((m.saveInner.right - m.saveInner.left) * 10) / 10 }]));
    console.log(`Save on 18, Kwabena A… owes GH₵12,345.00 (Segoe UI): ${JSON.stringify(report)}`);
    for (const [width, m] of Object.entries(measured)) {
      const label = `big ${width}x667`;
      assertVisible(m, label);
      assert.equal(m.saveLabel, "Save · Kwabena A… owes GH₵12,345.00", `${label}: the accessible name`);
      assert.equal(m.saveLines, 2, `${label}: Save is exactly two lines (${m.saveLines})`);
      assert.deepEqual([m.saveLine1.text, m.saveLine1.size, m.saveLine1.weight], ["Save", 18, 800], `${label}: line 1 is "Save", 18px, 800`);
      assert.deepEqual([m.saveLine2.text, m.saveLine2.size, m.saveLine2.weight, m.saveLine2.whiteSpace], ["Kwabena A… owes GH₵12,345.00", 16, 600, "nowrap"], `${label}: line 2, 16px, 600, one line`);
      assert.ok(m.saveLine1.rect.bottom <= m.saveLine2.rect.top + 0.5, `${label}: "Save" above the detail`);
      assert.ok(m.saveLine2Text.left >= m.saveInner.left - 0.5 && m.saveLine2Text.right <= m.saveInner.right + 0.5, `${label}: line 2's text fits inside the button (${m.saveLine2Text.left}-${m.saveLine2Text.right} in ${m.saveInner.left}-${m.saveInner.right})`);
      assert.equal(m.saveOverflow, false, `${label}: nothing spills out of Save`);
    }
  });
});
