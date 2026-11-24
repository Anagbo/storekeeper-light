import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { browser, sleep, waitFor, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV } from "./helpers/lookChecks.js";

// One focus ring on every layout, phone included: the shared rule is not limited to wide, it is only on
// :focus-visible (no always-on outline), and on a phone a tap leaves no outline while Tab shows the ring.
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("the shared focus ring rule applies to every layout and only on :focus-visible", () => {
  const rule = css.match(/\.pos-app :is\(a\[href\], button[^{]*\{[^}]*\}/);
  assert.ok(rule, "the shared rule exists without a phone exclusion");
  assert.match(rule[0], /:focus-visible/);
  assert.match(rule[0], /outline:\s*3px solid #0F172A/);
  assert.doesNotMatch(css, /data-layout="phone"\]\)\s*:is\(a\[href\]/);
  const atRest = css.split("}").filter((block) => /outline:\s*3px/.test(block) && !/focus-visible/.test(block.split("{")[0]));
  assert.equal(atRest.length, 0, "no outline rule without :focus-visible");
});

const SEEDS = { home: `await setPreference("posSetupCompleted", true);` };
const OUTLINE = `(() => { const el = document.activeElement; const cs = getComputedStyle(el); return { tag: el.tagName, visible: el.matches(":focus-visible"), style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor }; })()`;

test("phone 390: a tap leaves no outline, Tab shows the 3px #0F172A ring", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 300_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    await app.open("home", 390, 800);
    await waitFor(() => app.evaluate(`!!document.querySelector("main button")`), "a Home button");
    await sleep(300);
    const point = await app.evaluate(`(() => { const b = document.querySelector("main button:not([disabled])"); b.scrollIntoView({ block: "center" }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
    const tapped = await app.evaluate(OUTLINE);
    assert.equal(tapped.visible, false, "a tap is not keyboard focus");
    assert.ok(tapped.style === "none" || tapped.width === "0px", `no outline after a tap, got ${tapped.style} ${tapped.width}`);
    await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    const tabbed = await app.evaluate(OUTLINE);
    assert.equal(tabbed.visible, true);
    assert.equal(tabbed.width, "3px");
    assert.equal(tabbed.color, "rgb(15, 23, 42)");
    assert.equal(tabbed.style, "solid");
  });
});
