// Real layout checks at phone widths: a rendered test tree becomes HTML with the app's own CSS, each
// page goes in iframes of each width (a headless window will not size below ~500px), and a script
// measures inside each frame. Uses Edge or Chrome when installed; tests skip without one.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";

const root = fileURLToPath(new URL("../..", import.meta.url));

const BROWSERS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
];
export const browser = process.env.HEADER_TEST_BROWSER || BROWSERS.find((path) => existsSync(path));

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const SVG = new Set(["svg", "path", "circle", "line", "rect", "polyline", "polygon", "g", "ellipse"]);
const UNITLESS = new Set(["fontWeight", "lineHeight", "opacity", "zIndex", "flex", "flexGrow", "flexShrink", "order"]);
const escapeHtml = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kebab = (name) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

// The test renderer's tree as HTML, close enough for layout: tags, classes, styles, attributes, text.
export function toHtml(node) {
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

// The app's Tailwind build plus theme.css.
export async function appCss() {
  const base = join(root, "src");
  const compiler = await compile(readFileSync(join(base, "styles.css"), "utf8"), { base, onDependency() {} });
  const scanner = new Scanner({ sources: [...compiler.sources, { base, pattern: "**/*", negated: false }] });
  return compiler.build(scanner.scan()) + readFileSync(join(base, "pos/theme.css"), "utf8");
}

// `pages` [{ name, html }] in frames of each width; `measure` is the source of a function
// (frame, win, doc) => result run in each frame after load. Returns every result.
export function measureInFrames({ pages, css, widths, height = 900, measure }) {
  const docs = pages.map(({ name, html }) => ({ name, doc: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>${css}</style></head><body><div id="root">${html}</div></body></html>` }));
  const frames = docs.flatMap(({ name, doc }) => widths.map((width) => `<iframe data-page="${escapeHtml(name)}" data-width="${width}" style="width:${width}px;height:${height}px;border:0;display:block" srcdoc="${escapeHtml(doc)}"></iframe>`)).join("");
  const script = `
    const measure = ${measure};
    let pending = document.querySelectorAll("iframe").length;
    const results = [];
    for (const frame of document.querySelectorAll("iframe")) {
      const done = () => {
        const doc = frame.contentDocument;
        for (const el of doc.querySelectorAll("*")) for (const a of el.getAnimations ? el.getAnimations() : []) a.finish();
        results.push({ page: frame.dataset.page, width: Number(frame.dataset.width), innerWidth: frame.contentWindow.innerWidth, ...measure(frame, frame.contentWindow, doc) });
        if (--pending === 0) { const out = document.createElement("pre"); out.id = "out"; out.textContent = JSON.stringify(results); document.body.appendChild(out); }
      };
      if (frame.contentDocument && frame.contentDocument.readyState === "complete" && frame.contentDocument.body?.childElementCount) done(); else frame.addEventListener("load", done, { once: true });
    }`;
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">${frames}<script>${script}</script></body></html>`;
  const dir = mkdtempSync(join(tmpdir(), "layout-"));
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
