import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, waitFor, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV } from "./helpers/lookChecks.js";

// The shared focus ring (3px solid #0F172A, 2px offset; a text field has no offset) wins on every
// control a keyboard user reaches: Tab through Home, Sell and the menu, at 390 and 1280, and check each focus.
const SEEDS = { home: `await setPreference("posSetupCompleted", true); await createProduct({ name: "Bread", pricePesewas: 500 });` };
const FOCUSED = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  // form_fields: a text field rings itself; a bare (outline-none) input drawn in a box rings that box.
  const ring = el.tagName === "INPUT" && el.classList.contains("outline-none") ? el.closest("[data-field-box]") || el.parentElement : el;
  const cs = getComputedStyle(ring);
  const kind = el.tagName === "INPUT" ? "field" : el.closest("[role=dialog]") ? "dialog " + el.tagName.toLowerCase() : el.closest("nav, aside") ? "nav " + el.tagName.toLowerCase() : el.matches("[data-look]") ? "button " + el.getAttribute("data-look") : el.tagName.toLowerCase();
  return { kind, name: (el.getAttribute("aria-label") || el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 24), visible: el.matches(":focus-visible"), field: el.tagName === "INPUT", style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor, offset: cs.outlineOffset };
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

// Part 2 (24 Nov 2026): Collect, WhatsApp and Call on Home, and the Find item and Item name text fields.
const DEBTOR = { debtor: `await setPreference("posSetupCompleted", true); await recordCreditSale({ name: "Amos", amountPesewas: 5000, phone: "0244123456" }); await createProduct({ name: "Bread", pricePesewas: 500 });` };

// Tab until the focused control's name matches, then return its ring.
async function tabTo(app, re, label, max = 60) {
  await app.evaluate("document.body.focus(); window.scrollTo(0,0)");
  for (let i = 0; i < max; i += 1) {
    await tab(app);
    const f = await app.evaluate(FOCUSED);
    if (process.env.SHOW_RING) console.log(label, i, JSON.stringify(f && [f.kind, f.name]));
    if (f && re.test(f.name)) return f;
    const placeholder = await app.evaluate(`(document.activeElement?.placeholder || "") + " " + (document.activeElement?.closest("label")?.textContent || "")`);
    if (f && f.field && re.test(placeholder)) return f;
  }
  assert.fail(`${label}: never reached by Tab`);
}

function assertRing(f, label) {
  assert.equal(f.visible, true, `${label}: keyboard focus`);
  assert.equal(f.style, "solid", `${label}: style`);
  assert.equal(f.width, "3px", `${label}: width`);
  assert.equal(f.color, "rgb(15, 23, 42)", `${label}: colour`);
  assert.equal(f.offset, f.field ? "0px" : "2px", `${label}: offset`);
}

test("Collect, WhatsApp and Call on Home carry the shared ring at 390 and 1280", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 300_000 }, async () => {
  await withEdgeApp({ seeds: DEBTOR, env: ENV }, async (app) => {
    for (const width of [390, 1280]) {
      await app.open("debtor", width, 900);
      await waitFor(() => app.evaluate(`[...document.querySelectorAll("main button")].some((b) => /WhatsApp/.test(b.getAttribute("aria-label") || ""))`), `${width}: the debtor buttons`);
      await sleep(300);
      for (const [re, name] of [[/Collect/i, "Collect"], [/WhatsApp/i, "WhatsApp"], [/^Call/i, "Call"]]) {
        assertRing(await tabTo(app, re, `${width} ${name}`), `${width} ${name}`);
      }
    }
  });
});

test("Find item and Item name text fields carry the field ring on wide Items", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 300_000 }, async () => {
  await withEdgeApp({ seeds: DEBTOR, env: ENV }, async (app) => {
    for (const width of [1280, 768]) {
      await app.open("debtor", width, 900);
      await waitFor(() => app.evaluate(`!!document.querySelector("main button")`), `${width}: Home`);
      await app.click("^Items");
      await waitFor(() => app.evaluate(`!![...document.querySelectorAll("input")].find((i) => i.placeholder === "Find item" && i.offsetParent)`), `${width}: Find item`);
      await sleep(300);
      assertRing(await tabTo(app, /Find item/, `${width} Find item`), `${width} Find item`);
      await app.click("Bread");
      await waitFor(() => app.evaluate(`!![...document.querySelectorAll("label")].find((l) => /^Item name/.test(l.textContent.trim()) && l.offsetParent)`), `${width}: Edit item`);
      await sleep(300);
      assertRing(await tabTo(app, /Item name/, `${width} Item name`, 80), `${width} Item name`);
    }
  });
});
