import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { loadJsx, render, textOf, walk } from "./helpers/renderJsx.js";

// The one Back button (prototype): "‹ Back", bold 800, 18px, 52px tall, 2px #0F172A border.
test("PosBackButton looks like the prototype and only calls what it is given", async () => {
  const { PosBackButton } = await loadJsx("src/pos/PosComponents.jsx");
  let clicks = 0;
  const view = render({ type: PosBackButton, props: { onClick: () => { clicks += 1; } } });
  const button = [...walk(view.tree)].find((node) => node.type === "button");
  assert.equal(textOf(button).trim(), "‹ Back");
  assert.equal(button.props["aria-label"], "Back", "the name stays Back");
  assert.equal(button.props.type, "button");
  for (const cls of ["h-[52px]", "text-[18px]", "font-extrabold", "border-2", "border-[#0F172A]", "text-[#0F172A]", "bg-white", "rounded-[14px]"]) {
    assert.ok(button.props.className.split(/\s+/).includes(cls), `class ${cls}`);
  }
  button.props.onClick();
  assert.equal(clicks, 1);
  const disabled = render({ type: PosBackButton, props: { onClick() {}, disabled: true, "aria-label": "Back to Home" } });
  const off = [...walk(disabled.tree)].find((node) => node.type === "button");
  assert.equal(off.props.disabled, true);
  assert.equal(off.props["aria-label"], "Back to Home", "a screen can give its own name");
});

test("no screen draws its own Back button any more", () => {
  const dir = new URL("../src/pos/", import.meta.url);
  const problems = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".jsx"))) {
    const source = readFileSync(new URL(file, dir), "utf8");
    if (/<PosSecondaryButton[^>]*>\s*(?:‹\s*)?(?:\{t\("[a-zA-Z]+\.back"\)\}|Back)\s*<\/PosSecondaryButton>/.test(source)) problems.push(`${file}: a Back made from PosSecondaryButton`);
    if (/<button[^>]*onClick=\{onBack\}[^>]*>\s*(?:‹|<ArrowLeft)/.test(source)) problems.push(`${file}: a hand-made Back button`);
  }
  assert.deepEqual(problems, []);
});
