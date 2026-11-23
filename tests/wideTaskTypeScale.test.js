import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, waitFor, withEdgeApp } from "./helpers/edgeApp.js";

// design_principles (4): in the wide task column text-base is 17px, text-sm/xs/[15px] are 15px and
// unsized text inherits 17px. Real Edge at 768x1024 and 1280x800 on Spent money, Who owes you?,
// Split payment (16) and the sale result (30): no text node of 16px or below 15px, no sideways scroll,
// no clipped GH₵ amount, no wrapped button label.
const SEEDS = { base: `await setPreference("posSetupCompleted", true);` };
const ENV = { VITE_ENABLE_POS_RECEIPTS: "true" };
const MEASURE = `(() => {
  document.getAnimations().forEach((a) => { try { a.finish(); } catch {} });
  const panel = document.querySelector("[data-task-column]");
  if (!panel) return null;
  const lines = (el) => { const tops = new Set(); const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { if (!n.textContent.trim() || n.parentElement.closest("[aria-hidden=true]")) continue; const r = document.createRange(); r.selectNodeContents(n); for (const b of r.getClientRects()) if (b.width > 0) tops.add(Math.round(b.top / 4)); } return tops.size; };
  const bad = [], clipped = [];
  const w = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const el = n.parentElement;
    if (!n.textContent.trim() || el.closest("[aria-hidden=true]") || !el.getClientRects().length) continue;
    const cs = getComputedStyle(el), size = parseFloat(cs.fontSize);
    if (size === 16 || size < 15) bad.push(size + "px " + n.textContent.trim().slice(0, 30));
    if (/GH₵/.test(n.textContent) && el.scrollWidth > el.clientWidth + 0.5 && cs.overflow !== "visible") clipped.push(n.textContent.trim());
  }
  const wrapped = [...panel.querySelectorAll("button")].filter((b) => b.getClientRects().length && lines(b) > 1).map((b) => b.getAttribute("aria-label") || b.textContent.trim());
  return { scroll: document.documentElement.scrollWidth <= innerWidth, bad, clipped, wrapped, text: panel.textContent };
})()`;

test("wide task column type scale: no 16px or sub-15px text, nothing wraps or clips (768, 1280)", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    const key = async (k) => {
      await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: `Digit${k}`, text: k, windowsVirtualKeyCode: k.charCodeAt(0) });
      await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: `Digit${k}`, windowsVirtualKeyCode: k.charCodeAt(0) });
    };
    const amount = async (digits) => { for (const d of digits) { await key(d); await sleep(60); } await sleep(300); };
    const check = async (at, name) => {
      await sleep(400);
      const m = await app.evaluate(MEASURE);
      assert.ok(m, `${at} ${name}: task column present`);
      assert.ok(m.scroll, `${at} ${name}: no sideways scroll`);
      assert.deepEqual(m.bad, [], `${at} ${name}: text sizes`);
      assert.deepEqual(m.clipped, [], `${at} ${name}: clipped amounts`);
      assert.deepEqual(m.wrapped, [], `${at} ${name}: wrapped button labels`);
      return m;
    };
    for (const [w, h] of [[768, 1024], [1280, 800]]) {
      const at = `${w}x${h}`;
      await app.open("base", w, h);
      await app.steps(["^Spent money$"]);
      await check(at, "Spent money");
      await app.open("base", w, h);
      await app.steps(["^Sell$"]);
      await amount("12345");
      await app.steps(["^Owe$"]);
      await waitFor(() => app.evaluate(`!!document.querySelector("[data-task-column]")`), `${at}: Owe task column`);
      await check(at, "Who owes you?");
      await app.open("base", w, h);
      await app.steps(["^Sell$"]);
      await amount("1000045");
      await app.steps(["^Split payment$"]);
      await waitFor(() => app.evaluate(`!!document.querySelector("[data-task-column]")`), `${at}: 16`);
      const m16 = await check(at, "Split 16");
      assert.match(m16.text, /GH₵1,000,045\.00/);
      await app.open("base", w, h);
      await app.steps(["^Sell$"]);
      await amount("12345");
      await app.steps(["^Cash$", "^Done$", "^Yes, save"]);
      await waitFor(() => app.evaluate(`!!document.querySelector("[data-result-amount]")`), `${at}: 30`);
      const m30 = await check(at, "30 result");
      assert.match(m30.text, /GH₵12,345\.00/);
    }
  });
});
