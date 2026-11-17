// The real PosApp (header and all) in headless Edge or Chrome over the DevTools protocol, at any phone
// viewport (Emulation.setDeviceMetricsOverride works below 500px). Same launch as
// tests/reasonOn18Layout.test.js: the profile's DevToolsActivePort gives the port, one retry when the
// browser fails to start, the child is awaited before its temp folder is removed, and a folder left
// behind is a warning, never a failure. The font is the machine's (Segoe UI on Windows), not a phone font.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { appCss, browser } from "./browserLayout.js";

export { browser };

const root = fileURLToPath(new URL("../..", import.meta.url));

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor(check, what, ms = 20_000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
}

// `seed` is the body of an async function run in the page before PosApp renders, with db, the
// preferences, debts, products and suppliers writers in scope; ?case=<name> picks it.
function entry(seeds) {
  const cases = Object.entries(seeds).map(([name, body]) => `${JSON.stringify(name)}: async () => {\n${body}\n}`).join(",\n");
  return `
import { createRoot } from "react-dom/client";
import { db } from "./src/db/db.js";
import { recordCreditSale } from "./src/db/debts.js";
import { setPreference } from "./src/db/preferences.js";
import { createProduct } from "./src/db/products.js";
import { recordExpense } from "./src/db/suppliers.js";
import PosApp from "./src/pos/PosApp.jsx";
const SEEDS = {${cases}};
(async () => {
  await db.delete();
  await db.open();
  const seed = SEEDS[new URLSearchParams(location.search).get("case")];
  if (seed) await seed();
  window.__seeded = true;
  createRoot(document.getElementById("root")).render(<PosApp />);
})();
`;
}

async function bundle(seeds, env) {
  const result = await build({
    stdin: { contents: entry(seeds), resolveDir: root, loader: "jsx", sourcefile: "edge-app-entry.jsx" },
    bundle: true,
    write: false,
    format: "esm",
    splitting: false,
    platform: "browser",
    jsx: "automatic",
    loader: { ".js": "jsx" },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": JSON.stringify(env) },
    nodePaths: [join(root, "node_modules")],
    logLevel: "silent"
  });
  return result.outputFiles[0].text;
}

async function launch(dir) {
  const profile = join(dir, "profile");
  const child = spawn(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"], { stdio: "ignore" });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
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
    const close = async () => {
      try { socket.close(); } catch { /* already closed */ }
      child.kill();
      await Promise.race([exited, sleep(5000)]);
    };
    return { send, evaluate, close };
  } catch (error) {
    child.kill();
    await Promise.race([exited, sleep(5000)]);
    throw error;
  }
}

// Runs `run(app)` with one browser for all the cases. app.open(caseName, width, height) loads the app
// with that seed at that viewport; app.click(source) clicks the first visible, enabled button or link
// whose text (or aria-label) matches the regex source, once the screen shows it.
export async function withEdgeApp({ seeds, env = {} }, run) {
  const dir = mkdtempSync(join(tmpdir(), "edge-app-"));
  const script = await bundle(seeds, env);
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
    const { send, evaluate } = session;
    const app = {
      send,
      evaluate,
      async open(caseName, width, height) {
        await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: true });
        await send("Page.navigate", { url: `${base}?case=${encodeURIComponent(caseName)}` });
        await waitFor(() => evaluate("window.__seeded === true && !!document.querySelector('main')"), "the seeded app");
      },
      click: (source) => waitFor(() => evaluate(`(() => {
        const re = new RegExp(${JSON.stringify(source)});
        const name = (el) => (el.getAttribute("aria-label") || el.textContent).replace(/\\s+/g, " ").trim();
        const el = [...document.querySelectorAll("button, a[href]")].find((b) => (re.test(b.textContent.replace(/\\s+/g, " ").trim()) || re.test(name(b))) && b.offsetParent && !b.disabled);
        if (!el) return false;
        el.click();
        return true;
      })()`), `a control ${source}`),
      // Waits until a visible control matches (without clicking).
      shows: (source) => waitFor(() => evaluate(`(() => {
        const re = new RegExp(${JSON.stringify(source)});
        return [...document.querySelectorAll("button, a[href], [role=radio]")].some((b) => re.test((b.getAttribute("aria-label") || "") + " " + b.textContent.replace(/\\s+/g, " ").trim()) && b.offsetParent);
      })()`), `a control ${source}`),
      type: async (text) => {
        for (const char of text) await send("Input.insertText", { text: char });
      },
      measure: () => evaluate(MEASURE_BUTTONS)
    };
    await run(app);
  } finally {
    await session?.close();
    server.close();
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch (error) {
      console.warn(`could not remove ${dir}: ${error.code}`);
    }
  }
}

// Every visible button, link and radio on the page (dialogs included): its look (data-look), box,
// whether its content overflows, and how many lines its text takes (text nodes only; icons and child
// boxes are not lines). Animations are finished first (headless Edge can freeze them at 0ms).
export const MEASURE_BUTTONS = `(() => {
  document.getAnimations().forEach((a) => { try { a.finish(); } catch {} });
  const lines = (el) => {
    const tops = new Set();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top / 4));
    }
    return tops.size;
  };
  const controls = [...document.querySelectorAll("button, a[href], [role=radio]")].filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden");
  return {
    innerWidth, innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    controls: controls.map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        text: el.textContent.replace(/\\s+/g, " ").trim(),
        label: el.getAttribute("aria-label") || "",
        look: el.getAttribute("data-look") || "",
        top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width,
        overflow: el.scrollWidth > el.clientWidth + 0.5,
        lines: lines(el),
        border: cs.borderTopStyle + " " + cs.borderTopWidth + " " + cs.borderTopColor,
        radius: cs.borderTopLeftRadius,
        color: cs.color,
        background: cs.backgroundColor,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        underline: cs.textDecorationLine.includes("underline")
      };
    })
  };
})()`;
