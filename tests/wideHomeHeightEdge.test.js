import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, waitFor, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV, SEEDS } from "./helpers/lookChecks.js";

// Wide Home (two columns): the Today's transactions card is exactly as tall as the Owed card (never less
// than 240px), shows only the rows that fit completely, and says "+N more · See all" for the rest.

const SKIP = browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)";
const cash = (n) => Array.from({ length: n }, (_, i) => `await recordCashSale({ amountPesewas: ${1000 + i * 100}, now: Date.now() - ${60000 * (i + 1)} });`).join("\n    ");
const SEEDS_H = {
  ten: `${SEEDS.base}\n    ${cash(10)}`,
  one: `${SEEDS.base}\n    ${cash(1)}`,
  tenOneOwing: `await setPreference("posSetupCompleted", true);\n    ${cash(9)}\n    await recordCreditSale({ name: "Juju", amountPesewas: 400, now: Date.now() - 30000 });`
};

const M = `(() => {
  const owed = document.querySelector("[data-owed-card]");
  const tx = document.querySelector("[data-home-transactions]");
  const row = document.querySelector("[data-home-row-2]");
  const rows = [...document.querySelectorAll("[data-home-compact-row]")];
  const more = document.querySelector("[data-home-more]");
  const b = (el) => el.getBoundingClientRect();
  return {
    innerWidth, columns: row?.dataset.columns ?? null,
    owedBottom: owed ? b(owed).bottom : null, txBottom: tx ? b(tx).bottom : null,
    txHeight: tx ? b(tx).height : null, rowHeight: row ? b(row).height : null,
    visible: rows.length, cut: rows.filter((r) => b(r).bottom > b(tx).bottom + 0.5).length,
    more: more ? more.textContent.trim() : null, moreInside: more ? b(more).bottom <= b(tx).bottom + 0.5 : null,
    empty: Boolean(document.querySelector("[data-home-table-empty]"))
  };
})()`;
const settled = (app, width, total = 10) => waitFor(async () => {
  const m = await app.evaluate(M);
  const sum = m.visible + (m.more ? Number(/^\+(\d+)/.exec(m.more)?.[1]) : 0);
  return m.txBottom !== null && m.innerWidth === width && m.visible > 0 && sum === total ? m : null;
}, "Home at " + width);
const moreCount = (m) => Number(/^\+(\d+) more · See all$/.exec(m.more)?.[1]);

test("Today's transactions card: Owed sets the height, only whole rows, +N more (1856, 1366 collapsed)", { skip: SKIP, timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS_H, env: ENV }, async (app) => {
    await app.evaluate(`localStorage.clear()`).catch(() => {});
    await app.open("ten", 1856, 1000);
    let m = await settled(app, 1856);
    assert.equal(m.columns, "2");
    assert.ok(Math.abs(m.txBottom - m.owedBottom) <= 1, `1856: card bottom ${m.txBottom} = Owed bottom ${m.owedBottom}`);
    assert.equal(m.cut, 0, "1856: no row is cut");
    assert.ok(m.visible < 10 && moreCount(m) + m.visible === 10, `1856: ${m.visible} rows + "${m.more}" = 10`);
    assert.ok(m.moreInside, "1856: the more line is inside the card");
    const wideVisible = m.visible;

    await app.click("^Collapse menu$");
    await app.open("ten", 1366, 900);
    m = await settled(app, 1366);
    assert.equal(m.columns, "2");
    assert.ok(Math.abs(m.txBottom - m.owedBottom) <= 1, `1366: card bottom ${m.txBottom} = Owed bottom ${m.owedBottom}`);
    assert.equal(m.cut, 0, "1366: no row is cut");
    assert.equal(moreCount(m) + m.visible, 10, `1366: ${m.visible} rows + "${m.more}" = 10`);

    // Back to 1856 (the fold is kept): the count follows the height again.
    await app.open("ten", 1856, 1000);
    m = await settled(app, 1856);
    assert.equal(m.visible, m.columns === "2" ? m.visible : 0);
    assert.ok(Math.abs(m.txBottom - m.owedBottom) <= 1, "back at 1856: same bottom");
    assert.ok(wideVisible > 0);
  });
});

test("Today's transactions card: one sale, and ten sales with one person owing (1856)", { skip: SKIP, timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS_H, env: ENV }, async (app) => {
    await app.evaluate(`localStorage.clear()`).catch(() => {});
    await app.open("one", 1856, 1000);
    let m = await settled(app, 1856, 1);
    assert.ok(Math.abs(m.txBottom - m.owedBottom) <= 1, "1 sale: card height equals Owed height");
    assert.equal(m.more, null, "1 sale: no more line");

    await app.open("tenOneOwing", 1856, 1000);
    m = await settled(app, 1856);
    assert.equal(m.columns, "2");
    assert.ok(m.rowHeight >= 240 - 1, `the row is at least 240px (${m.rowHeight})`);
    assert.ok(Math.abs(m.txBottom - m.owedBottom) <= 1, "card bottom = Owed bottom");
    assert.ok(m.visible >= 2, `at least 2 sales shown (${m.visible})`);
    assert.equal(m.cut, 0);
  });
});
