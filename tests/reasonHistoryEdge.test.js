import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV, SEEDS } from "./helpers/lookChecks.js";

// Polish 7, item 3 (25 Nov 2026), real Edge at 340 and 390px: the What for chips can save a reason like
// "Rice, Water, Bag of okro". It must not overflow sideways or get cut off on Saved as credit, in the
// person's history (29/43) and in the record view (73) opened from a history row.

const REASON = "Rice, Water, Bag of okro";

const OVERFLOW = `(() => {
  const clipped = [...document.querySelectorAll("main *")].filter((el) => el.offsetParent && el.children.length === 0 && el.textContent.trim() && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).display !== "inline").map((el) => el.textContent.trim().slice(0, 40));
  const outside = [...document.querySelectorAll("main *")].filter((el) => el.offsetParent && el.getBoundingClientRect().right > innerWidth + 0.5).map((el) => el.textContent.trim().slice(0, 40));
  return { scroll: document.documentElement.scrollWidth <= innerWidth, clipped, outside, mentions: (document.querySelector("main").textContent.match(/Bag of okro/g) ?? []).length };
})()`;

test("a three-item reason (Rice, Water, Bag of okro) never overflows on Saved, the person's history or the record view (73) (340, 390px)", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const width of [340, 390]) {
      await app.open("base", width, 800);
      await app.steps(["^Owed$", "Add debt$", "^[AK]?Amoto", "^Next", "^1$", "^0$", `type:${REASON}`, "^Next", "^Save · "]);
      await app.shows("See Amoto’s details");
      await sleep(300);
      let m = await app.evaluate(OVERFLOW);
      console.log(`reason ${width} saved:`, JSON.stringify(m));
      assert.ok(m.scroll && m.outside.length === 0 && m.clipped.length === 0, `${width} Saved: no overflow or cut-off`);
      assert.ok(m.mentions >= 1, `${width} Saved: the reason is shown`);
      await app.steps(["^See Amoto’s details"]);
      await sleep(600);
      m = await app.evaluate(OVERFLOW);
      console.log(`reason ${width} history:`, JSON.stringify(m));
      assert.ok(m.scroll && m.outside.length === 0 && m.clipped.length === 0, `${width} history: no overflow or cut-off`);
      assert.ok(m.mentions >= 1, `${width} history: the reason is shown`);
      // 73: the look-only record shown to the customer, opened from the history screen.
      await app.steps(["^Show Amoto the record"]);
      await sleep(600);
      m = await app.evaluate(OVERFLOW);
      console.log(`reason ${width} record view (73):`, JSON.stringify(m));
      assert.ok(m.scroll && m.outside.length === 0 && m.clipped.length === 0, `${width} record view (73): no overflow or cut-off`);
      assert.ok(m.mentions >= 1, `${width} record view (73): the reason is shown`);
    }
  });
});
