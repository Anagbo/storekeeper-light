import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV } from "./helpers/lookChecks.js";

// Wiring 22/24 on the rail (22 Nov 2026), real Edge at 768x1024 and 1024x768, GH₵12,345.00 in every amount
// and a 40-character person name: the money columns hug their content, What keeps room, rows stay compact.

const LONG = "Nana Akosua Frimpomaa Asamoah-Boateng Jr"; // 40 characters
const SEEDS = {
  short: `await setPreference("posSetupCompleted", true); await setPreference("hideAmounts", false);
    await recordCreditSale({ name: ${JSON.stringify(LONG)}, phone: "0244123456", amountPesewas: 2000, initialPaymentPesewas: 800, dueDate: new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10) });
    await recordExpense({ amountPesewas: 1000, paidAmountPesewas: 1000, category: "transport", paymentMethod: "cash" });
    await recordExpense({ amountPesewas: 1500, paidAmountPesewas: 0, category: "stock", newSupplier: { name: "Kofi Wholesale Distributors" }, paidWith: "cash", payBy: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10) });`,
  rail: `await setPreference("posSetupCompleted", true); await setPreference("hideAmounts", false);
    await recordCreditSale({ name: ${JSON.stringify(LONG)}, phone: "0244123456", amountPesewas: 2469000, initialPaymentPesewas: 1234500, dueDate: new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10) });
    await recordExpense({ amountPesewas: 1234500, paidAmountPesewas: 1234500, category: "transport", paymentMethod: "cash" });
    await recordExpense({ amountPesewas: 1234500, paidAmountPesewas: 0, category: "stock", newSupplier: { name: "Kofi Wholesale Distributors" }, paidWith: "cash", payBy: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10) });`
};

const MEASURE = `(() => {
  document.getAnimations().forEach((a) => { try { a.finish(); } catch {} });
  const lines = (el) => { const tops = new Set(); const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { if (!n.textContent.trim()) continue; const r = document.createRange(); r.selectNodeContents(n); for (const b of r.getClientRects()) if (b.width > 0) tops.add(Math.round(b.top / 4)); } return tops.size; };
  const rows = [...document.querySelectorAll("tr[data-wide-row]")].map((tr) => {
    const what = tr.querySelector("td[data-cell=what]");
    const order = [...what.children].map((c) => c.getAttribute("data-cell") || "title");
    const cells = ["money-in", "spent", "owed"].map((n) => { const c = tr.querySelector("td[data-cell=" + n + "]"); const r = c.getBoundingClientRect(); return { n, w: r.width, lines: lines(c), fits: c.scrollWidth <= c.clientWidth + 0.5, text: c.textContent, align: getComputedStyle(c).textAlign, nowrap: getComputedStyle(c).whiteSpace }; });
    return { h: tr.getBoundingClientRect().height, what: what.getBoundingClientRect().width, order, cells, person: tr.querySelector("[data-cell=person]")?.textContent ?? null, time: tr.querySelector("td").getBoundingClientRect().width };
  });
  return { innerWidth, scrollWidth: document.documentElement.scrollWidth, rows, cols: document.querySelector("table").getAttribute("data-columns") };
})()`;

function check(m, at, short, home) {
  assert.ok(m.scrollWidth <= m.innerWidth, `${at}: no sideways scroll`);
  assert.equal(m.cols, "5", `${at}: rail has no Person column`);
  assert.ok(m.rows.length >= 3, `${at}: rows`);
  for (const r of m.rows) {
        if (short && home) assert.ok(r.h <= 115, `${at}: row ${r.h}px tall (${r.person}) ${r.order}`);
    if (short) assert.ok(r.what >= 160, `${at}: What ${r.what}px`);
    assert.ok(r.time <= 80, `${at}: Time ${r.time}px`);
    for (const c of r.cells) {
      assert.ok(c.lines <= 1 && c.fits && c.nowrap === "nowrap" && c.align === "right", `${at}: ${c.n} ${c.text} one line, whole, right (${c.lines})`);
      assert.ok(c.w >= 72, `${at}: ${c.n} min 72px (${c.w})`);
    }
    const p = r.order.indexOf("person"), l = r.order.indexOf("what-line2"), ch = r.order.indexOf("chips");
    if (p >= 0 && l >= 0) assert.ok(p < l, `${at}: person before the line (${r.order})`);
    if (l >= 0 && ch >= 0) assert.ok(l < ch, `${at}: line before chips`);
  }
  assert.ok(m.rows.some((r) => r.person === LONG), `${at}: the long person shows in full`);
}

test("22 and 24 on the rail: money columns hug their content, What keeps room, rows stay compact", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const [width, height] of [[768, 1024], [1024, 768]]) {
      for (const seed of ["rail", "short"]) {
        await app.open(seed, width, height);
        await app.shows("^Collect|^Sell");
        await sleep(500);
        check(await app.evaluate(MEASURE), `22 ${seed} ${width}px`, seed === "short", true);
        await app.click("^Today’s transactions");
        await sleep(700);
        check(await app.evaluate(MEASURE), `24 ${seed} ${width}px`, seed === "short", false);
      }
    }
  });
});
