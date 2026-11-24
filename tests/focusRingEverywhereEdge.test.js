import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, waitFor, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV } from "./helpers/lookChecks.js";

// The shared focus ring (3px solid #0F172A, 2px offset; a text field's label has no offset) wins on every
// control a keyboard user reaches: Tab through Home, Sell and the menu, at 390 and 1280, and check each focus.
const SEEDS = { home: `await setPreference("posSetupCompleted", true); await createProduct({ name: "Bread", pricePesewas: 500 });` };
const FOCUSED = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const ring = el.tagName === "INPUT" ? el.closest("label") || el : el;
  const cs = getComputedStyle(ring);
  const kind = el.tagName === "INPUT" ? "field" : el.closest("[role=dialog]") ? "dialog " + el.tagName.toLowerCase() : el.closest("nav, aside") ? "nav " + el.tagName.toLowerCase() : el.matches("[data-look]") ? "button " + el.getAttribute("data-look") : el.tagName.toLowerCase();
  return { kind, name: (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 24), visible: el.matches(":focus-visible"), field: el.tagName === "INPUT", style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor, offset: cs.outlineOffset };
})()`;

async function tab(app, key = "Tab") {
  await app.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: 9 });
  await app.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: 9 });
}

async function tabThrough(app, label, count, seen) {
  for (let i = 0; i < count; i += 1) {
    await tab(app);
    const f = await app.evaluate(FOCUSED);
    if (!f) continue;
    if (process.env.SHOW_RING) console.log(label, JSON.stringify(f));
    assert.equal(f.visible, true, `${label} ${f.name}: keyboard focus`);
    assert.equal(f.style, "solid", `${label} ${f.kind} "${f.name}": style`);
    assert.equal(f.width, "3px", `${label} ${f.kind} "${f.name}": width`);
    assert.equal(f.color, "rgb(15, 23, 42)", `${label} ${f.kind} "${f.name}": colour`);
    assert.equal(f.offset, f.field ? "0px" : "2px", `${label} ${f.kind} "${f.name}": offset`);
    seen.add(f.kind);
  }
}

test("the shared focus ring shows on at least five control types, at 390 and 1280", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 300_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const width of [390, 1280]) {
      const seen = new Set();
      await app.open("home", width, 900);
      await waitFor(() => app.evaluate(`!!document.querySelector("main button")`), "a Home button");
      await sleep(300);
      await tabThrough(app, `${width} Home`, 14, seen);
      await app.click("^Sell");
      await waitFor(() => app.evaluate(`!!document.querySelector("[aria-label]")`), "Sell");
      await sleep(300);
      await app.evaluate("document.body.focus(); window.scrollTo(0,0)");
      await tabThrough(app, `${width} Sell`, 22, seen);
      if (width === 390) {
        await app.click("^Home$|Home");
        await app.click("Menu");
        await sleep(400);
        await tabThrough(app, `${width} Menu`, 4, seen);
      }
      if (process.env.SHOW_RING) console.log(width, [...seen].join(" | "));
      assert.ok(width !== 390 || seen.size >= 5, `${width}: only ${seen.size} control types tabbed: ${[...seen].join(", ")}`);
    }
  });
});
