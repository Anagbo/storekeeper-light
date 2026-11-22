import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV } from "./helpers/lookChecks.js";

// Wiring 22 (22 Nov 2026), real Edge: with Hide amounts on no customer amount is visible on Home (the
// Collect first rows, and on wide the transactions table), and Spent money is the outlined dark "other"
// button (never amber) that does not wrap, with no sideways scroll, at 340, 360, 393 and 1280x800.

const due = (days) => `new Date(Date.now() + ${days} * 86400000).toISOString().slice(0, 10)`;
const head = `await setPreference("posSetupCompleted", true);`;
const owe = `await recordCreditSale({ name: "Ama Mensah", phone: "0244123456", amountPesewas: 1234567, dueDate: ${due(-9)}, now: Date.now() - 86400000 * 40 });`;
const today = `await recordCashSale({ amountPesewas: 987654 });`;
const SEEDS = {
  hidden: `${head} await setPreference("hideAmounts", true); ${owe} ${today}`,
  shown: `${head} await setPreference("hideAmounts", false); ${owe} ${today}`
};

const MEASURE = `(() => {
  document.getAnimations().forEach((a) => { try { a.finish(); } catch {} });
  const lines = (el) => { const tops = new Set(); const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { if (!n.textContent.trim()) continue; const r = document.createRange(); r.selectNodeContents(n); for (const b of r.getClientRects()) if (b.width > 0) tops.add(Math.round(b.top / 4)); } return tops.size; };
  const spent = document.querySelector("[data-home-spent]");
  const cs = getComputedStyle(spent);
  const text = document.querySelector("main").innerText;
  const labels = [...document.querySelectorAll("[aria-label]")].map((el) => el.getAttribute("aria-label")).join(" ");
  return {
    innerWidth, scrollWidth: document.documentElement.scrollWidth,
    spent: { lines: lines(spent), border: cs.borderTopWidth + " " + cs.borderTopColor, bg: cs.backgroundColor, color: cs.color, label: spent.getAttribute("aria-label") || spent.textContent.trim() },
    sell: getComputedStyle(document.querySelector("[data-home-sell]")).backgroundColor,
    amounts: text.match(/[0-9][0-9,]*[.][0-9]{2}/g) || [],
    labelAmounts: labels.match(/[0-9][0-9,]*[.][0-9]{2}/g) || [],
    masked: document.querySelectorAll("[data-hidden-amount]").length
  };
})()`;

test("22: Hide amounts masks customer amounts; Spent money is the outlined dark button, one line, no sideways scroll", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const [width, height] of [[340, 740], [360, 740], [393, 851], [1280, 800]]) {
      const at = `${width}px`;
      await app.open("hidden", width, height);
      await app.shows("^Collect");
      await sleep(300);
      const m = await app.evaluate(MEASURE);
      assert.ok(m.scrollWidth <= m.innerWidth, `${at}: no sideways scroll`);
      assert.deepEqual(m.amounts, [], `${at}: no amount visible while hidden`);
      assert.deepEqual(m.labelAmounts, [], `${at}: no amount in an accessible name while hidden`);
      assert.ok(m.masked >= 3, `${at}: masked figures (${m.masked})`);
      assert.equal(m.spent.lines, 1, `${at}: Spent money on one line`);
      assert.equal(m.spent.border, "2px rgb(15, 23, 42)", `${at}: 2px #0F172A border`);
      assert.equal(m.spent.bg, "rgb(255, 255, 255)", `${at}: white fill`);
      assert.equal(m.spent.color, "rgb(15, 23, 42)", `${at}: dark text`);
      assert.match(m.spent.label, /Spent money/, `${at}: label unchanged`);
      assert.notEqual(m.sell, m.spent.bg, `${at}: Sell is the solid one`);

      await app.open("shown", width, height);
      await app.shows("^Collect");
      await sleep(300);
      const s = await app.evaluate(MEASURE);
      assert.ok(s.amounts.length >= 2, `${at}: amounts show when Hide is off`);
    }
  });
});
