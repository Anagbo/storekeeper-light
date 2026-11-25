import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, waitFor, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV, SEEDS } from "./helpers/lookChecks.js";

// Wide layout fixes (25 Nov 2026), real Edge: Home's two columns, the sidebar fold, the footer, the nav
// pill and the Suppliers colours. Values are polled (async content) and compared as sets.

const SKIP = browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)";

const WIDE_SEEDS = {
  ...SEEDS,
  today: `${SEEDS.base}
    await recordCashSale({ amountPesewas: 500, now: Date.now() - 60000 });
    await recordCreditSale({ name: "Juju", amountPesewas: 400, now: Date.now() - 30000 });`
};

const HOME = `(() => {
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, top: r.top }; };
  const nav = document.querySelector("[data-side-nav]");
  const toggle = document.querySelector("[data-side-toggle]");
  const owed = document.querySelector("[data-owed-card]");
  const tx = document.querySelector("[data-home-transactions]");
  const row = document.querySelector("[data-home-row-2]");
  const content = document.querySelector("[data-wide-content]");
  const small = (el) => (el ? parseFloat(getComputedStyle(el).fontSize) : null);
  const personRow = owed?.querySelector("[data-urgent-debtor]");
  const buttons = personRow ? [...personRow.querySelectorAll("button, a")].filter((b) => b.offsetParent && !b.hasAttribute("data-person-open")) : [];
  const status = document.querySelector("[data-side-nav] [role=status]");
  const dot = status?.querySelector("span[aria-hidden]");
  const homeIcon = document.querySelector("[data-side-row=Sell] svg");
  return {
    scrollWidth: document.documentElement.scrollWidth, innerWidth,
    mode: nav?.dataset.sideNav ?? null, navWidth: box(nav)?.width ?? null,
    contentWidth: box(content)?.width ?? null,
    columns: row?.dataset.columns ?? null, owed: box(owed), tx: box(tx),
    compact: Boolean(document.querySelector("[data-home-compact]")),
    owedOverflow: personRow ? personRow.scrollWidth > personRow.clientWidth + 1 : null,
    buttonLines: buttons.map((b) => Math.round(b.getBoundingClientRect().height)),
    toggle: toggle ? { label: toggle.getAttribute("aria-label"), width: box(toggle).width, height: toggle.getBoundingClientRect().height } : null,
    footerSize: [...document.querySelectorAll("[data-side-nav] [role=status] span")].filter((s) => s.textContent.trim()).map((s) => small(s)),
    dotCentre: dot ? box(dot).left + box(dot).width / 2 : null,
    iconCentre: homeIcon ? box(homeIcon).left + box(homeIcon).width / 2 : null
  };
})()`;

const settled = (app, width) => waitFor(async () => {
  const m = await app.evaluate(HOME);
  return m.tx && m.owed && m.innerWidth === width ? m : null;
}, "Home at " + width);

