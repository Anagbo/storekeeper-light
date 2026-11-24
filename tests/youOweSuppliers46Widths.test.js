import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, waitFor, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV } from "./helpers/lookChecks.js";

// 46 You owe suppliers (D14), real Edge at 390, 768 and 1280: the total is never amber (grey tile on the
// phone, no card on wide, 40px), the Late supplier is first, one column at 390 and 768 and two at 1280,
// Pay is the same width on every card (a supplier without a number keeps the Call slot), no sideways scroll.

const due = (days) => `new Date(Date.now() + ${days} * 86400000).toISOString().slice(0, 10)`;
const buy = (name, phone, days) => `await recordExpense({ amountPesewas: 50000, paidAmountPesewas: 0, category: "stock", newSupplier: { name: ${JSON.stringify(name)}, phone: ${JSON.stringify(phone)} }, paidWith: "cash", payBy: ${due(days)}, now: Date.now() - 86400000 * 20 });`;
const SEEDS = {
  suppliers: `await setPreference("posSetupCompleted", true); ${buy("Later Trader", "0241234567", 10)} ${buy("No Phone Stores", "", 2)} ${buy("Late Wholesale", "0241234568", -3)}`
};

const MEASURE = `(() => {
  const cards = [...document.querySelectorAll("[data-supplier]")];
  const summary = document.querySelector('[data-summary="suppliers"]');
  const total = document.querySelector("[data-supplier-total]");
  const pays = cards.map((card) => card.querySelector('button[aria-label^="Pay "]')?.getBoundingClientRect().width);
  return {
    scroll: document.documentElement.scrollWidth <= innerWidth,
    names: cards.map((card) => card.getAttribute("data-supplier")),
    lefts: [...new Set(cards.map((card) => Math.round(card.getBoundingClientRect().left)))].length,
    pays,
    summaryBg: summary ? getComputedStyle(summary).backgroundColor : null,
    totalSize: total ? parseFloat(getComputedStyle(total).fontSize) : null,
    totalColour: total ? getComputedStyle(total).color : null
  };
})()`;

test("46 in Edge (390, 768, 1280): neutral total, Late first, columns, equal Pay widths", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const [width, height] of [[390, 800], [768, 1024], [1280, 800]]) {
      await app.open("suppliers", width, height);
      if (width < 768) await app.steps(["^Open menu$", "^My money"]);
      else await waitFor(() => app.evaluate(`(() => { const b = document.querySelector('[data-side-row="MyMoney"]'); if (!b) return false; b.click(); return true; })()`), "sidebar My money");
      await waitFor(() => app.evaluate(`(() => { const card = [...document.querySelectorAll("main button")].find((b) => /You owe suppliers/.test(b.textContent + " " + (b.getAttribute("aria-label") || ""))); if (!card) return false; card.click(); return true; })()`), "You owe suppliers");
      const m = await waitFor(async () => { const r = await app.evaluate(MEASURE); return r.names.length === 3 && r; }, `${width}: three cards`);
      assert.ok(m.scroll, `${width}: no sideways scroll`);
      assert.equal(m.names[0], "Late Wholesale", `${width}: Late first`);
      assert.deepEqual(m.names, ["Late Wholesale", "No Phone Stores", "Later Trader"], `${width}: order`);
      assert.equal(m.totalColour, "rgb(15, 23, 42)", `${width}: total is #0F172A`);
      if (width < 768) assert.equal(m.summaryBg, "rgb(241, 245, 249)", `${width}: soft grey tile`);
      else {
        assert.equal(m.summaryBg, "rgba(0, 0, 0, 0)", `${width}: no card on wide`);
        assert.equal(m.totalSize, 40, `${width}: total 40px`);
      }
      assert.equal(m.lefts, width >= 1280 ? 2 : 1, `${width}: ${width >= 1280 ? "two columns" : "one column"}`);
      assert.ok(m.pays.every((w) => Math.abs(w - m.pays[0]) < 1), `${width}: Pay is the same width on every card (${m.pays})`);
    }
  });
});
