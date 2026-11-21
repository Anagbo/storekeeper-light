import assert from "node:assert/strict";
import { test } from "node:test";
import { browser, sleep, waitFor, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV } from "./helpers/lookChecks.js";

// Wiring 36, "Starter list opened from My items 39" (decided 20 Nov 2026), in real Edge at 340, 360 and
// 393px: no sideways scroll; every chip inside the screen, at least 44px high, its label on one line
// (the row wraps, no chip is hidden), also with More categories open; a long "Added" row keeps its tag
// inside the row; "Add N items" on one line. Then setup end to end: 35 -> 36 keeps its setup wording,
// and the categories chosen there are the chips when 36 is opened again from 39.
// The font is the machine's (Segoe UI on Windows), not a phone font.

const SEEDS = {
  // The three longest category names as setup categories, and the longest starter item already in My items.
  items: `await setPreference("posSetupCompleted", true);
    await setPreference("starterCategories", ["pharmacy", "toiletries", "repairs"]);
    await createProduct({ name: "Air conditioner service", price: "50" });`,
  fresh: ""
};

const WIDTHS = [340, 360, 393];

const MEASURE = `(() => {
  document.getAnimations().forEach((a) => { try { a.finish(); } catch {} });
  const lines = (el) => {
    const tops = new Set();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top / 4));
    }
    return tops.size;
  };
  const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height, text: el.textContent.replace(/\\s+/g, " ").trim(), lines: lines(el) }; };
  const main = document.querySelector("main");
  const added = [...main.querySelectorAll("[data-added]")].map((row) => ({ row: box(row), name: box(row.children[0]), tag: box(row.children[1]) }));
  const add = [...main.querySelectorAll("button")].find((b) => /^Add \\d+ items?$/.test(b.textContent.trim()));
  return {
    innerWidth, scrollWidth: document.documentElement.scrollWidth,
    title: main.querySelector("h1")?.textContent.trim(),
    text: main.textContent.replace(/\\s+/g, " "),
    chips: [...main.querySelectorAll("[role=group] button")].map(box),
    added,
    add: add && { ...box(add), disabled: add.disabled }
  };
})()`;

function checkChips(m, label) {
  assert.ok(m.scrollWidth <= m.innerWidth, `${label}: no sideways scroll (${m.scrollWidth} > ${m.innerWidth})`);
  for (const chip of m.chips) {
    const what = `${label}: chip "${chip.text}"`;
    assert.ok(chip.left >= -0.5 && chip.right <= m.innerWidth + 0.5, `${what} is inside the screen (${chip.left}-${chip.right})`);
    assert.ok(chip.height >= 43.5, `${what} is at least 44px high (${chip.height})`);
    assert.equal(chip.lines, 1, `${what} is one line`);
  }
}

test("36 from 39 fits at 340, 360 and 393px: chips wrap, Added rows and Add N items stay inside", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const width of WIDTHS) {
      const label = `36 from 39 ${width}px`;
      await app.open("items", width, 800);
      await app.steps(["^Menu", "^Items", "Add from starter list"]);
      await app.shows(" Add 0 items$");
      await sleep(300);
      let m = await app.evaluate(MEASURE);
      assert.equal(m.title, "Add from starter list", label);
      assert.match(m.text, /Tick what you want to add\./, label);
      assert.doesNotMatch(m.text, /Untick|Skip/, label);
      assert.deepEqual(m.chips.map(({ text }) => text), ["All", "Chemical shop (over the counter)", "Beauty products and toiletries", "Repairs and fixing", "More categories"], label);
      checkChips(m, label);
      assert.equal(m.add.disabled, true, `${label}: Add 0 items is disabled`);

      await app.steps(["^Repairs and fixing$"]);
      await waitFor(() => app.evaluate(`!!document.querySelector("main [data-added]")`), "the Added row");
      await app.steps(["^Phone repair$"]);
      await sleep(300);
      m = await app.evaluate(MEASURE);
      checkChips(m, `${label} Repairs`);
      assert.equal(m.added.length, 1, `${label}: one Added row`);
      const [{ row, name, tag }] = m.added;
      assert.equal(name.text, "Air conditioner service");
      assert.equal(tag.text, "Added");
      assert.ok(tag.left >= name.right - 0.5 && tag.right <= row.right + 0.5 && row.right <= width + 0.5, `${label}: the Added tag sits inside the row, right of the name`);
      assert.equal(tag.lines, 1, `${label}: Added is one line`);
      assert.match(m.add.text, /^Add 1 item$/, `${label}: one tick counted`);
      assert.equal(m.add.lines, 1, `${label}: Add 1 item is one line`);
      assert.ok(m.add.left >= -0.5 && m.add.right <= width + 0.5, `${label}: Add 1 item is inside the screen`);

      await app.steps(["^More categories$"]);
      await sleep(300);
      m = await app.evaluate(MEASURE);
      assert.equal(m.chips.length, 5 + 32 - 3, `${label}: every other category is a chip under More categories`);
      checkChips(m, `${label} More categories`);
    }
  });
});

test("setup 35 -> 36 keeps its wording, and its categories are the chips when 36 is opened from 39", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 600_000 }, async () => {
  await withEdgeApp({ seeds: SEEDS, env: ENV }, async (app) => {
    for (const width of WIDTHS) {
      const label = `setup ${width}px`;
      await app.open("fresh", width, 800);
      await app.steps(["^With items", "^Continue", "^Provisions shop", "^Hair and beauty", "^Continue"]);
      await app.shows(" Continue · 25 items$");
      let m = await app.evaluate(MEASURE);
      assert.equal(m.title, "Your starter list", label);
      assert.match(m.text, /Untick what you don’t sell\./, label);
      assert.doesNotMatch(m.text, /Tick what you want to add|Added|More categories/, label);
      assert.equal(m.chips.length, 0, `${label}: no chips in setup`);
      assert.ok(m.scrollWidth <= m.innerWidth, `${label}: no sideways scroll`);
      await app.steps(["^Skip, I’ll add items later$"]);
      await app.steps(["^Menu", "^Items", "Add from starter list"]);
      await app.shows(" Add 0 items$");
      await sleep(300);
      m = await app.evaluate(MEASURE);
      assert.deepEqual(m.chips.map(({ text }) => text), ["All", "Provisions shop", "Hair and beauty", "More categories"], `${label}: the setup categories are the chips`);
      checkChips(m, `${label} from 39`);
    }
  });
});
