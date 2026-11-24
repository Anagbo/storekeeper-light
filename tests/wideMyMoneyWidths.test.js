import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, waitFor, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV } from "./helpers/lookChecks.js";

// Wide My money (33, D7) in real Edge at 1024x768, 1280x800 and 1440x900 (below 1024 the phone layout stays,
// so 768x1024 only has to fit): GH₵12,345.00 in the sales, the credit, the expense and the owed lines.
// No sideways scroll, no clipped or wrapped amount; card titles 17px/800, card totals 24px/700, the hero 700.
const SEEDS = { money: `await setPreference("posSetupCompleted", true);
  await recordCashSale({ amountPesewas: 1234500 });
  await recordCashSale({ amountPesewas: 1234500, cashReceivedPesewas: 0, momoReceivedPesewas: 1234500 });
  await recordCreditSale({ name: "Abena Konadu Asantewaa Mensah-Bonsu Ofor", phone: "0244123456", amountPesewas: 1234500, dueDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10), now: Date.now() });
  await recordExpense({ amountPesewas: 1234500, paidAmountPesewas: 1234500, category: "transport", note: "" });
  await recordExpense({ amountPesewas: 1234500, paidAmountPesewas: 0, category: "stock", newSupplier: { name: "Kofi" }, paidWith: "cash", payBy: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10) });` };

const MEASURE = `(() => {
  document.getAnimations().forEach((a) => { try { a.finish(); } catch {} });
  const lines = (el) => { const tops = new Set(); const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { if (!n.textContent.trim()) continue; const r = document.createRange(); r.selectNodeContents(n); for (const b of r.getClientRects()) if (b.width > 0) tops.add(Math.round(b.top / 4)); } return tops.size; };
  const amounts = [...document.querySelectorAll("main p, main span, main strong")].filter((el) => el.getClientRects().length && /^[−-]?GH₵[0-9,]+[.][0-9]{2}$/.test(el.textContent.trim())).map((el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { text: el.textContent, lines: lines(el), clipped: el.scrollWidth > el.clientWidth + 0.5, r: r.right, l: r.left, size: parseFloat(cs.fontSize), weight: cs.fontWeight }; });
  const cards = ["money-in", "money-spent", "should-have-left"].map((id) => { const c = document.querySelector("[data-card=" + id + "]"); if (!c) return null; if (innerWidth < 1024) return null; const [title, total] = c.firstElementChild.children; const tr = title.getBoundingClientRect(), ar = total.getBoundingClientRect(); return { id, titleSize: parseFloat(getComputedStyle(title).fontSize), titleWeight: getComputedStyle(title).fontWeight, titleLines: lines(title), totalSize: parseFloat(getComputedStyle(total).fontSize), totalWeight: getComputedStyle(total).fontWeight, below: ar.top >= tr.bottom - 1, leftAligned: Math.abs(ar.left - tr.left) < 1, text: total.textContent }; });
  const hero = [...document.querySelectorAll("[data-block=money-left] p")].find((p) => /^GH₵/.test(p.textContent.trim()));
  const see = [...document.querySelectorAll("main button")].filter((el) => /^See (who|list)$/.test(el.textContent.trim())).map((el) => { const cs = getComputedStyle(el); return { size: parseFloat(cs.fontSize), weight: cs.fontWeight, deco: cs.textDecorationLine }; });
  return { innerWidth, scrollWidth: document.documentElement.scrollWidth, amounts, cards, heroWeight: hero && getComputedStyle(hero).fontWeight, see };
})()`;

test("wide My money: fits at 768 to 1440, amounts whole, same card headers, sizes and weights", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const [width, height] of [[768, 1024], [1024, 768], [1280, 800], [1440, 900]]) {
      const at = `${width}x${height}`;
      await app.open("money", width, height);
      await app.steps(["^My money$"]);
      await waitFor(() => app.evaluate(`!!document.querySelector("[data-card=money-in]")`), `${at}: My money`);
      await sleep(300);
      const m = await app.evaluate(MEASURE);
      assert.ok(m.scrollWidth <= m.innerWidth, `${at}: no sideways scroll`);
      assert.ok(m.amounts.length >= 8 && m.amounts.some((a) => a.text === "GH₵12,345.00"), `${at}: amounts shown (${m.amounts.length})`);
      for (const a of m.amounts) assert.ok(a.lines === 1 && !a.clipped && a.l >= 0 && a.r <= m.innerWidth, `${at}: amount ${a.text} whole on one line (${a.lines}, ${a.clipped})`);
      if (width < 1024) continue;
      assert.equal(m.heroWeight, "700", `${at}: hero 700`);
      for (const c of m.cards) {
        assert.ok(c, `${at}: three cards`);
        assert.deepEqual([c.titleSize, c.titleWeight, c.titleLines, c.totalSize, c.totalWeight, c.below, c.leftAligned], [17, "800", 1, 24, "700", true, true], `${at}: ${c.id} header (${c.text})`);
      }
      for (const s of m.see) assert.deepEqual([s.size, s.weight, s.deco], [17, "800", "none"], `${at}: See who / See list`);
      assert.equal(m.see.length, 2, `${at}: both links`);
    }
  });
});
