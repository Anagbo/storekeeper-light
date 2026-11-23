import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, waitFor, withEdgeApp } from "./helpers/edgeApp.js";

// Wide D9 (20 and 55 on one screen) in real Edge at 768x1024, 1024x768, 1280x800 and 1440x900, with a
// GH₵12,345.00 item and a long name in the sale: no sideways scroll, the total and every line amount
// whole, no wrapped label (Split payment may take two lines), the four tiles in a 2x2 grid, text 17px
// or larger (tags 15px), 38 as a centred dialog over D9, focus rings visible.
const SEEDS = {
  items: `await setPreference("posSetupCompleted", true);
    await createProduct({ name: "Generator", pricePesewas: 1234500 });
    await createProduct({ name: "Cooking oil premium", pricePesewas: 2500 });
    await createProduct({ name: "Bread", pricePesewas: 500 });`
};

const MEASURE = `(() => {
  document.getAnimations().forEach((a) => { try { a.finish(); } catch {} });
  const box = (el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, l: r.left, r: r.right, t: r.top, b: r.bottom }; };
  const lines = (el) => { const tops = new Set(); const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { if (!n.textContent.trim() || n.parentElement.closest("[aria-hidden=true]")) continue; const r = document.createRange(); r.selectNodeContents(n); for (const b of r.getClientRects()) if (b.width > 0) tops.add(Math.round(b.top / 4)); } return tops.size; };
  const name = (el) => el.getAttribute("aria-label") || el.textContent.replace(/\\s+/g, " ").trim();
  // A selected tile's ×n badge sits over the tile's corner on purpose (wiring 20 "Item tiles"); a tile is
  // clipped only when its name or price goes past it.
  const overflow = (el) => el.matches("[data-item-tile]")
    ? [...el.children].filter((c) => !c.matches("[data-count-badge]")).some((c) => c.scrollWidth > c.clientWidth + 0.5 || c.getBoundingClientRect().right > el.getBoundingClientRect().right + 0.5)
    : el.scrollWidth > el.clientWidth + 0.5;
  const controls = [...document.querySelectorAll("main button")].filter((el) => el.getClientRects().length).map((el) => ({ label: name(el), lines: lines(el), overflow: overflow(el), ...box(el) }));
  const tiles = ["Cash", "MoMo", "Owe", "Split payment"].map((label) => controls.find((c) => c.label === label));
  const total = document.querySelector("[aria-labelledby=this-sale] output");
  const amounts = [...document.querySelectorAll("[aria-labelledby=this-sale] b")].map((el) => ({ text: el.textContent, lines: lines(el), clipped: el.scrollWidth > el.clientWidth + 0.5 }));
  const small = [...document.querySelectorAll("main p, main output, main h1, main h2, main b, main strong, main span")].filter((el) => el.getClientRects().length && el.textContent.trim() && !el.closest("[aria-hidden=true], .sr-only") && !el.querySelector("p, span, strong, b"))
    .filter((el) => parseFloat(getComputedStyle(el).fontSize) < (el.matches("[data-count-badge]") ? 15 : 17)).map((el) => el.tagName + " " + getComputedStyle(el).fontSize + " " + el.textContent.trim().slice(0, 30));
  return {
    innerWidth, scrollWidth: document.documentElement.scrollWidth, d9: !!document.querySelector("[data-sell-items-wide]"),
    total: { text: total.textContent, lines: lines(total), clipped: total.scrollWidth > total.clientWidth + 0.5, size: getComputedStyle(total).fontSize },
    controls, tiles, amounts, small
  };
})()`;

const DIALOG = `(() => { const d = document.querySelector("[role=dialog][aria-modal=true]"); if (!d) return null; const r = d.getBoundingClientRect(); return { w: r.width, l: r.left, r: r.right, t: r.top, b: r.bottom, innerWidth, innerHeight, behind: !!document.querySelector("[inert] [data-sell-items-wide]") }; })()`;