test("Home columns, the sidebar fold and the footer (1856, 1366, 1280, 1100, 390, 768)", { skip: SKIP, timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: WIDE_SEEDS, env: ENV }, async (app) => {
    // 1856 expanded.
    await app.evaluate(`localStorage.clear()`).catch(() => {});
    await app.open("today", 1856, 1000);
    let m = await settled(app, 1856);
    assert.equal(m.mode, "sidebar");
    assert.ok(m.contentWidth <= 1200 + 0.5, `content column ${m.contentWidth} <= 1200`);
    assert.equal(m.columns, "2");
    assert.ok(Math.abs(m.owed.top - m.tx.top) < 2, "Owed and transactions side by side");
    assert.ok(m.owed.width > m.tx.width * 1.8 && m.owed.width < m.tx.width * 2.2, `Owed about twice as wide (${m.owed.width} / ${m.tx.width})`);
    assert.ok(m.compact, "compact rows in the one third column");
    assert.equal(m.owedOverflow, false, "Owed row does not overflow");
    assert.ok(m.buttonLines.every((h) => h <= 64), `no wrapped buttons (${m.buttonLines})`);
    assert.ok(m.scrollWidth <= m.innerWidth, "no sideways scroll");
    assert.ok(m.toggle && m.toggle.width >= 48 && m.toggle.height >= 48, "toggle 48px or larger");
    assert.equal(m.toggle.label, "Collapse menu");
    assert.ok(m.footerSize.length > 0 && m.footerSize.every((size) => size >= 15), `footer text 15px or more (${m.footerSize})`);
    assert.ok(Math.abs(m.dotCentre - m.iconCentre) <= 1.5, `status dot lines up with the nav icons (${m.dotCentre} / ${m.iconCentre})`);

    // Fold, then it survives a reload.
    await app.click("^Collapse menu$");
    await waitFor(async () => (await app.evaluate(HOME)).navWidth === 84, "the 84px rail");
    m = await settled(app, 1856);
    assert.equal(m.toggle.label, "Expand menu");
    assert.equal(m.columns, "2");
    await app.open("today", 1366, 900);
    m = await settled(app, 1366);
    assert.equal(m.navWidth, 84, "choice survives a reload (1366 collapsed)");
    assert.equal(m.columns, "2", "1366 collapsed: two columns");
    await app.click("^Expand menu$");
    await waitFor(async () => (await app.evaluate(HOME)).navWidth === 300, "the 300px sidebar");
    m = await settled(app, 1366);
    // 1366 expanded: 1366 - 300 - 64 = 1002, so the 1000px rule gives two columns.
    assert.equal(m.columns, "2", "1366 expanded follows the 1000px rule");

    // 1280 expanded: one column.
    await app.open("today", 1280, 900);
    m = await settled(app, 1280);
    assert.equal(m.columns, "1", "1280 expanded: one column");
    assert.equal(m.compact, false, "one column keeps the table");
    assert.equal(m.owedOverflow, false);

    // No toggle below 1280 and on the phone; rail and phone Home unchanged.
    await app.open("today", 1100, 900);
    m = await settled(app, 1100);
    assert.equal(m.toggle, null, "no toggle at 1100");
    assert.equal(m.mode, "rail");
    assert.equal(m.columns, "1");
    await app.open("today", 768, 900);
    m = await settled(app, 768);
    assert.equal(m.toggle, null, "no toggle at 768");
    assert.equal(m.navWidth, 84);
    assert.equal(m.columns, "1");
    await app.open("today", 390, 800);
    await sleep(500);
    m = await app.evaluate(HOME);
    assert.equal(m.toggle, null, "no toggle at 390");
    assert.equal(m.mode, null);
  });
});

test("rail: grey bar under the status dot, and Suppliers colours (1856, 1366, 768)", { skip: SKIP, timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: WIDE_SEEDS, env: ENV }, async (app) => {
    const SUPPLIERS = `(() => {
      const page = document.querySelector("[data-page-area]");
      const card = document.querySelector("[data-supplier]");
      const cs = card ? getComputedStyle(card) : null;
      const summary = document.querySelector("[data-summary=suppliers]");
      const nav = document.querySelector("[data-side-nav]");
      const last = nav ? [...nav.querySelectorAll("*")].filter((el) => el.getBoundingClientRect().height > 0).pop() : null;
      return {
        bg: getComputedStyle(page).backgroundColor,
        card: cs ? { border: cs.borderTopWidth + " " + cs.borderTopColor, radius: cs.borderTopLeftRadius, bg: cs.backgroundColor } : null,
        summaryBg: summary ? getComputedStyle(summary).backgroundColor : null,
        summaryBorder: summary ? getComputedStyle(summary).borderTopWidth : null,
        navScroll: nav ? nav.scrollHeight - nav.clientHeight : null
      };
    })()`;
    for (const width of [1856, 1366, 768]) {
      await app.evaluate(`localStorage.clear()`).catch(() => {});
      await app.open("suppliers", width, 900);
      await app.click("^My money");
      await app.click("You owe suppliers");
      const s = await waitFor(async () => { const r = await app.evaluate(SUPPLIERS); return r.card ? r : null; }, "Suppliers at " + width);
      assert.equal(s.bg, "rgb(241, 245, 249)", `${width}: grey page`);
      assert.equal(s.card.bg, "rgb(255, 255, 255)", `${width}: white card`);
      // Tailwind 4 writes slate-300 (#CBD5E1) as oklch(0.869 0.022 252.894).
      assert.equal(s.card.border, "2px oklch(0.869 0.022 252.894)", `${width}: 2px #CBD5E1 border`);
      assert.equal(s.card.radius, "20px", `${width}: 20px radius`);
      assert.equal(s.summaryBg, "rgba(0, 0, 0, 0)", `${width}: total on the grey page, no card`);
      assert.equal(s.summaryBorder, "0px");
      assert.ok(s.navScroll <= 0, `${width}: the nav does not scroll, so no grey bar (${s.navScroll})`);
    }
  });
});
