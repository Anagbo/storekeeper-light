import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, waitFor, withEdgeApp } from "./helpers/edgeApp.js";

// Wide 15 (D2, D15) in real Edge at 768x1024, 1024x768, 1280x800 and 1440x900, with a sale saved
// today: the amount GH₵12,345.00 typed on the keyboard is whole on one line, no sideways scroll, no
// wrapped label, the four tiles in a 2x2 grid, Last sale shown, Done at the bottom of the right column,
// targets 48px or taller, focus rings visible.
const SEEDS = { sold: `await setPreference("posSetupCompleted", true); await recordCashSale({ amountPesewas: 800, now: Date.now() - 60000 });` };

const MEASURE = `(() => {
  document.getAnimations().forEach((a) => { try { a.finish(); } catch {} });
  const box = (el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, l: r.left, r: r.right, t: r.top, b: r.bottom }; };
  const lines = (el) => { const tops = new Set(); const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { if (!n.textContent.trim() || n.parentElement.closest("[aria-hidden=true]")) continue; const r = document.createRange(); r.selectNodeContents(n); for (const b of r.getClientRects()) if (b.width > 0) tops.add(Math.round(b.top / 4)); } return tops.size; };
  const amount = document.querySelector("main output");
  const name = (el) => el.getAttribute("aria-label") || el.textContent.replace(/\\s+/g, " ").trim();
  const controls = [...document.querySelectorAll("main button")].filter((el) => el.getClientRects().length).map((el) => ({ label: name(el), lines: lines(el), overflow: el.scrollWidth > el.clientWidth + 0.5, ...box(el) }));
  const tiles = ["Cash", "MoMo", "Owe", "Split payment"].map((label) => controls.find((c) => c.label === label));
  const done = controls.find((c) => c.label === "Done");
  const right = document.querySelector("[data-sell-wide] > div:last-child");
  const small = [...document.querySelectorAll("main p, main output, main h1, main b, main span")].filter((el) => el.getClientRects().length && el.textContent.trim() && !el.closest("[aria-hidden=true]")).filter((el) => parseFloat(getComputedStyle(el).fontSize) < 17).map((el) => el.tagName + " " + getComputedStyle(el).fontSize + " " + el.textContent.trim().slice(0, 30));
  return {
    innerWidth, innerHeight, scrollWidth: document.documentElement.scrollWidth, wide: !!document.querySelector("[data-sell-wide]"),
    amount: { text: amount.textContent, lines: lines(amount), clipped: amount.scrollWidth > amount.clientWidth + 0.5, size: getComputedStyle(amount).fontSize, weight: getComputedStyle(amount).fontWeight, ...box(amount) },
    controls, tiles, done, right: right && box(right), small,
    lastSale: document.querySelector("[data-last-sale]")?.textContent ?? ""
  };
})()`;

const FOCUS = `(() => [...document.querySelectorAll("main button")].filter((el) => el.getClientRects().length && !el.disabled).map((el) => { el.focus(); const cs = getComputedStyle(el); return { label: el.getAttribute("aria-label") || el.textContent.trim(), visible: el.matches(":focus-visible"), style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) }; }))()`;

const SIZES = [[768, 1024], [1024, 768], [1280, 800], [1440, 900]];

test("wide Sell at 768, 1024, 1280 and 1440: fits, GH₵12,345.00 whole, labels on one line, Last sale, focus rings", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS }, async (app) => {
    const key = async (k, code = k) => {
      await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, text: k.length === 1 ? k : undefined, windowsVirtualKeyCode: k === "Tab" ? 9 : k.charCodeAt(0) });
      await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: k === "Tab" ? 9 : k.charCodeAt(0) });
    };
    for (const [width, height] of SIZES) {
      const at = `${width}x${height}`;
      await app.open("sold", width, height);
      await app.steps(["^Sell$"]);
      await waitFor(() => app.evaluate(`!!document.querySelector("[data-last-sale]")`), `${at}: the Last sale box`);
      for (const digit of "12345") { await key(digit, `Digit${digit}`); await sleep(60); }
      await sleep(300);
      const m = await app.evaluate(MEASURE);
      assert.ok(m.wide, `${at}: the wide Sell layout`);
      assert.ok(m.scrollWidth <= m.innerWidth, `${at}: no sideways scroll (${m.scrollWidth})`);
      assert.equal(m.amount.text, "GH₵12,345.00", `${at}: typed on the keyboard`);
      assert.ok(m.amount.lines === 1 && !m.amount.clipped, `${at}: amount whole on one line (${m.amount.size})`);
      assert.ok(parseFloat(m.amount.size) <= 56 && parseFloat(m.amount.size) >= 28 && m.amount.weight === "700", `${at}: hero ${m.amount.size} ${m.amount.weight}`);
      for (const c of m.controls) {
        assert.ok(!c.overflow && c.r <= m.innerWidth + 0.5, `${at}: "${c.label}" not clipped`);
        assert.ok(c.lines <= 1, `${at}: "${c.label}" on one line (${c.lines})`);
        assert.ok(c.h >= 48, `${at}: "${c.label}" 48px or taller (${c.h})`);
      }
      const [cash, momo, owe, split] = m.tiles;
      assert.ok(Math.abs(cash.t - momo.t) < 1 && Math.abs(owe.t - split.t) < 1 && owe.t > cash.b - 1 && Math.abs(cash.l - owe.l) < 1, `${at}: the tiles are a 2x2 grid`);
      assert.match(m.lastSale, /^Last saleGH₵8\.00 · Cash\d\d:\d\d/, `${at}: Last sale (${m.lastSale})`);
      assert.ok(Math.abs(m.done.b - (m.right.b - 26 - 8)) < 2, `${at}: Done at the bottom of the right column, the reason line under it`);
      assert.ok(m.done.b <= m.innerHeight, `${at}: Done visible without scrolling (${m.done.b} of ${m.innerHeight})`);
      assert.deepEqual(m.small, [], `${at}: all text 17px or larger`);
      await key("Tab");
      const rings = await app.evaluate(FOCUS);
      for (const r of rings) assert.ok(r.visible && r.style === "solid" && r.width === 3, `${at}: focus ring on "${r.label}" (${r.style} ${r.width})`);
      console.log(`${at}: amount ${m.amount.size}, Done ${Math.round(m.done.b)} of ${m.innerHeight}`);
    }
  });
});