const FOCUS = `(() => [...document.querySelectorAll("main button, main input")].filter((el) => el.getClientRects().length && !el.disabled).map((el) => { el.focus(); const target = el.matches("input") ? el.closest("label") : el; const cs = getComputedStyle(target); return { label: el.getAttribute("aria-label") || el.placeholder || el.textContent.trim(), visible: el.matches(":focus-visible"), style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) }; }))()`;

const SIZES = [[768, 1024], [1024, 768], [1280, 800], [1440, 900]];
// The phone line controls of 20 are 44px (wiring 20 "Line controls and amounts").
const LINE_CONTROL = /^(Less|More|Quantity|Remove) /;

test("wide Sell with items (D9) at 768, 1024, 1280 and 1440: fits, amounts whole, labels on one line, 38 as a dialog, focus rings", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS }, async (app) => {
    const key = async (k, code = k, vk = k.charCodeAt(0)) => {
      await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk });
      await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk });
    };
    for (const [width, height] of SIZES) {
      const at = `${width}x${height}`;
      await app.open("items", width, height);
      await app.steps(["^Sell$", "Add items", "^Generator, ", "^Add 1"]);
      await app.steps(["^Cooking oil premium, "]);
      const d = await waitFor(() => app.evaluate(DIALOG), `${at}: 38 as a dialog`);
      assert.ok(d.behind, `${at}: D9 behind the dialog, inert`);
      assert.ok(Math.abs(d.w - Math.min(520, width - 32)) < 1 && d.l >= 0 && d.r <= d.innerWidth && d.b <= d.innerHeight, `${at}: dialog centred, 520px (${d.w})`);
      await key("Escape", "Escape", 27);
      await sleep(200);
      assert.equal(await app.evaluate(DIALOG), null, `${at}: Escape closes 38`);
      await app.steps(["^Cooking oil premium, ", "^Add 1"]);
      await sleep(300);
      const m = await app.evaluate(MEASURE);
      assert.ok(m.d9, `${at}: D9`);
      assert.ok(m.scrollWidth <= m.innerWidth, `${at}: no sideways scroll (${m.scrollWidth})`);
      assert.equal(m.total.text, "GH₵12,370.00", `${at}: the total`);
      assert.ok(m.total.lines === 1 && !m.total.clipped, `${at}: total whole on one line (${m.total.size})`);
      for (const a of m.amounts) assert.ok(a.lines === 1 && !a.clipped, `${at}: line amount ${a.text} whole`);
      assert.ok(m.amounts.some((a) => a.text === "GH₵12,345.00"), `${at}: GH₵12,345.00 shown`);
      for (const c of m.controls) {
        assert.ok(!c.overflow && c.r <= m.innerWidth + 0.5, `${at}: "${c.label}" not clipped`);
        if (!/^(Generator|Cooking|Bread)/.test(c.label)) assert.ok(c.lines <= (c.label === "Split payment" ? 2 : 1), `${at}: "${c.label}" on one line (${c.lines})`);
        assert.ok(c.h >= (LINE_CONTROL.test(c.label) ? 44 : 48), `${at}: "${c.label}" tall enough (${c.h})`);
      }
      const [cash, momo, owe, split] = m.tiles;
      assert.ok(Math.abs(cash.t - momo.t) < 1 && Math.abs(owe.t - split.t) < 1 && owe.t > cash.b - 1 && Math.abs(cash.l - owe.l) < 1, `${at}: the tiles are a 2x2 grid`);
      assert.deepEqual(m.small, [], `${at}: text 17px or larger (tags 15px)`);
      await key("Tab", "Tab", 9);
      const rings = await app.evaluate(FOCUS);
      for (const r of rings) assert.ok(r.visible && r.style === "solid" && r.width === 3, `${at}: focus ring on "${r.label}" (${r.style} ${r.width})`);
      console.log(`${at}: total ${m.total.size}, ${m.controls.length} controls`);
    }
  });
});
