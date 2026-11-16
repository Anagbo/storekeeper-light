import assert from "node:assert/strict";
import { test } from "node:test";
import { appCss, browser, measureInFrames, toHtml } from "./helpers/browserLayout.js";
import { loadJsx, render, setLiveQuery } from "./helpers/renderJsx.js";

// Wiring 20 (16 Nov 2026) in a real browser at 340, 360 and 393px: with no items "+ New item" spans
// the whole grid width (72px tall, dashed border); with items it is one tile wide and the last tile.
// No horizontal overflow either way.

const WIDTHS = [340, 360, 393];
const BREAD = { id: 1, name: "Bread", default_price: 2 };
const RICE = { id: 2, name: "Rice", default_price: 5 };
const SUGAR = { id: 3, name: "Sugar", default_price: 5 };

async function page(name, products) {
  const { default: SellWithItems } = await loadJsx("src/pos/SellWithItems.jsx");
  setLiveQuery(() => ({ products, error: "" }));
  try {
    return { name, html: toHtml(render({ type: SellWithItems, props: { params: { saleItems: [] }, onBack() {}, onNavigate() {}, onUpdateParams() {} } }).tree) };
  } finally {
    setLiveQuery(null);
  }
}

test("20 + New item: full width with no items, last one-column tile with items, no overflow (340/360/393px)", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)" }, async () => {
  const pages = [await page("none", []), await page("one", [BREAD]), await page("two", [BREAD, RICE]), await page("three", [BREAD, RICE, SUGAR])];
  const results = measureInFrames({
    pages,
    css: await appCss(),
    widths: WIDTHS,
    height: 1200,
    measure: `(frame, win, doc) => {
      const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
      const button = [...doc.querySelectorAll('button')].find((el) => /New item/.test(el.textContent));
      const grid = button.parentElement;
      const style = getComputedStyle(button);
      return {
        pageOverflow: doc.scrollingElement.scrollWidth > win.innerWidth,
        grid: { ...box(grid), paddingLeft: parseFloat(getComputedStyle(grid).paddingLeft), paddingRight: parseFloat(getComputedStyle(grid).paddingRight) },
        button: { ...box(button), borderStyle: style.borderTopStyle, borderWidth: parseFloat(style.borderTopWidth), lines: Math.round((button.scrollHeight - 2 * parseFloat(style.borderTopWidth)) / parseFloat(style.lineHeight)) },
        tiles: [...doc.querySelectorAll('[data-item-tile]')].map(box)
      };
    }`
  });
  for (const result of results) {
    const at = `${result.page} at ${result.width}px`;
    const { button, grid, tiles } = result;
    assert.equal(result.pageOverflow, false, `${at}: no horizontal scroll`);
    assert.ok(button.right <= result.width && button.left >= 0, `${at}: + New item inside the screen`);
    assert.ok(button.height >= 71.5, `${at}: at least 72px tall (is ${button.height})`);
    assert.equal(button.borderStyle, "dashed", `${at}: dashed border kept`);
    assert.equal(button.borderWidth, 3, `${at}: 3px border`);
    if (!tiles.length) {
      assert.ok(Math.abs(button.height - 72) <= 0.5, `${at}: 72px tall on its own (is ${button.height})`);
      assert.ok(Math.abs(button.width - (grid.width - grid.paddingLeft - grid.paddingRight)) <= 0.5, `${at}: spans the full grid width (${button.width} of ${grid.width})`);
      continue;
    }
    assert.ok(Math.abs(button.width - tiles[0].width) <= 0.5, `${at}: one tile wide`);
    const last = tiles.at(-1);
    const beside = tiles.find((tile) => Math.abs(tile.top - button.top) <= 0.5);
    if (beside) assert.ok(Math.abs(button.height - beside.height) <= 0.5, `${at}: same height as the tile beside it`);
    assert.ok(button.top > last.top || (Math.abs(button.top - last.top) <= 0.5 && button.left > last.left), `${at}: after the last item tile`);
  }
});
