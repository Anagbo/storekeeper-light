import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, waitFor, withEdgeApp } from "./helpers/edgeApp.js";

// Wide task column (wide_layout.page_types.task_column), D5 and D11 in real Edge at 768x1024, 1024x768,
// 1280x800 and 1440x900, receipts on: a GH₵12,345.00 cash sale ends on 30 inside the 640px panel
// (centred, no sideways scroll, text 17px or larger, targets 48px or taller, nothing clipped, Send and
// Copy side by side, New sale above Done, the 56px bold hero), Enter there is New sale; then
// GH₵1,000,045.00 with Split payment opens 16 in the same panel.
const SEEDS = { base: `await setPreference("posSetupCompleted", true);` };
const ENV = { VITE_ENABLE_POS_RECEIPTS: "true" };

const MEASURE = `(() => {
  document.getAnimations().forEach((a) => { try { a.finish(); } catch {} });
  const box = (el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, l: r.left, r: r.right, t: r.top, b: r.bottom }; };
  const lines = (el) => { const tops = new Set(); const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { if (!n.textContent.trim() || n.parentElement.closest("[aria-hidden=true]")) continue; const r = document.createRange(); r.selectNodeContents(n); for (const b of r.getClientRects()) if (b.width > 0) tops.add(Math.round(b.top / 4)); } return tops.size; };
  const panel = document.querySelector("[data-task-column]");
  const area = document.querySelector("[data-page-area]");
  const name = (el) => el.getAttribute("aria-label") || el.textContent.replace(/\\s+/g, " ").trim();
  const controls = panel ? [...panel.querySelectorAll("button")].filter((el) => el.getClientRects().length).map((el) => ({ label: name(el), lines: lines(el), overflow: el.scrollWidth > el.clientWidth + 0.5, ...box(el) })) : [];
  const texts = [];
  if (panel) { const w = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { const el = n.parentElement; if (!n.textContent.trim() || el.closest("[aria-hidden=true]") || !el.getClientRects().length) continue; texts.push({ text: n.textContent.trim().slice(0, 40), size: parseFloat(getComputedStyle(el).fontSize), clipped: el.scrollWidth > el.clientWidth + 0.5 && getComputedStyle(el).overflow !== "visible" }); } }
  const hero = document.querySelector("[data-result-amount]");
  return {
    innerWidth, scrollWidth: document.documentElement.scrollWidth,
    panel: panel && box(panel), area: area && box(area), bg: area && getComputedStyle(area).backgroundColor,
    controls, small: texts.filter((t) => t.size < 17), clipped: texts.filter((t) => t.clipped && /GH₵/.test(t.text)),
    text: panel ? panel.textContent : "",
    hero: hero && { text: hero.textContent, size: getComputedStyle(hero).fontSize, weight: getComputedStyle(hero).fontWeight, clipped: hero.scrollWidth > hero.clientWidth + 0.5 }
  };
})()`;

const SIZES = [[768, 1024], [1024, 768], [1280, 800], [1440, 900]];

function checkPanel(m, at) {
  assert.ok(m.panel, `${at}: the task column panel`);
  assert.ok(m.scrollWidth <= m.innerWidth, `${at}: no sideways scroll (${m.scrollWidth})`);
  assert.ok(m.panel.w <= 640.5, `${at}: panel 640px at most (${m.panel.w})`);
  assert.ok(Math.abs((m.panel.l + m.panel.r) / 2 - (m.area.l + m.area.r) / 2) < 1.5, `${at}: panel centred`);
  assert.equal(m.bg, "rgb(241, 245, 249)", `${at}: grey page`);
  for (const c of m.controls) {
    assert.ok(!c.overflow && c.r <= m.panel.r + 0.5, `${at}: "${c.label}" not clipped`);
    assert.ok(c.h >= 48, `${at}: "${c.label}" 48px or taller (${c.h})`);
  }
  assert.deepEqual(m.clipped, [], `${at}: no clipped amount`);
}

test("wide task column at 768, 1024, 1280 and 1440: 30 with GH₵12,345.00 (D11), Enter is New sale, 16 with GH₵1,000,045.00 (D5)", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    const key = async (k, code = k) => {
      const vk = k === "Enter" ? 13 : k.charCodeAt(0);
      await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, text: k.length === 1 ? k : k === "Enter" ? "\r" : undefined, windowsVirtualKeyCode: vk });
      await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk });
    };
    const typeAmount = async (digits) => { for (const digit of digits) { await key(digit, `Digit${digit}`); await sleep(60); } await sleep(300); };
    for (const [width, height] of SIZES) {
      const at = `${width}x${height}`;
      await app.open("base", width, height);
      await app.steps(["^Sell$"]);
      await typeAmount("12345");
      await app.steps(["^Cash$", "^Done$", "^Yes, save"]);
      await waitFor(() => app.evaluate(`!!document.querySelector("[data-result-amount]")`), `${at}: 30 Sale recorded`);
      await sleep(300);
      const m30 = await app.evaluate(MEASURE);
      checkPanel(m30, at);
      assert.deepEqual(m30.small, [], `${at}: 30 text 17px or larger`);
      assert.equal(m30.hero.text, "GH₵12,345.00");
      assert.ok(m30.hero.size === "56px" && m30.hero.weight === "700" && !m30.hero.clipped, `${at}: hero ${m30.hero.size} ${m30.hero.weight}`);
      const send = m30.controls.find((c) => /Send receipt/.test(c.label));
      const copy = m30.controls.find((c) => /Copy receipt/.test(c.label));
      assert.ok(send && copy && Math.abs(send.t - copy.t) < 1 && send.r <= copy.l, `${at}: Send and Copy side by side`);
      for (const c of [send, copy]) assert.equal(c.lines, 1, `${at}: "${c.label}" on one line`);
      const labels = m30.controls.map((c) => c.label);
      assert.ok(labels.indexOf("New sale") > labels.indexOf("Copy receipt") && labels.indexOf("New sale") < labels.indexOf("Done"), `${at}: ${labels.join(", ")}`);

      // Enter with nothing focused is New sale (focus on a button would be that button's own Enter).
      await app.evaluate(`document.activeElement?.blur?.(), true`);
      await key("Enter");
      await waitFor(() => app.evaluate(`!!document.querySelector("[data-sell-wide]")`), `${at}: Enter on 30 opens Sell`);

      await typeAmount("1000045");
      await app.steps(["^Split payment$"]);
      await waitFor(() => app.evaluate(`!!document.querySelector("[data-task-column]") && /Sale total/.test(document.querySelector("[data-task-column]").textContent)`), `${at}: 16 Split payment`);
      await sleep(300);
      const m16 = await app.evaluate(MEASURE);
      checkPanel(m16, at);
      assert.match(m16.text, /GH₵1,000,045\.00/, `${at}: 16 shows the total`);
      console.log(`${at}: panel ${Math.round(m16.panel.w)}px; 16 text under 17px: ${m16.small.map((t) => `${t.size}px "${t.text}"`).join("; ") || "none"}`);
    }
  });
});
