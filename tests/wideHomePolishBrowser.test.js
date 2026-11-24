import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, withEdgeApp } from "./helpers/edgeApp.js";

// Wide Home polish (24 Nov 2026) in real Edge at 768 (rail) and 1280 (sidebar): the hero card lines up
// with the Sell and Spent money column, chips are #F1F5F9, the amount is centred on the Collect button,
// and the Collect first label matches the Today's transactions title.
const SEEDS = {
  base: `
await setPreference("posSetupCompleted", true);
await setPreference("hideAmounts", false);
await recordCreditSale({ name: "Ama", amountPesewas: 1234500, now: Date.now() - 3 * 86400000 });
`
};

const MEASURE = `(() => {
  const q = (s) => document.querySelector(s);
  const box = (e) => { const r = e.getBoundingClientRect(); return { t: r.top, b: r.bottom, l: r.left, r: r.right, c: (r.top + r.bottom) / 2 }; };
  const hero = q("[data-block=money-left]"), col = q("[data-home-actions]");
  const chips = [...hero.querySelectorAll(":scope > div:last-child > div")];
  const amount = [...hero.querySelectorAll("p")].find((p) => /^GH₵/.test(p.textContent.trim()) && parseFloat(getComputedStyle(p).fontSize) > 50);
  const cs = getComputedStyle(hero);
  const owedAmount = q("[data-party-amount]");
  const collect = [...document.querySelectorAll("[data-owed-card] button")].find((b) => /^Collect/.test(b.getAttribute("aria-label") || ""));
  const label = [...document.querySelectorAll("[data-owed-card] p")].find((p) => /collect first/i.test(p.textContent));
  const title = q("[data-home-transactions] span");
  const f = (e) => { const s = getComputedStyle(e); return { size: parseFloat(s.fontSize), weight: s.fontWeight }; };
  return {
    hero: box(hero), col: box(col), border: cs.borderTopWidth + " " + cs.borderTopColor, radius: cs.borderTopLeftRadius, fill: cs.backgroundColor,
    chips: chips.map((c) => getComputedStyle(c).backgroundColor), gap: box(chips[0]).t - box(amount).b,
    owed: box(owedAmount).c, collect: box(collect).c, label: f(label), title: f(title), scroll: document.documentElement.scrollWidth <= innerWidth
  };
})()`;

test("wide Home polish in Edge (768, 1280)", { skip: browser ? false : "no Chrome or Edge found", timeout: 300_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS }, async (app) => {
    for (const [width, height] of [[768, 1024], [1280, 800]]) {
      await app.open("base", width, height);
      const m = await (await import("./helpers/edgeApp.js")).waitFor(() => app.evaluate(MEASURE).catch(() => null), `${width}: Home`);
      const at = String(width);
      // The rail stacks the hero above Sell and Spent money (D6), so there is no column beside it to match.
      if (width >= 1280) assert.ok(Math.abs(m.hero.t - m.col.t) <= 1 && Math.abs(m.hero.b - m.col.b) <= 1, `${at}: hero top/bottom equal the Sell and Spent column (${JSON.stringify([m.hero, m.col])})`);
      assert.equal(m.fill, "rgb(255, 255, 255)", `${at}: white hero`);
      assert.equal(m.border, "2px rgb(203, 213, 225)", `${at}: 2px #CBD5E1 border`);
      assert.equal(m.radius, "20px", `${at}: 20px radius`);
      assert.deepEqual(m.chips, ["rgb(241, 245, 249)", "rgb(241, 245, 249)"], `${at}: chips #F1F5F9`);
      assert.ok(m.gap >= 12, `${at}: gap amount to chips ${m.gap}`);
      assert.ok(Math.abs(m.owed - m.collect) <= 2, `${at}: owed amount centred on Collect (${m.owed} vs ${m.collect})`);
      assert.deepEqual(m.label, m.title, `${at}: Collect first and the card title match`);
      assert.ok(m.label.size >= 15, `${at}: 15px or more`);
      assert.ok(m.scroll, `${at}: no sideways scroll`);
    }
  });
});
