import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";
import { appCss, browser } from "./helpers/browserLayout.js";

// Wiring 72 "Signature box" (16 Nov 2026): drawing must never scroll the page (touch-action none).
// A real browser (headless Edge or Chrome) at a 360px phone viewport with touch emulation gets real
// touch events through the DevTools protocol: first a control drag on plain page content (the page
// scrolls, so the test can see scrolling), then the same upward drag on the signature box (the page
// stays put and the stroke is drawn).

const root = fileURLToPath(new URL("..", import.meta.url));

const ENTRY = `
import { createRoot } from "react-dom/client";
import { useState } from "react";
import SignatureBox from "./src/pos/SignatureBox.jsx";
function Page() {
  const [strokes, setStrokes] = useState([]);
  window.__strokes = strokes;
  return (
    <main style={{ padding: "16px" }}>
      <div id="above" style={{ height: "120px" }}>Please sign</div>
      <SignatureBox strokes={strokes} onChange={setStrokes} />
      <div id="filler" style={{ height: "2400px", background: "#eee" }}>More page</div>
    </main>
  );
}
createRoot(document.getElementById("root")).render(<Page />);
`;

async function bundle() {
  const result = await build({
    stdin: { contents: ENTRY, resolveDir: root, loader: "jsx", sourcefile: "signature-entry.jsx" },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
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
  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
  const close = () => {
    try { socket.close(); } catch { /* already closed */ }
    child.kill();
  };
  return { send, evaluate, close };
}

// A finger drag from (x, y1) to (x2, y2) in small steps, as a person draws.
async function drag(send, from, to, steps = 20) {
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from[0], y: from[1] }] });
  for (let step = 1; step <= steps; step += 1) {
    const x = from[0] + ((to[0] - from[0]) * step) / steps;
    const y = from[1] + ((to[1] - from[1]) * step) / steps;
    await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
    await sleep(16);
  }
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(600);
}

test("drawing on the signature box does not scroll the page (real browser, touch, 360px)", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "signature-"));
  let session = null;
  try {
    const script = await bundle();
    const css = await appCss();
    const file = join(dir, "page.html");
    writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${script.replace(/<\/script/gi, "<\\/script")}</script></body></html>`);
    // Edge sometimes fails to start the first time on this machine (LoadEnclaveImageW): one retry.
    for (let attempt = 1; ; attempt += 1) {
      try {
        session = await launch(dir);
        break;
      } catch (error) {
        if (attempt >= 2) throw error;
      }
    }
    const { send, evaluate } = session;
    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 360, height: 700, deviceScaleFactor: 2, mobile: true });
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await send("Page.navigate", { url: pathToFileURL(file).href });
    await waitFor(() => evaluate(`document.readyState === "complete" && !!document.querySelector("canvas")`), "the page");
    assert.equal(await evaluate("window.innerWidth"), 360, "a 360px phone viewport");
    assert.equal(await evaluate(`getComputedStyle(document.querySelector("canvas")).touchAction`), "none");
    assert.equal(await evaluate(`getComputedStyle(document.querySelector("[data-signature-box]")).touchAction`), "none");

    // Control: the same upward drag on plain page content scrolls the page.
    const filler = await evaluate(`(() => { const r = document.getElementById("filler").getBoundingClientRect(); return [r.left + 100, Math.min(r.top + 300, 650)]; })()`);
    await drag(send, filler, [filler[0], filler[1] - 250]);
    const controlScroll = await evaluate("window.scrollY");
    assert.ok(controlScroll > 50, `a drag on the page scrolls it (scrollY ${controlScroll}): the test can see scrolling`);
    await evaluate("window.scrollTo(0, 0)");
    await waitFor(() => evaluate("window.scrollY === 0"), "scroll back to the top");

    // The signature box: an upward and a sideways drag draw, and the page does not move.
    const box = await evaluate(`(() => { const r = document.querySelector("canvas").getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
    assert.ok(Math.abs(box.height - 184) < 2, `the box is 190px with a 3px border (${box.height})`);
    const pageStill = async (where) => {
      assert.equal(await evaluate("location.protocol"), "file:", `${where}: still on the page (no swipe navigation)`);
      assert.equal(await evaluate("window.scrollY"), 0, `${where}: the page did not scroll`);
      assert.equal(await evaluate("window.scrollX"), 0, `${where}: the page did not move sideways`);
    };
    // Mostly upward (a tall letter): on plain content this scrolls the page down.
    await drag(send, [box.left + 60, box.top + box.height - 8], [box.left + 90, box.top + 8]);
    await pageStill("after an upward stroke");
    assert.equal((await evaluate("window.__strokes")).length, 1, "the upward stroke is drawn");
    // Sideways.
    await drag(send, [box.left + 30, box.top + 100], [box.left + box.width - 30, box.top + 120]);
    await pageStill("after a sideways stroke");
    const strokes = await evaluate("window.__strokes");
    assert.equal(strokes.length, 2, "two strokes drawn");
    assert.ok(strokes[0].length > 10, `the first stroke has its points (${strokes[0].length})`);
    for (const [x, y] of strokes.flat()) assert.ok(Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x <= 1000 && y >= 0 && y <= 1000);
    assert.equal(await evaluate(`!!document.querySelector("[data-signature-placeholder]")`), false, "the hint is gone after the first stroke");
  } finally {
    session?.close();
    await sleep(300);
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
