import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, waitFor, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV } from "./helpers/lookChecks.js";

// Today's transactions wide (24, D4) in real Edge at 768x1024, 1024x768, 1280x800 and 1440x900:
// GH₵12,345.00 in every amount and a 40-character name. No sideways scroll, no clipped or wrapped
// amount, no wrapped filter label, the table stays inside its card.
const LONG = "Abena Konadu Asantewaa Mensah-Bonsu Ofor";
const SEEDS = {
  day: `await setPreference("posSetupCompleted", true);
    await recordCashSale({ amountPesewas: 1234500 });
    await recordCreditSale({ name: ${JSON.stringify(LONG)}, amountPesewas: 2469000, initialPaymentPesewas: 1234500 });
    await recordCreditSale({ name: "Yaw", amountPesewas: 1234500 });
    await recordExpense({ amountPesewas: 1234500, paidAmountPesewas: 1234500, category: "transport", paymentMethod: "cash" });`
};

const MEASURE = `(() => {
  document.getAnimations().forEach((a) => { try { a.finish(); } catch {} });
  const box = (el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, l: r.left, r: r.right }; };
  const lines = (el) => { const tops = new Set(); const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { if (!n.textContent.trim()) continue; const r = document.createRange(); r.selectNodeContents(n); for (const b of r.getClientRects()) if (b.width > 0) tops.add(Math.round(b.top / 4)); } return tops.size; };
  const table = document.querySelector("[data-wide-table]");
  const card = table && table.parentElement;
  const amounts = [...document.querySelectorAll("main [data-wide-amount], main [data-cell=money-in], main [data-cell=spent], main [data-cell=owed], main [data-cell^=total-]")].map((el) => ({ text: el.textContent, lines: lines(el), clipped: el.scrollWidth > el.clientWidth + 0.5, size: getComputedStyle(el).fontSize, ...box(el) }));
  const filters = [...document.querySelectorAll("main [aria-pressed]")].map((el) => ({ text: el.textContent, lines: lines(el), h: el.getBoundingClientRect().height }));
  const summary = [...document.querySelectorAll("main [data-summary]")].map((el) => ({ key: el.dataset.summary, ...box(el) }));
  return { innerWidth, scrollWidth: document.documentElement.scrollWidth, table: table && box(table), tableScroll: table && table.scrollWidth, card: card && box(card), padding: [...document.querySelectorAll("main [data-wide-table] td, main [data-wide-table] th")].map((c) => getComputedStyle(c).paddingLeft + "/" + getComputedStyle(c).paddingTop), pagePad: getComputedStyle(document.querySelector("main")).paddingLeft, cols: table && Number(table.dataset.columns), amounts, filters, summary, rows: document.querySelectorAll("[data-wide-row]").length, focusableRows: document.querySelectorAll("[data-wide-row][tabindex], [data-wide-row] button, [data-wide-row] a").length };
})()`;

const SIZES = [[768, 1024], [1024, 768], [1280, 800], [1440, 900]];

test("Today’s transactions wide: table inside its card, amounts whole, filters on one line", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 900_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const [width, height] of SIZES) {
      const at = `${width}x${height}`;
      await app.open("day", width, height);
      await app.click("^Today.s transactions$");
      await waitFor(() => app.evaluate(`!!document.querySelector("[data-wide-table]")`), `${at}: the table`);
      await sleep(300);
      const m = await app.evaluate(MEASURE);
      assert.ok(m.scrollWidth <= m.innerWidth, `${at}: no sideways scroll (${m.scrollWidth} > ${m.innerWidth})`);
      assert.ok(m.tableScroll <= m.table.w + 0.5 && m.table.r <= m.card.r - 2 + 0.5 && m.table.l >= m.card.l + 2 - 0.5, `${at}: the table stays inside its card (table ${m.table.w}, scroll ${m.tableScroll}, card ${m.card.w})`);
      assert.equal(m.cols, width < 1024 ? 5 : 7, `${at}: columns`);
      assert.ok(m.padding.every((p) => p === "8px/8px"), `${at}: cell padding 8px (${[...new Set(m.padding)]})`);
      if (width < 1024) assert.equal(m.pagePad, "20px", `${at}: rail page padding 20px`);
      assert.equal(m.rows, 4, `${at}: four rows`);
      assert.equal(m.focusableRows, 0, `${at}: rows are not focusable`);
      assert.ok(m.amounts.some((a) => a.text === "GH₵12,345.00"), `${at}: the long amount is shown`);
      for (const a of m.amounts) assert.ok(a.lines === 1 && !a.clipped && a.l >= 0 && a.r <= m.innerWidth, `${at}: amount ${a.text} whole on one line (${a.lines} lines, clipped ${a.clipped})`);
      for (const f of m.filters) assert.ok(f.lines === 1 && f.h >= 52 - 0.5, `${at}: filter ${f.text} on one line, 52px`);
      console.log(at, "card amounts:", m.amounts.filter((a) => a.size && /^(5|4|3)\d/.test(a.size)).map((a) => `${a.size} ${a.text}`).join(" | "), "| summary", JSON.stringify(m.summary.map((s) => [s.key, Math.round(s.w), Math.round(s.h)])));
    }
  });
});
