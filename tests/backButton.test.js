import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { loadJsx, render, textOf, walk } from "./helpers/renderJsx.js";

// The one Back button (wiring rules_global.back_button, decided 16 Nov 2026): an arrow-left SVG
// icon then the word "Back", bold 800, 18px, 52px tall, 2px #0F172A border. No "‹" character.
test("PosBackButton: arrow-left icon plus the word Back, looks like the prototype, only calls what it is given", async () => {
  const { PosBackButton } = await loadJsx("src/pos/PosComponents.jsx");
  let clicks = 0;
  const view = render({ type: PosBackButton, props: { onClick: () => { clicks += 1; } } });
  const button = [...walk(view.tree)].find((node) => node.type === "button");
  assert.equal(textOf(button).trim(), "Back", "the word stays, no ‹");
  assert.equal(button.props["aria-label"], "Back", "the name stays Back");
  assert.equal(button.props.type, "button");
  for (const cls of ["h-[52px]", "text-[18px]", "font-extrabold", "border-2", "border-[#0F172A]", "text-[#0F172A]", "bg-white", "rounded-[14px]", "gap-1.5"]) {
    assert.ok(button.props.className.split(/\s+/).includes(cls), `class ${cls}`);
  }
  const svg = [...walk(button)].find((node) => node.type === "svg");
  assert.ok(svg, "an SVG icon");
  assert.equal(svg.props.viewBox, "0 0 24 24");
  assert.equal(String(svg.props.width), "24");
  assert.equal(String(svg.props.height), "24");
  assert.equal(svg.props.stroke, "currentColor");
  assert.equal(String(svg.props.strokeWidth), "2.6");
  assert.equal(svg.props.strokeLinecap, "round");
  assert.equal(svg.props.strokeLinejoin, "round");
  assert.equal(svg.props.fill, "none");
  assert.equal(String(svg.props["aria-hidden"]), "true");
  const path = [...walk(svg)].find((node) => node.type === "path");
  assert.equal(path.props.d, "M19 12H5M11 5l-7 7 7 7");
  const children = [...walk(button)].filter((node) => node !== button && (node.type === "svg" || typeof node === "string"));
  assert.equal(children[0].type, "svg", "the icon comes before the word");
  button.props.onClick();
  assert.equal(clicks, 1);
  const disabled = render({ type: PosBackButton, props: { onClick() {}, disabled: true, "aria-label": "Back to Home" } });
  const off = [...walk(disabled.tree)].find((node) => node.type === "button");
  assert.equal(off.props.disabled, true);
  assert.equal(off.props["aria-label"], "Back to Home", "a screen can give its own name");
});

const posSources = () => {
  const dir = new URL("../src/pos/", import.meta.url);
  return readdirSync(dir, { recursive: true })
    .filter((name) => /\.(jsx?|css)$/.test(name))
    .map((name) => [name, readFileSync(new URL(name.replaceAll("\\", "/"), dir), "utf8")]);
};

test("the text character ‹ is not used in any POS source", () => {
  const found = posSources().filter(([, source]) => source.includes("‹")).map(([name]) => name);
  assert.deepEqual(found, []);
});

test("no screen draws its own Back button: every Back comes from PosBackButton", () => {
  const problems = [];
  for (const [file, source] of posSources().filter(([name]) => name.endsWith(".jsx") && name !== "PosComponents.jsx")) {
    if (/<PosSecondaryButton[^>]*>\s*(?:‹\s*)?(?:\{t\("[a-zA-Z]+\.back"\)\}|Back)\s*<\/PosSecondaryButton>/.test(source)) problems.push(`${file}: a Back made from PosSecondaryButton`);
    if (/<button[^>]*onClick=\{onBack\}[^>]*>\s*(?:‹|<ArrowLeft|\{t\("[a-zA-Z]+\.back"\)\}|Back\b)/.test(source)) problems.push(`${file}: a hand-made Back button`);
    // A "*.back" text may only be an aria-label passed to PosBackButton, never the visible label of another element.
    if (/>\s*\{t\("[a-zA-Z]+\.back"\)\}/.test(source)) problems.push(`${file}: a "*.back" text shown outside PosBackButton`);
    if (/>\s*(?:‹\s*)?Back\s*</.test(source)) problems.push(`${file}: a literal Back label`);
  }
  assert.deepEqual(problems, []);
});

test("PlannedScreen's Back is the shared PosBackButton", async () => {
  const { default: PlannedScreen } = await loadJsx("src/pos/PlannedScreen.jsx");
  const view = render({ type: PlannedScreen, props: { route: "NoSuchScreen", params: {}, onBack() {}, onOpenBackup() {} } });
  assert.ok([...walk(view.tree)].some((node) => node.type?.name === "PosBackButton"), "uses PosBackButton");
});
