import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, waitFor, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV } from "./helpers/lookChecks.js";

// Wiring 28 "Done on small phones" (4k, 21 Nov 2026), real Edge at 360x667 (and 340x667, 393x852): the
// check circle is 80px like 30 and Done (68px, main look) is pinned at the bottom like Save on 18, with
// the page background behind it and a 16px gap under it; the rest scrolls above it. Before 4k, Done was
// 34 to 330px below the fold at 360x667. Measured during the Undo window (the longest page: the
// "Share becomes available" line shows), with receipts on and off, a long name and no phone saved:
// Done is fully visible and nothing covers it, at the top and at the end of the scroll; at the end of
// the scroll every other control and line ends above Done's row, so nothing hides behind it. The
// "Undo is available for 10 seconds" line stays. No sideways scroll; the document never scrolls.
// The font is the machine's (Segoe UI on Windows), not a phone font.

const head = `await setPreference("posSetupCompleted", true);`;
const LONG = "Nana Akosua Frimpomaa Asamoah-Boateng";
const SEEDS = {
  longNoPhone: `${head} await recordCreditSale({ name: ${JSON.stringify(LONG)}, amountPesewas: 1234567, now: Date.now() - 86400000 });`,
  shortPhone: `${head} await recordCreditSale({ name: "Amoto", phone: "0244123456", amountPesewas: 2700, now: Date.now() - 86400000 });`
};

const MEASURE = `(() => {
  document.getAnimations().forEach((a) => { try { a.finish(); } catch {} });
  const area = document.querySelector("[data-page-area]");
  const main = area.querySelector("main");
  const done = [...main.querySelectorAll("button")].find((b) => b.textContent.trim() === "Done");
  const row = done?.closest("[data-bottom-row]") ?? done;
  const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width }; };
  const a = box(area);
  // Five points across Done: what the finger would hit there.
  const hits = done ? [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => { const r = done.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width * f, r.top + r.height / 2); return !!el && done.contains(el); }) : [];
  // Every other visible control and line on the page, as boxes.
  const others = [...main.querySelectorAll("button, a[href], p, h1, section")].filter((el) => !row.contains(el) && el.getClientRects().length).map((el) => ({ text: el.textContent.replace(/\\s+/g, " ").trim().slice(0, 40), ...box(el) }));
  const bg = (el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c; } return "rgb(255, 255, 255)"; };
  const circle = main.querySelector("[data-check-circle]");
  return {
    innerWidth, innerHeight,
    docScrollWidth: document.documentElement.scrollWidth, docScrollHeight: document.documentElement.scrollHeight,
    area: { ...a, scrollTop: area.scrollTop, scrollHeight: area.scrollHeight, clientHeight: area.clientHeight },
    row: row ? { ...box(row), position: getComputedStyle(row).position, background: getComputedStyle(row).backgroundColor } : null,
    pageBackground: bg(main.parentElement),
    done: done ? { ...box(done), text: done.textContent.trim(), look: done.getAttribute("data-look") } : null,
    hits, others,
    circle: circle ? box(circle) : null,
    undoLine: [...main.querySelectorAll("p")].some((p) => /^Undo is available for 10 seconds/.test(p.textContent.trim())),
    shareWait: [...main.querySelectorAll("p")].some((p) => /receipt buttons work after that/.test(p.textContent.trim()))
  };
})()`;

function checkDone(m, label) {
  assert.ok(m.row && m.done, `${label}: Done sits in the pinned bottom row`);
  assert.equal(m.done.text, "Done", `${label}: the button says Done`);
  assert.equal(m.row.position, "sticky", `${label}: the bottom row is pinned`);
  assert.ok(Math.abs(m.done.height - 68) < 1, `${label}: Done is 68px (${m.done.height})`);
  assert.ok(m.done.top >= m.area.top - 0.5 && m.done.bottom <= m.area.bottom + 0.5, `${label}: Done is fully on screen (${m.done.top}-${m.done.bottom} in ${m.area.top}-${m.area.bottom})`);
  assert.ok(m.area.bottom - m.done.bottom >= 15.5, `${label}: a gap of at least 16px under Done (${m.area.bottom - m.done.bottom})`);
  assert.ok(Math.abs(m.row.bottom - m.area.bottom) < 1, `${label}: the pinned row ends at the bottom of the screen`);
  assert.ok(m.hits.length === 5 && m.hits.every(Boolean), `${label}: nothing covers Done (${m.hits})`);
  assert.equal(m.row.background, m.pageBackground, `${label}: the page background is behind Done`);
  assert.ok(m.docScrollWidth <= m.innerWidth, `${label}: no sideways scroll`);
  assert.ok(m.docScrollHeight <= m.innerHeight, `${label}: the document never scrolls (the page area does)`);
}

async function open28(app, seed, width, height) {
  await app.open(seed, width, height);
  await app.shows("^Collect");
  await app.steps(["^Owed$", "^Collect from ", "^Received$"]);
  await waitFor(() => app.evaluate(`[...document.querySelectorAll("main button")].some((b) => b.textContent.trim() === "Done")`), "28");
  await sleep(300);
}

const CASES = [
  // [flags, seed, width, height, scrolls]
  ["on", "longNoPhone", 360, 667, true],
  ["off", "longNoPhone", 360, 667, true],
  ["on", "shortPhone", 360, 667, true],
  ["off", "shortPhone", 360, 667, true],
  ["on", "longNoPhone", 340, 667, true],
  ["on", "longNoPhone", 393, 852, true],
  ["off", "shortPhone", 393, 852, false]
];

for (const flags of ["on", "off"]) {
  test(`28: Done pinned, fully visible and never covered, nothing hidden behind it (receipts ${flags})`, { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 400_000 }, async () => {
    await withEdgeApp({ seeds: SEEDS, env: flags === "on" ? ENV : {} }, async (app) => {
      for (const [caseFlags, seed, width, height, scrolls] of CASES) {
        if (caseFlags !== flags) continue;
        const label = `28 receipts ${flags} ${seed} ${width}x${height}`;
        await open28(app, seed, width, height);
        const top = await app.evaluate(MEASURE);
        assert.ok(top.circle && Math.abs(top.circle.height - 80) < 1 && Math.abs(top.circle.width - 80) < 1, `${label}: the check circle is 80px`);
        assert.ok(top.undoLine, `${label}: "Undo is available for 10 seconds" stays`);
        if (flags === "on") assert.ok(top.shareWait, `${label}: measured during the Undo window`);
        assert.equal(top.area.scrollHeight > top.area.clientHeight + 1, scrolls, `${label}: the page ${scrolls ? "scrolls" : "fits"}`);
        checkDone(top, `${label} (top)`);
        // The end of the scroll: every other line and control ends above Done's row.
        await app.evaluate(`(() => { const a = document.querySelector("[data-page-area]"); a.scrollTop = a.scrollHeight; return true; })()`);
        await sleep(200);
        const end = await app.evaluate(MEASURE);
        checkDone(end, `${label} (end)`);
        for (const other of end.others) {
          assert.ok(other.bottom <= end.row.top + 0.5, `${label}: "${other.text}" ends above Done's row (${other.bottom} > ${end.row.top})`);
        }
        if (scrolls) assert.ok(end.area.scrollTop > 0, `${label}: the page area scrolled`);
      }
    });
  });
}
