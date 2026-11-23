import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, waitFor, withEdgeApp } from "./helpers/edgeApp.js";

// Wide D10 (19 A little at a time) in real Edge at 768x1024, 1024x768, 1280x800 and 1440x900: Kofi Mensah
// owes GH₵987,700.00, a GH₵12,345.00 sale on credit makes Owed GH₵1,000,045.00; GH₵12,345.00 paid today
// in cash. Two columns from 1024 (summary right), stacked at 768; no sideways scroll; no clipped amount;
// one Paying today panel; Save plan at the bottom of the summary; labels 17px or larger, helper lines
// 15px or larger (none 16px); targets 48px or taller.
const SEEDS = { kofi: `await setPreference("posSetupCompleted", true); await recordCreditSale({ name: "Kofi Mensah", amountPesewas: 98770000, now: Date.now() - 3 * 86400000 });` };

const MEASURE = `(() => {
  document.getAnimations().forEach((a) => { try { a.finish(); } catch {} });
  const box = (el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, l: r.left, r: r.right, t: r.top, b: r.bottom }; };
  const lines = (el) => { const tops = new Set(); const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { if (!n.textContent.trim() || n.parentElement.closest("[aria-hidden=true]")) continue; const r = document.createRange(); r.selectNodeContents(n); for (const b of r.getClientRects()) if (b.width > 0) tops.add(Math.round(b.top / 4)); } return tops.size; };
  const panel = document.querySelector("[data-task-column]");
  if (!panel) return null;
  const form = panel.querySelector("[data-d10-form]"), summary = panel.querySelector("[data-d10-summary]");
  const name = (el) => el.getAttribute("aria-label") || el.textContent.replace(/\\s+/g, " ").trim();
  const controls = [...panel.querySelectorAll("button, input")].filter((el) => el.getClientRects().length).map((el) => ({ label: name(el) || el.type, lines: el.tagName === "BUTTON" ? lines(el) : 1, overflow: el.tagName === "BUTTON" && el.scrollWidth > el.clientWidth + 0.5, ...box(el.tagName === "INPUT" && el.type !== "date" ? el.parentElement : el) }));
  const texts = [];
  const w = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const el = n.parentElement;
    if (!n.textContent.trim() || el.closest("[aria-hidden=true]") || !el.getClientRects().length) continue;
    const cs = getComputedStyle(el);
    texts.push({ text: n.textContent.trim().slice(0, 40), size: parseFloat(cs.fontSize), clipped: el.scrollWidth > el.clientWidth + 0.5 && cs.overflow !== "visible" });
  }
  const save = [...summary.querySelectorAll("button")].find((b) => /Save plan/.test(b.textContent));
  const paying = [...document.querySelectorAll("[data-paying-today]")];
  const owed = summary.querySelector("[data-owed-tile] p:last-child");
  const payingBox = paying[0] && box(paying[0]);
  const amountEdges = paying[0] ? [...paying[0].querySelectorAll("[data-paying-today-amount]")].map((el) => Math.round(el.getBoundingClientRect().right)) : [];
  return {
    innerWidth, scrollWidth: document.documentElement.scrollWidth,
    panel: box(panel), form: box(form), summary: box(summary), save: save && { ...box(save), lines: lines(save) },
    lastInSummary: summary.lastElementChild.contains(save),
    paying: paying.length, payingInSummary: paying.every((el) => summary.contains(el)), payingBg: paying[0] && getComputedStyle(paying[0]).backgroundColor, payingBorder: paying[0] && getComputedStyle(paying[0]).borderTopWidth, payingBox, amountEdges,
    owed: owed && { text: owed.textContent, size: owed.style.fontSize, px: parseFloat(getComputedStyle(owed).fontSize), clipped: owed.scrollWidth > owed.clientWidth + 0.5 },
    controls, texts,
    text: panel.textContent
  };
})()`;

const SIZES = [[768, 1024], [1024, 768], [1280, 800], [1440, 900]];
const LABELS_17 = ["How much each time?", "How often?", "First payment", "Amount paid today", "Next payment date", "How is it paid?", "Every week", "Every 2 weeks", "Every month", "Today", "Cash", "MoMo", "Split payment", "Owed", "Paying today", "Total today"];

