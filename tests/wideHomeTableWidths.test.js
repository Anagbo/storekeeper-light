import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, waitFor, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV } from "./helpers/lookChecks.js";

// Wide Home's small Today’s transactions table (22 D1) in real Edge at 768x1024, 1280x800 and 1440x900:
// GH₵12,345.00 in every amount, a 40-character name and supplier, a correction and stock on credit.
// No sideways scroll, no clipped or wrapped amount, the table inside its card, five columns, 8px cells.
const LONG = "Abena Konadu Asantewaa Mensah-Bonsu Ofor";
const SEEDS = {
  home: `await setPreference("posSetupCompleted", true);
    await setPreference("hideAmounts", false);
    await recordCashSale({ amountPesewas: 1234500 });
    await recordCreditSale({ name: ${JSON.stringify(LONG)}, amountPesewas: 2469000, initialPaymentPesewas: 1234500 });
    await recordExpense({ amountPesewas: 1234500, paidAmountPesewas: 1234500, category: "transport", paymentMethod: "cash" });
    await recordExpense({ amountPesewas: 1234500, paidAmountPesewas: 0, category: "stock", newSupplier: { name: ${JSON.stringify(LONG)} } });
    await db.transactions.add({ id: "adj-1", type: "debt_adjustment", amountPesewas: 0, total_amount: 0, payment_method: null, previousBalancePesewas: 1234500, newBalancePesewas: 0, deltaPesewas: -1234500, reasonCode: "wrong_amount", reasonNote: "", customer_name: ${JSON.stringify(LONG)}, createdAt: Date.now() });`
};

const MEASURE = `(() => {
  document.getAnimations().forEach((a) => { try { a.finish(); } catch {} });
  const lines = (el) => { const tops = new Set(); const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { if (!n.textContent.trim()) continue; const r = document.createRange(); r.selectNodeContents(n); for (const b of r.getClientRects()) if (b.width > 0) tops.add(Math.round(b.top / 4)); } return tops.size; };
  const card = document.querySelector("[data-home-transactions]");
  const table = card && card.querySelector("table");
  const cr = card.getBoundingClientRect(); const tr = table.getBoundingClientRect();
  return {
    innerWidth, scrollWidth: document.documentElement.scrollWidth,
    cardR: cr.right, cardL: cr.left, tableR: tr.right, tableL: tr.left, tableScroll: table.scrollWidth, tableW: tr.width,
    heads: [...table.querySelectorAll("th[scope=col]")].map((h) => h.textContent),
    pads: [...table.querySelectorAll("td, th")].map((c) => getComputedStyle(c).paddingLeft + "/" + getComputedStyle(c).paddingTop),
    totals: table.querySelectorAll("tfoot").length,
    rows: [...table.querySelectorAll("[data-home-row]")].map((r) => ({ kind: r.dataset.rowKind, h: Math.round(r.getBoundingClientRect().height), what: r.querySelector("[data-cell=what]").textContent, cells: ["money-in", "spent", "owed"].map((n) => r.querySelector("[data-cell=" + n + "]").textContent) })),
    amounts: [...table.querySelectorAll("[data-cell=money-in], [data-cell=spent], [data-cell=owed]")].map((el) => ({ text: el.textContent, lines: lines(el), clipped: el.scrollWidth > el.clientWidth + 0.5, r: el.getBoundingClientRect().right, l: el.getBoundingClientRect().left })),
    chips: table.querySelectorAll("[data-chip]").length
  };
})()`;

test("wide Home table: five columns inside its card, amounts whole, correction and stock-on-credit lines", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const [width, height] of [[768, 1024], [1280, 800], [1440, 900]]) {
      const at = `${width}x${height}`;
      await app.open("home", width, height);
      await waitFor(() => app.evaluate(`document.querySelectorAll("[data-home-row]").length >= 4`), `${at}: the table rows`);
      await sleep(300);
      const m = await app.evaluate(MEASURE);
      console.log(at, JSON.stringify(m.rows.map((r) => [r.kind, r.h, r.what.slice(0, 40), r.cells.join("|")])));
      assert.ok(m.scrollWidth <= m.innerWidth, `${at}: no sideways scroll`);
      assert.deepEqual(m.heads, ["Time", "What", "Money in", "Spent", "On credit"], `${at}: columns`);
      assert.ok(m.tableScroll <= m.tableW + 0.5 && m.tableR <= m.cardR + 0.5 && m.tableL >= m.cardL - 0.5, `${at}: table inside its card (scroll ${m.tableScroll}, table ${m.tableW})`);
      assert.ok(m.pads.every((p) => p === "8px/8px"), `${at}: cell padding 8px (${[...new Set(m.pads)]})`);
      assert.equal(m.totals, 0, `${at}: no Total today row on Home`);
      assert.equal(m.chips, 0, `${at}: no chips on Home`);
      for (const a of m.amounts) assert.ok(a.lines === 1 && !a.clipped && a.l >= 0 && a.r <= m.innerWidth, `${at}: amount ${a.text} whole on one line`);
      const fix = m.rows.find((r) => r.kind === "adjustment");
      const stock = m.rows.find((r) => r.kind === "credit");
      assert.ok(fix && /Lowered by GH₵12,345\.00/.test(fix.what) && fix.cells.every((c) => c === "—"), `${at}: correction line and dashes`);
      assert.ok(stock && /You owe .* GH₵12,345\.00/.test(stock.what) && stock.cells.every((c) => c === "—"), `${at}: stock on credit line and dashes`);
    }
  });
});
