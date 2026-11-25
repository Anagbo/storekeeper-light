import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, waitFor, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV } from "./helpers/lookChecks.js";

// Wide Home (22) in real Edge at 768x1024, 1024x768, 1280x800 and 1440x900: a 40-character late name with
// GH₵12,345.00 and a valid number. No sideways scroll, no clipped or wrapped amount, no wrapped button
// label, no button wider than 240px, Collect-first people on one line.
const LONG = "Abena Konadu Asantewaa Mensah-Bonsu Ofor";
const sale = (name, amount, days) => `await recordCreditSale({ name: ${JSON.stringify(name)}, phone: "0244123456", amountPesewas: ${amount}, dueDate: new Date(Date.now() + ${days} * 86400000).toISOString().slice(0, 10), now: Date.now() - 86400000 * 40 });`;
const SEEDS = { home: `await setPreference("posSetupCompleted", true); ${sale(LONG, 1234500, -9)} ${sale("Yaw", 1200, 5)}` };

const MEASURE = `(() => {
  document.getAnimations().forEach((a) => { try { a.finish(); } catch {} });
  const box = (el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, l: r.left, r: r.right, t: r.top, b: r.bottom }; };
  const lines = (el) => { const tops = new Set(); const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { if (!n.textContent.trim()) continue; const r = document.createRange(); r.selectNodeContents(n); for (const b of r.getClientRects()) if (b.width > 0) tops.add(Math.round(b.top / 4)); } return tops.size; };
  const amounts = [...document.querySelectorAll("main [data-party-amount], main [data-owed-total], main [data-block] p")].filter((el) => el.getClientRects().length && /GH₵/.test(el.textContent)).map((el) => ({ text: el.textContent, lines: lines(el), clipped: el.scrollWidth > el.clientWidth + 0.5, size: parseFloat(getComputedStyle(el).fontSize), weight: getComputedStyle(el).fontWeight, ...box(el) }));
  const controls = [...document.querySelectorAll("main button, main a[href]")].filter((el) => el.getClientRects().length && !el.hasAttribute("data-person-open") && !el.closest("[data-owed-card] > button") && !el.closest("[data-home-transactions]"))
    .map((el) => ({ label: el.getAttribute("aria-label") || el.textContent.replace(/\s+/g, " ").trim(), lines: lines(el), overflow: el.scrollWidth > el.clientWidth + 0.5, ...box(el) }));
  const people = [...document.querySelectorAll("[data-urgent-debtor]")].map(box);
  const small = [...document.querySelectorAll("main *")].filter((el) => el.children.length === 0 && el.textContent.trim() && el.getClientRects().length && !el.closest("table") && parseFloat(getComputedStyle(el).fontSize) < 15).map((el) => el.textContent.trim().slice(0, 20));
  const ed = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect().right : null; }; return { rights: { sell: ed("[data-home-sell]"), spent: ed("[data-home-spent]"), actions: ed("[data-home-actions]"), owed: ed("[data-owed-card]"), tx: ed("[data-home-transactions]") }, txL: document.querySelector("[data-home-transactions]")?.getBoundingClientRect().left ?? null, stackB: box(document.querySelector("[data-home-actions]")).b, innerWidth, scrollWidth: document.documentElement.scrollWidth, amounts, controls, people, small, card: box(document.querySelector("[data-block=money-left]")), actions: box(document.querySelector("[data-home-actions]")) };
})()`;

test("wide Home: fits at 768 to 1440, amounts whole, labels on one line, buttons at most 240px, Collect-first one line", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const [width, height] of [[768, 1024], [1024, 768], [1280, 800], [1440, 900]]) {
      const at = `${width}x${height}`;
      await app.open("home", width, height);
      await waitFor(() => app.evaluate(`document.querySelectorAll("[data-urgent-debtor]").length === 2`), `${at}: the Collect-first rows`);
      await sleep(300);
      const m = await app.evaluate(MEASURE);
      console.log(at, JSON.stringify({ card: m.card.h, actions: m.actions.h, person: m.people.map((p) => p.h), widths: m.controls.map((c) => `${c.label.slice(0, 14)}:${Math.round(c.w)}x${Math.round(c.h)}`).join(" "), small: m.small }));
      console.log(at, JSON.stringify(m.rights), m.card.b, m.stackB);
      assert.ok(m.scrollWidth <= m.innerWidth, `${at}: no sideways scroll`);
      // Two-column lower row (Owed 2/3, Today’s 1/3, wiring 22 wide Home): Today’s carries the right edge and Owed sits to its left.
      const twoCol = m.txL !== null && m.rights.owed < m.txL;
      const edge = twoCol ? m.rights.tx : m.rights.owed;
      assert.ok(Math.abs(m.actions.r - edge) <= 1 && Math.abs(m.rights.spent - edge) <= 1 && Math.abs(m.rights.tx - edge) <= 1, `${at}: right edges aligned (${JSON.stringify(m.rights)})`);
      if (width >= 1440) assert.ok(twoCol, `${at}: Owed and Today’s transactions side by side`);
      assert.ok(m.actions.l < m.card.r || Math.abs(m.card.b - m.stackB) <= 1, `${at}: top-row bottoms aligned`);
      assert.ok(m.actions.l < m.card.r || (Math.abs(m.actions.l - m.card.r - 16) <= 1 && Math.abs(m.actions.r - m.actions.l - 240) <= 1), `${at}: 16px gap, 240px Sell column (${m.actions.l - m.card.r}, ${m.actions.r - m.actions.l})`);
      assert.ok(m.amounts.some((a) => a.text === "GH₵12,345.00"), `${at}: the long amount is shown`);
      for (const a of m.amounts) assert.ok(a.lines === 1 && !a.clipped && a.l >= 0 && a.r <= m.innerWidth && a.weight === "700", `${at}: amount ${a.text} whole, one line, bold (${a.lines}, ${a.clipped}, ${a.weight})`);
      for (const c of m.controls) {
        assert.ok(!c.overflow && c.r <= m.innerWidth + 0.5, `${at}: "${c.label}" not clipped`);
        assert.ok(c.lines <= 1, `${at}: "${c.label}" label on one line (${c.lines})`);
        const railPair = m.innerWidth < 1280 && /^(Sell|Spent money)$/.test(c.label); // rail: Sell and Spent money share the row (22 Nov 2026)
        assert.ok(railPair || c.w <= 240.5, `${at}: "${c.label}" at most 240px wide (${c.w})`);
      }
      for (const p of m.people) assert.ok(p.h <= 100, `${at}: a Collect-first person is one compact line (${p.h}px)`);
      assert.deepEqual(m.small, [], `${at}: no text under 15px`);
    }
  });
});