test("D10 in real Edge at 768, 1024, 1280 and 1440 with GH₵12,345.00 and GH₵1,000,045.00", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS }, async (app) => {
    const key = async (k) => {
      await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: `Digit${k}`, text: k, windowsVirtualKeyCode: k.charCodeAt(0) });
      await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: `Digit${k}`, windowsVirtualKeyCode: k.charCodeAt(0) });
    };
    const field = async (label, text) => {
      await waitFor(() => app.evaluate(`(() => { const el = document.querySelector('input[aria-label="${label}"]'); if (!el) return false; el.focus(); el.select?.(); return true; })()`), label);
      await app.type(text);
      await sleep(200);
    };
    for (const [width, height] of SIZES) {
      const at = `${width}x${height}`;
      await app.open("kofi", width, height);
      await app.steps(["^Sell$"]);
      for (const d of "12345") { await key(d); await sleep(60); }
      await sleep(300);
      await app.steps(["^Owe$", "Kofi Mensah", "^Next", "A little at a time"]);
      await waitFor(() => app.evaluate(`!!document.querySelector("[data-d10]")`), `${at}: 19 D10`);
      await field("How much each time?", "2");
      // The longest Next cycle label: "Next cycle (Every 2 weeks)".
      await app.steps(["^Every 2 weeks$", "^Today$"]);
      await field("Amount paid today", "12345");
      await app.steps(["^Cash$"]);
      await sleep(400);
      const m = await app.evaluate(MEASURE);
      assert.ok(m, `${at}: task column`);
      assert.ok(m.scrollWidth <= m.innerWidth, `${at}: no sideways scroll (${m.scrollWidth})`);
      assert.ok(m.panel.w <= 1040.5, `${at}: panel 1040px at most (${m.panel.w})`);
      if (width >= 1024) {
        assert.ok(m.summary.l >= m.form.r && Math.abs(m.summary.t - m.form.t) < 1, `${at}: summary to the right of the form`);
      } else {
        assert.ok(m.summary.t >= m.form.b, `${at}: summary stacked under the form`);
      }
      assert.equal(m.paying, 1, `${at}: exactly one Paying today panel`);
      assert.ok(m.payingInSummary, `${at}: panel in the summary`);
      assert.equal(m.payingBg, "rgb(241, 245, 249)", `${at}: soft tile`);
      assert.equal(m.payingBorder, "0px", `${at}: no border`);
      assert.equal(new Set(m.amountEdges).size, 1, `${at}: amounts share one right edge (${m.amountEdges})`);
      assert.match(m.text, /Total today\s*GH₵12,345\.00/);
      assert.match(m.text, /Still owed · Kofi Mensah\s*GH₵987,700\.00/);
      assert.equal(m.owed.text, "GH₵1,000,045.00");
      assert.ok(!m.owed.clipped && m.owed.px >= 28 && m.owed.px <= 40, `${at}: Owed ${m.owed.px}px, not clipped`);
      assert.ok(m.save && m.lastInSummary && m.save.lines === 1 && m.save.w <= 240.5, `${at}: Save plan at the bottom of the summary (${m.save?.w}px)`);
      assert.ok(Math.abs(m.save.b - Math.max(m.form.b, m.summary.b)) < 1, `${at}: Save plan pinned at the bottom`);
      for (const c of m.controls) {
        assert.ok(!c.overflow && c.r <= m.panel.r + 0.5, `${at}: "${c.label}" not clipped`);
        assert.ok(c.h >= 48, `${at}: "${c.label}" 48px or taller (${c.h})`);
      }
      assert.deepEqual(m.texts.filter((t) => t.clipped && /GH₵/.test(t.text)), [], `${at}: no clipped amount`);
      assert.deepEqual(m.texts.filter((t) => t.size < 15 || t.size === 16), [], `${at}: no text under 15px or at 16px`);
      for (const label of LABELS_17) {
        const found = m.texts.find((t) => t.text === label);
        assert.ok(found && found.size >= 17, `${at}: "${label}" 17px or larger (${found?.size})`);
      }
      const wrapped = m.controls.filter((c) => c.lines > 1).map((c) => c.label);
      assert.deepEqual(wrapped, [], `${at}: no wrapped button label`);
      console.log(`${at}: panel ${Math.round(m.panel.w)}px, form ${Math.round(m.form.w)}px, summary ${Math.round(m.summary.w)}px, Owed ${m.owed.px}px, wrapped: ${wrapped.join("; ") || "none"}`);
    }
  });
});
