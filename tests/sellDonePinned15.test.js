import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, withEdgeApp } from "./helpers/edgeApp.js";

// Wiring 15 "Done on 15" (17 Nov 2026), real Edge: Done is pinned at the bottom of the screen (60px,
// solid green) and the content above it scrolls under it, so Done is fully visible at 340x667, 340x640
// and 360x667 (and 393x852). "+ Add items" is the add look at the compact 44px: dashed 2px dark-green
// border, 14px corners, no fill, bold dark-green text on one line. At the end of the scroll nothing is
// left under Done. The document never scrolls sideways or down (only the page area scrolls).
// The font is the machine's (Segoe UI on Windows), not a phone font.

// Tailwind 4 gives emerald-900 (the app's dark green) as oklch.
const GREEN = /^(oklch\(0\.378 0\.077 168\.94\)|rgb\(6, 78, 59\))$/;

const SEEDS = { base: `await setPreference("posSetupCompleted", true);` };

const MEASURE = `(() => {
  document.getAnimations().forEach((a) => { try { a.finish(); } catch {} });
  const area = document.querySelector("[data-page-area]");
  const buttons = [...document.querySelectorAll("main button")];
  const done = buttons.find((b) => /^Done$/.test(b.textContent.trim()));
  const add = buttons.find((b) => b.getAttribute("data-look") === "add");
  const tiles = [...document.querySelectorAll("main button[aria-pressed], main button[aria-label='Cash + MoMo + Owe']")];
  const rect = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }; };
  const cs = getComputedStyle(add);
  const lines = (() => { const tops = new Set(); const w = document.createTreeWalker(add, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { if (!n.textContent.trim()) continue; const r = document.createRange(); r.selectNodeContents(n); for (const b of r.getClientRects()) tops.add(Math.round(b.top / 4)); } return tops.size; })();
  return {
    innerWidth, innerHeight,
    docScrollWidth: document.documentElement.scrollWidth,
    docScrollHeight: document.documentElement.scrollHeight,
    header: rect(document.querySelector("header")),
    area: { top: area.getBoundingClientRect().top, clientHeight: area.clientHeight, scrollHeight: area.scrollHeight, scrollTop: area.scrollTop },
    done: rect(done),
    doneBackground: getComputedStyle(done).backgroundColor,
    add: { ...rect(add), text: add.textContent.trim(), name: add.textContent.replace("+", "").trim(), overflow: add.scrollWidth > add.clientWidth, lines,
      border: cs.borderTopStyle + " " + cs.borderTopWidth + " " + cs.borderTopColor, radius: cs.borderTopLeftRadius, background: cs.backgroundColor, color: cs.color, weight: cs.fontWeight, underline: cs.textDecorationLine },
    lastTile: tiles.length ? rect(tiles.at(-1)) : null
  };
})()`;

test("15: Done pinned and fully visible at 340x667, 340x640, 360x667 and 393x852; + Add items is the compact add look", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 300_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS }, async (app) => {
    for (const [width, height] of [[340, 667], [340, 640], [360, 667], [393, 852]]) {
      const label = `${width}x${height}`;
      await app.open("base", width, height);
      await app.click("^Sell$");
      await app.shows("Add items");
      await sleep(300);
      const top = await app.evaluate(MEASURE);
      assert.equal(top.innerWidth, width, `${label}: viewport`);
      assert.ok(top.docScrollWidth <= width, `${label}: no sideways scroll (${top.docScrollWidth})`);
      assert.ok(top.docScrollHeight <= height + 0.5, `${label}: the document never scrolls (${top.docScrollHeight})`);
      // Done: fully on the screen, below the header, 60px, solid green.
      assert.ok(top.done.top >= top.header.bottom - 0.5 && top.done.bottom <= height + 0.5, `${label}: Done is fully visible (${top.done.top}-${top.done.bottom} of ${height})`);
      assert.ok(Math.abs(top.done.height - 60) < 0.5, `${label}: Done is 60px (${top.done.height})`);
      assert.ok(top.done.left >= 0 && top.done.right <= width, `${label}: Done fits across`);
      assert.match(top.doneBackground, GREEN, `${label}: Done is solid green`);
      // + Add items: compact add look, one line, inside the screen.
      assert.equal(top.add.text, "+ Add items", `${label}: the label keeps the + and the words`);
      assert.ok(Math.abs(top.add.height - 44) < 0.5, `${label}: + Add items is 44px (${top.add.height})`);
      assert.match(top.add.border.replace(/^dashed 2px /, ""), GREEN, `${label}: dark-green border`);
      assert.match(top.add.border, /^dashed 2px /, `${label}: dashed 2px dark-green border`);
      assert.equal(top.add.radius, "14px", `${label}: 14px corners`);
      assert.equal(top.add.background, "rgba(0, 0, 0, 0)", `${label}: no fill`);
      assert.match(top.add.color, GREEN, `${label}: dark-green text`);
      assert.ok(Number(top.add.weight) >= 700, `${label}: bold text`);
      assert.equal(top.add.underline, "none", `${label}: not underlined`);
      assert.equal(top.add.lines, 1, `${label}: + Add items on one line`);
      assert.ok(!top.add.overflow, `${label}: + Add items does not overflow`);
      assert.ok(top.add.left >= 0 && top.add.right <= width, `${label}: + Add items fits across`);
      // At the end of the scroll the last payment tile is above Done, so nothing stays hidden under it.
      await app.evaluate(`(() => { const a = document.querySelector("[data-page-area]"); a.scrollTop = a.scrollHeight; })()`);
      await sleep(200);
      const end = await app.evaluate(MEASURE);
      assert.ok(end.done.bottom <= height + 0.5, `${label}: Done stays visible at the end of the scroll`);
      assert.ok(end.lastTile && end.lastTile.bottom <= end.done.top + 0.5, `${label}: the payment tiles end above Done (${end.lastTile?.bottom} vs ${end.done.top})`);
      assert.ok(end.add.top >= end.header.bottom - 0.5 || top.add.bottom <= top.done.top + 0.5, `${label}: + Add items can be reached`);
      console.log(`${label}: page area ${top.area.clientHeight}px, content ${top.area.scrollHeight}px; Done ${top.done.top}-${top.done.bottom}; + Add items ${top.add.top}-${top.add.bottom}`);
    }
  });
});
