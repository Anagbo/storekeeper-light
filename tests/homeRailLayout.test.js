import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV } from "./helpers/lookChecks.js";

// Wiring 22 D6 (22 Nov 2026), real Edge on the rail (768 and 1024): Sell and Spent money share the row
// (half each, 16px gutter, equal height, no gap); the table shows the person as a grey 17px line under the
// title, on Home and on 24; no amount is clipped.

const head = `await setPreference("posSetupCompleted", true); await setPreference("hideAmounts", false);`;
const SEEDS = {
  rail: `${head}
    await recordCreditSale({ name: "Ama Mensah", phone: "0244123456", amountPesewas: 1234567, dueDate: new Date(Date.now() - 9 * 86400000).toISOString().slice(0, 10), now: Date.now() - 86400000 * 3 });
    await recordCashSale({ amountPesewas: 987654 });
    await recordExpense({ amountPesewas: 45000, paidAmountPesewas: 0, category: "stock", newSupplier: { name: "Kofi Wholesale" }, paidWith: "cash", payBy: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10) });`
};

const MEASURE = `(() => {
  document.getAnimations().forEach((a) => { try { a.finish(); } catch {} });
  const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, h: r.height, w: r.width }; };
  const sell = document.querySelector("[data-home-sell]"), spent = [...document.querySelectorAll("[data-home-spent]")].find((e) => e.tagName === "BUTTON");
  const people = [...document.querySelectorAll("[data-cell=person]")].filter((e) => e.tagName === "SPAN" || e.closest("td")?.getAttribute("data-cell") === "what" );
  const lines = [...document.querySelectorAll("td[data-cell=what] [data-cell=person]")].map((e) => ({ text: e.textContent, size: getComputedStyle(e).fontSize, color: getComputedStyle(e).color, visible: e.getBoundingClientRect().height > 0 }));
  const cells = [...document.querySelectorAll("td[data-cell=money-in], td[data-cell=spent], td[data-cell=owed]")].map((c) => c.scrollWidth <= c.clientWidth + 0.5);
  return { innerWidth, scrollWidth: document.documentElement.scrollWidth, sell: sell && box(sell), spent: spent && box(spent), actions: document.querySelector("[data-home-actions]") && box(document.querySelector("[data-home-actions]")), lines, cellsFit: cells.every(Boolean), th: [...document.querySelectorAll("th")].map((t) => t.textContent) };
})()`;

test("22 and 24 on the rail: Sell and Spent money fill the row; the person is a grey 17px line under the title", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const [width, height] of [[768, 1024], [1024, 768]]) {
      const at = `${width}px`;
      await app.open("rail", width, height);
      await app.shows("^Collect");
      await sleep(400);
      const m = await app.evaluate(MEASURE);
      assert.ok(m.scrollWidth <= m.innerWidth, `${at}: no sideways scroll`);
      assert.ok(Math.abs(m.sell.l - m.actions.l) < 1 && Math.abs(m.spent.r - m.actions.r) < 1, `${at}: the pair fills the row`);
      assert.ok(Math.abs(m.spent.l - m.sell.r - 16) < 1, `${at}: 16px gutter (${m.spent.l - m.sell.r})`);
      assert.ok(Math.abs(m.sell.w - m.spent.w) < 1 && Math.abs(m.sell.h - m.spent.h) < 1, `${at}: equal size`);
      assert.ok(!m.th.includes("Person"), `${at}: no Person column on the rail`);
      const names = m.lines.map((l) => l.text);
      assert.ok(names.includes("Kofi Wholesale"), `${at}: supplier line on Home (${names})`);
      for (const line of m.lines) assert.ok(line.visible && line.size === "17px" && line.color !== "rgb(15, 23, 42)", `${at}: ${line.text} grey 17px`);
      assert.ok(m.cellsFit, `${at}: no clipped amount on Home`);

      await app.click("^Today’s transactions");
      await sleep(600);
      const p = await app.evaluate(MEASURE);
      assert.ok(p.scrollWidth <= p.innerWidth, `${at}: 24 no sideways scroll`);
      assert.ok(p.lines.some((l) => l.text === "Kofi Wholesale"), `${at}: 24 shows the supplier`);
      assert.ok(p.cellsFit, `${at}: no clipped amount on 24`);
    }
  });
});
