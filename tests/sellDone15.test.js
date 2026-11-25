import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, withEdgeApp } from "./helpers/edgeApp.js";

// Wiring 15 "Done on 15" (17 Nov 2026, second decision), real Edge: Done is NOT pinned. It is the 60px
// solid green button at the end of the content; the keypad keys are 52px (62px elsewhere) and the page
// keeps room below Done so that, scrolled to the end, Done ends fully above the top of the fixed bottom
// bar (the raised Sell circle included). On the three tall screens Done is fully visible without
// scrolling; on the three short ones the screen scrolls. Nothing floats over the content: Done never
// overlaps a payment tile, at the top or at the end of the scroll. "+ Add items" is the compact add look.
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
  const keys = [...document.querySelectorAll("[data-amount-keypad] button")];
  // The payment tiles: every button in the row that holds the Cash tile (Cash, MoMo, Owe, Split).
  const cash = buttons.find((b) => b.hasAttribute("aria-pressed") && b.textContent.trim() === "Cash");
  const tiles = cash ? [...cash.parentElement.querySelectorAll(":scope > button")] : [];
  const rect = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }; };
  const cs = getComputedStyle(add);
  const lines = (() => { const tops = new Set(); const w = document.createTreeWalker(add, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { if (!n.textContent.trim()) continue; const r = document.createRange(); r.selectNodeContents(n); for (const b of r.getClientRects()) tops.add(Math.round(b.top / 4)); } return tops.size; })();
  // The fixed bottom bar: its highest point (the raised Sell circle), whatever the scroll.
  const bar = [...document.querySelectorAll("nav")].find((n) => getComputedStyle(n).position === "fixed" && n.getClientRects().length);
  const barTop = bar ? Math.min(...[bar, ...bar.querySelectorAll("*")].map((el) => el.getBoundingClientRect().top)) : innerHeight;
  // Anything fixed or sticky inside the page (a floating element); the bar and the header are outside main.
  const floating = [...document.querySelectorAll("main, main *")].filter((el) => ["fixed", "sticky"].includes(getComputedStyle(el).position)).map((el) => el.tagName);
  return {
    innerWidth, innerHeight,
    docScrollWidth: document.documentElement.scrollWidth,
    docScrollHeight: document.documentElement.scrollHeight,
    header: rect(document.querySelector("header")),
    area: { clientHeight: area.clientHeight, scrollHeight: area.scrollHeight },
    key: keys[4].getBoundingClientRect().height,
    keyGap: keys[3].getBoundingClientRect().top - keys[0].getBoundingClientRect().bottom,
    done: rect(done),
    doneBackground: getComputedStyle(done).backgroundColor,
    barTop, floating,
    add: { ...rect(add), text: add.textContent.trim(), overflow: add.scrollWidth > add.clientWidth, lines,
      border: cs.borderTopStyle + " " + cs.borderTopWidth + " " + cs.borderTopColor, radius: cs.borderTopLeftRadius, background: cs.backgroundColor, color: cs.color, weight: cs.fontWeight, underline: cs.textDecorationLine },
    tileCount: tiles.length,
    tilesBottom: tiles.length ? Math.max(...tiles.map((t) => t.getBoundingClientRect().bottom)) : null
  };
})()`;

// [width, height, scrolls]: the three tall screens show Done without scrolling, the short ones scroll.
const SIZES = [[340, 640, true], [340, 667, true], [360, 667, true], [360, 740, false], [393, 800, false], [393, 852, false]];

test("15: Done is not pinned; at the end of the scroll it ends above the bottom bar with the four tiles above it; fully visible unscrolled on the tall screens (six sizes)", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 400_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS }, async (app) => {
    const report = [];
    for (const [width, height, scrolls] of SIZES) {
      const label = `${width}x${height}`;
      await app.open("base", width, height);
      await app.click("^Sell$");
      await app.shows("Add items");
      await sleep(300);
      const top = await app.evaluate(MEASURE);
      assert.equal(top.innerWidth, width, `${label}: viewport`);
      assert.ok(top.docScrollWidth <= width, `${label}: no sideways scroll (${top.docScrollWidth})`);
      assert.ok(top.docScrollHeight <= height + 0.5, `${label}: the document never scrolls, only the page area (${top.docScrollHeight})`);
      assert.deepEqual(top.floating, [], `${label}: nothing sticky or fixed floats over the content`);
      // Keys: 52px on 15 with the usual 8px gap; Done: 60px, solid green.
      assert.ok(Math.abs(top.key - 52) < 0.5, `${label}: the keys are 52px (${top.key})`);
      assert.ok(Math.abs(top.keyGap - 8) < 0.5, `${label}: the key spacing is unchanged, 8px (${top.keyGap})`);
      assert.ok(Math.abs(top.done.height - 60) < 0.5, `${label}: Done is 60px (${top.done.height})`);
      assert.match(top.doneBackground, GREEN, `${label}: Done is solid green`);
      assert.ok(top.done.left >= 0 && top.done.right <= width, `${label}: Done fits across`);
      assert.equal(top.tileCount, 4, `${label}: the four payment tiles (Cash, MoMo, Owe, Split)`);
      // The page area scrolls exactly where the rule says: the tall screens do not.
      assert.equal(top.area.scrollHeight > top.area.clientHeight + 0.5, scrolls, `${label}: ${scrolls ? "scrolls" : "does not scroll"} (content ${top.area.scrollHeight} in ${top.area.clientHeight})`);
      // Nothing overlaps at the top of the scroll: Done is below every tile.
      assert.ok(top.done.top >= top.tilesBottom - 0.5, `${label}: at the top Done does not overlap the tiles (Done from ${top.done.top}, tiles end ${top.tilesBottom})`);
      if (!scrolls) assert.ok(top.done.bottom <= top.barTop + 0.5, `${label}: Done is fully visible above the bar without scrolling (Done ends ${top.done.bottom}, bar from ${top.barTop})`);
      // + Add items: compact add look, one line, inside the screen.
      assert.equal(top.add.text, "+ Add items", `${label}: the label keeps the + and the words`);
      assert.ok(Math.abs(top.add.height - 44) < 0.5, `${label}: + Add items is 44px (${top.add.height})`);
      assert.match(top.add.border, /^dashed 2px /, `${label}: dashed 2px border`);
      assert.match(top.add.border.replace(/^dashed 2px /, ""), GREEN, `${label}: dark-green border`);
      assert.equal(top.add.radius, "14px", `${label}: 14px corners`);
      assert.equal(top.add.background, "rgba(0, 0, 0, 0)", `${label}: no fill`);
      assert.match(top.add.color, GREEN, `${label}: dark-green text`);
      assert.ok(Number(top.add.weight) >= 700, `${label}: bold text`);
      assert.equal(top.add.underline, "none", `${label}: not underlined`);
      assert.equal(top.add.lines, 1, `${label}: + Add items on one line`);
      assert.ok(!top.add.overflow && top.add.left >= 0 && top.add.right <= width, `${label}: + Add items fits across`);

      // At the end of the scroll: Done ends above the top of the raised Sell button, the four tiles above Done.
      await app.evaluate(`(() => { const a = document.querySelector("[data-page-area]"); a.scrollTop = a.scrollHeight; })()`);
      await sleep(200);
      const end = await app.evaluate(MEASURE);
      assert.ok(end.done.bottom <= end.barTop + 0.5, `${label}: at the end of the scroll Done ends above the bar (Done ends ${end.done.bottom}, bar from ${end.barTop})`);
      assert.ok(end.done.top >= end.header.bottom - 0.5, `${label}: at the end Done is below the header`);
      assert.ok(end.tilesBottom <= end.done.top + 0.5, `${label}: at the end the four tiles are above Done (tiles end ${end.tilesBottom}, Done from ${end.done.top})`);
      assert.deepEqual(end.floating, [], `${label}: at the end nothing floats over the content`);
      report.push(`${label}: Done over the bar top by ${Math.round(top.done.bottom - top.barTop)} at the top, ${Math.round(end.done.bottom - end.barTop)} at the end`);
    }
    console.log(report.join("\n"));
  });
});
