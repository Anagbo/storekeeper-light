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
    brokenWords: (() => { const out = []; for (const el of document.querySelectorAll("[data-cell=person]")) { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { const re = /\S+/g; let m; while ((m = re.exec(n.textContent))) { const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length); const tops = new Set([...r.getClientRects()].filter((b) => b.width > 0).map((b) => Math.round(b.top / 4))); if (tops.size > 1) out.push(m[0]); } } } return out; })(), personLines: [...document.querySelectorAll("td[data-cell=person]")].map((c) => Math.round(c.querySelector("span") ? c.querySelector("span").getBoundingClientRect().height / parseFloat(getComputedStyle(c).lineHeight) : 0)), heads: [...table.querySelectorAll("th[scope=col]")].map((h) => h.textContent),
    pads: [...table.querySelectorAll("td, th")].map((c) => getComputedStyle(c).paddingLeft + "/" + getComputedStyle(c).paddingTop),
    totals: table.querySelectorAll("tfoot").length,
    rows: [...table.querySelectorAll("[data-home-row]")].map((r) => ({ kind: r.dataset.rowKind, h: Math.round(r.getBoundingClientRect().height), what: r.querySelector("[data-cell=what]").textContent, cells: ["money-in", "spent", "owed"].map((n) => r.querySelector("[data-cell=" + n + "]").textContent) })),
    amounts: [...table.querySelectorAll("[data-cell=money-in], [data-cell=spent], [data-cell=owed]")].map((el) => ({ text: el.textContent, lines: lines(el), clipped: el.scrollWidth > el.clientWidth + 0.5, r: el.getBoundingClientRect().right, l: el.getBoundingClientRect().left })),
    chips: table.querySelectorAll("[data-chip]").length
  };
})()`;

test("wide Home table: five columns inside its card, amounts whole, correction and stock-on-credit lines", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    // The table shows wherever the lower row is one column (768 rail, 1280 with the sidebar expanded);
    // 1440 has two columns and compact rows instead (checked below).
    for (const [width, height] of [[768, 1024], [1280, 800]]) {
      const at = `${width}x${height}`;
      await app.open("home", width, height);
      await waitFor(() => app.evaluate(`document.querySelectorAll("[data-home-row]").length >= 4`), `${at}: the table rows`);
      await sleep(300);
      const m = await app.evaluate(MEASURE);
      console.log(at, JSON.stringify(m.rows.map((r) => [r.kind, r.h, r.what.slice(0, 40), r.cells.join("|")])));
      assert.ok(m.scrollWidth <= m.innerWidth, `${at}: no sideways scroll`);
      assert.deepEqual(m.heads, width >= 1280 ? ["Time", "What", "Person", "Money in", "Spent", "On credit"] : ["Time", "What", "Money in", "Spent", "On credit"], `${at}: columns`);
      assert.deepEqual(m.brokenWords, [], `${at}: no word broken inside a name`);
      if (width >= 1280) assert.ok(m.rows.every((r) => r.h <= 115), `${at}: rows about 100px or less (115 allowed) (${m.rows.map((r) => r.h)})`);
      assert.ok(m.tableScroll <= m.tableW + 0.5 && m.tableR <= m.cardR + 0.5 && m.tableL >= m.cardL - 0.5, `${at}: table inside its card (scroll ${m.tableScroll}, table ${m.tableW})`);
      assert.ok(m.pads.every((p) => p === "8px/8px"), `${at}: cell padding 8px (${[...new Set(m.pads)]})`);
      assert.equal(m.totals, 0, `${at}: no Total today row on Home`);
      assert.equal(m.chips, 0, `${at}: no chips on Home`);
      for (const a of m.amounts) assert.ok(a.lines === 1 && !a.clipped && a.l >= 0 && a.r <= m.innerWidth, `${at}: amount ${a.text} whole on one line`);
      const fix = m.rows.find((r) => r.kind === "adjustment");
      const stock = m.rows.find((r) => r.kind === "credit");
      if (width >= 1280) assert.ok(m.rows.find((r) => r.kind === "credit").what.length > 0);
      assert.ok(fix && /Lowered by GH₵12,345\.00/.test(fix.what) && fix.cells.every((c) => c === "—"), `${at}: correction line and dashes`);
      assert.ok(stock && /You owe .* GH₵12,345\.00/.test(stock.what) && stock.cells.every((c) => c === "—"), `${at}: stock on credit line and dashes`);
    }
  });
});

// 1440x900 (content 960px or more, wiring WIDE HOME): two columns, Today’s transactions in the one-third
// column as compact rows, no table. The rows stay inside the card, amounts whole on one line, and the rows
// shown plus "+N more" account for all five transactions.
const COMPACT = `(() => {
  document.getAnimations().forEach((a) => { try { a.finish(); } catch {} });
  const card = document.querySelector("[data-home-transactions]");
  const cr = card.getBoundingClientRect();
  const more = card.querySelector("[data-home-more]");
  return {
    innerWidth, scrollWidth: document.documentElement.scrollWidth,
    columns: document.querySelector("[data-home-row-2]")?.dataset.columns,
    tables: card.querySelectorAll("table").length,
    rows: [...card.querySelectorAll("[data-home-compact-row]")].map((r) => { const b = r.getBoundingClientRect(); return { kind: r.dataset.rowKind, l: b.left, r: b.right, bottom: b.bottom }; }),
    cardL: cr.left, cardR: cr.right, cardBottom: cr.bottom,
    amounts: [...card.querySelectorAll("[data-home-compact-row] [data-cell=money-in], [data-home-compact-row] [data-cell=spent], [data-home-compact-row] [data-cell=owed]")].map((el) => ({ text: el.textContent, clipped: el.scrollWidth > el.clientWidth + 0.5, h: el.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(el).lineHeight) })),
    more: more ? Number((more.textContent.match(/\\d+/) || [0])[0]) : 0
  };
})()`;

test("wide Home at 1440x900: two columns, Today’s transactions as compact rows inside the card, no table", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    const at = "1440x900";
    await app.open("home", 1440, 900);
    await waitFor(() => app.evaluate(`document.querySelector("[data-home-row-2]")?.dataset.columns === "2" && document.querySelectorAll("[data-home-compact-row]").length >= 1`), `${at}: the compact rows`);
    await sleep(300);
    const m = await app.evaluate(COMPACT);
    assert.ok(m.scrollWidth <= m.innerWidth, `${at}: no sideways scroll`);
    assert.equal(m.columns, "2", `${at}: two columns`);
    assert.equal(m.tables, 0, `${at}: no table in the one-third column`);
    assert.ok(m.rows.length >= 1, `${at}: compact rows`);
    assert.equal(m.rows.length + m.more, 5, `${at}: rows shown (${m.rows.length}) plus +N more (${m.more}) are all five`);
    for (const r of m.rows) assert.ok(r.l >= m.cardL - 0.5 && r.r <= m.cardR + 0.5 && r.bottom <= m.cardBottom + 0.5, `${at}: ${r.kind} row inside the card`);
    for (const a of m.amounts) assert.ok(!a.clipped && a.h < a.lh * 1.5, `${at}: amount ${a.text} whole on one line`);
  });
});
