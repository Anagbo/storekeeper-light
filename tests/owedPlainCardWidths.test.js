import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, waitFor, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV } from "./helpers/lookChecks.js";

// 32 plain card (22 Nov 2026), real Edge at 340, 360 and 393px: a ~40 character name with a Late tag and
// GH₵12,345.00 and a short name. No sideways scroll; the name stops at two lines with an ellipsis; the tag
// is one line; the amount is whole; Collect, WhatsApp and Call are visible and at least 48px tall; no pink.
const LONG = "Nana Akosua Frimpomaa Asamoah-Boateng Jnr";
const sale = (name, amount, days) => `await recordCreditSale({ name: ${JSON.stringify(name)}, phone: "0244123456", amountPesewas: ${amount}, dueDate: new Date(Date.now() + ${days} * 86400000).toISOString().slice(0, 10), now: Date.now() - 86400000 * 40 });`;
const SEEDS = { owed: `await setPreference("posSetupCompleted", true); ${sale(LONG, 1234500, -9)} ${sale("Yaw", 1200, 5)}` };

const MEASURE = `(() => {
  document.getAnimations().forEach((a) => { try { a.finish(); } catch {} });
  const box = (el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, l: r.left, r: r.right }; };
  const lines = (el) => { const tops = new Set(); const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { if (!n.textContent.trim()) continue; const r = document.createRange(); r.selectNodeContents(n); for (const b of r.getClientRects()) if (b.width > 0) tops.add(Math.round(b.top / 4)); } return tops.size; };
  const summary = document.querySelector("[data-owed-summary]");
  return {
    innerWidth, scrollWidth: document.documentElement.scrollWidth,
    pink: [...document.querySelectorAll("main [class*='bg-rose-']")].filter((el) => !el.closest("[data-party-tag]")).map((el) => el.className),
    summary: summary && { ...box(summary), text: summary.textContent, color: getComputedStyle(summary.querySelector("[data-owed-total]")).color },
    rows: [...document.querySelectorAll("main article")].map((card) => {
      const name = card.querySelector("[data-party-name]");
      const amount = card.querySelector("[data-party-amount]");
      const tag = card.querySelector("[data-party-tag] > *");
      const controls = [...card.querySelectorAll("button, a[href]")].filter((el) => !el.hasAttribute("data-person-open")).map((el) => ({ label: el.getAttribute("aria-label") || el.textContent.trim(), ...box(el) }));
      return {
        card: box(card), name: name.textContent, nameH: name.getBoundingClientRect().height, lineH: parseFloat(getComputedStyle(name).lineHeight),
        clamp: getComputedStyle(name).webkitLineClamp, overflow: getComputedStyle(name).overflow, textOverflow: getComputedStyle(name).textOverflow,
        amount: amount.textContent, amountLines: lines(amount), amountClipped: amount.scrollWidth > amount.clientWidth + 0.5, amountR: amount.getBoundingClientRect().right,
        tagLines: tag ? lines(tag) : 0, controls
      };
    })
  };
})()`;

test("32 plain card: long name, tag, amount and controls fit at 340/360/393", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const width of [340, 360, 393]) {
      await app.open("owed", width, 740);
      await app.shows("^Collect");
      await app.steps(["^Owed$"]);
      await waitFor(() => app.evaluate(`document.querySelectorAll("main article").length === 2`), "32 with its rows");
      await sleep(300);
      const m = await app.evaluate(MEASURE);
      const at = `${width}px`;
      assert.ok(m.scrollWidth <= m.innerWidth, `${at}: no sideways scroll (${m.scrollWidth} > ${m.innerWidth})`);
      assert.deepEqual(m.pink, [], `${at}: no pink block outside the tags`);
      assert.match(m.summary.text, /People who owe you/);
      assert.match(m.summary.text, /GH₵12,357\.00/);
      assert.equal(m.summary.color, "rgb(127, 29, 29)", `${at}: total is #7F1D1D`);
      for (const row of m.rows) {
        const what = `${at} "${row.name.slice(0, 12)}"`;
        assert.ok(row.card.l >= 0 && row.card.r <= m.innerWidth, `${what}: card inside the screen`);
        assert.ok(row.nameH <= row.lineH * 2 + 1, `${what}: name at most two lines (${row.nameH} vs ${row.lineH})`);
        assert.equal(row.amountLines, 1, `${what}: amount ${row.amount} on one line`);
        assert.ok(!row.amountClipped && row.amountR <= row.card.r, `${what}: amount not clipped`);
        assert.ok(row.tagLines <= 1, `${what}: tag on one line`);
        const labels = row.controls.map((control) => control.label);
        for (const want of [/^Collect/, /^WhatsApp/, /^Call/]) assert.ok(labels.some((label) => want.test(label)), `${what}: ${want} visible`);
        for (const control of row.controls) assert.ok(control.h >= 48 && control.w >= 48 - 0.5 && control.r <= m.innerWidth, `${what}: "${control.label}" is 48px or taller and on screen (${control.w}x${control.h})`);
      }
      const long = m.rows.find((row) => row.name.startsWith("Nana"));
      assert.ok(long.nameH > long.lineH + 1 || width >= 393, `${at}: long name wraps`);
      assert.ok(long.clamp === "2" && long.overflow === "hidden", `${at}: the long name is cut at two lines (clamp ${long.clamp}, ${long.overflow})`);
    }
  });
});
