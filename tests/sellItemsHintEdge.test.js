import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, waitFor, withEdgeApp } from "./helpers/edgeApp.js";

// Wiring D2/D15, wide_layout design_principles 4: on wide Sell the Items hint uses the same helper style as the
// keyboard hint (same computed size and colour); the Items label stays 17px bold.

const SEEDS = { sell: `await setPreference("posSetupCompleted", true);` };
const MEASURE = `(() => {
  const find = (re) => [...document.querySelectorAll("main p")].find((p) => re.test(p.textContent) && p.offsetParent);
  const look = (el) => { if (!el) return null; const cs = getComputedStyle(el); return { size: cs.fontSize, weight: cs.fontWeight, color: cs.color, height: el.getBoundingClientRect().height, top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom, text: el.textContent }; };
  return { label: look(find(/^Items$/)), hint: look(find(/None added/)), keyboard: look(find(/type the amount on your keyboard/)), last: look(find(/^Last sale/)) };
})()`;

test("wide Sell: the Items hint has the helper style of the keyboard hint, at 768, 1024 and 1280", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 300_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS }, async (app) => {
    for (const width of [768, 1024, 1280]) {
      await app.open("sell", width, 900);
      await app.click("^Sell");
      const m = await waitFor(async () => { const r = await app.evaluate(MEASURE); return r.hint && r.keyboard && r; }, "the Sell hints");
      if (process.env.SHOW_MEASURE) console.log(width, JSON.stringify(m));
      assert.equal(m.label.size, "17px", `${width}: label size`);
      assert.equal(m.label.weight, "700", `${width}: label weight`);
      assert.equal(m.hint.size, "15px", `${width}: Items hint size`);
      assert.equal(m.keyboard.size, "15px", `${width}: keyboard hint size`);
      assert.equal(m.hint.weight, "400", `${width}: Items hint weight`);
      assert.ok(m.hint.height <= 2 * 15 * 1.6, `${width}: Items hint at most two lines (${m.hint.height}px)`);
      assert.ok(m.hint.top >= m.label.bottom, `${width}: hint sits under the label row`);
      assert.equal(m.hint.color, "rgb(71, 85, 105)", `${width}: helper colour`);
      assert.equal(m.hint.color, m.keyboard.color, `${width}: same hint colour`);
    }
  });
});
