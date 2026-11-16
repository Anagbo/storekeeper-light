import assert from "node:assert/strict";
import { test } from "node:test";
import { appCss, browser, measureInFrames, toHtml } from "./helpers/browserLayout.js";
import { loadJsx, render, setLiveQuery, walk } from "./helpers/renderJsx.js";

// Wiring 20 (16 Nov 2026) in a real browser at 340, 360 and 393px: "+ New item" never sits alone in a
// half-width row. One rule on the number of item tiles: even (zero included, or a search that matches
// nothing) spans the whole grid width; odd stays beside the last tile, one tile wide. Always 72px tall,
// 3px dashed border, no horizontal overflow.

const WIDTHS = [340, 360, 393];
const BREAD = { id: 1, name: "Bread", default_price: 2 };
const RICE = { id: 2, name: "Rice", default_price: 5 };
const SUGAR = { id: 3, name: "Sugar", default_price: 5 };
const OIL = { id: 4, name: "Oil", default_price: 30 };

async function page(name, products, query = "") {
  const { default: SellWithItems } = await loadJsx("src/pos/SellWithItems.jsx");
  setLiveQuery(() => ({ products, error: "" }));
  try {
    const view = render({ type: SellWithItems, props: { params: { saleItems: [] }, onBack() {}, onNavigate() {}, onUpdateParams() {} } });
    if (query) {
      [...walk(view.tree)].find((node) => node.props && node.type === "input").props.onChange({ target: { value: query } });
      view.rerender();
    }
    return { name, html: toHtml(view.tree) };
  } finally {
    setLiveQuery(null);
  }
}

test("20 + New item: full width with an even tile count (0, 2, 4, search with no match), beside the last tile with an odd count (1, 3), no overflow (340/360/393px)", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)" }, async () => {
  const pages = [
    await page("0 tiles", []),
    await page("1 tile", [BREAD]),
    await page("2 tiles", [BREAD, RICE]),
    await page("3 tiles", [BREAD, RICE, SUGAR]),
    await page("4 tiles", [BREAD, RICE, SUGAR, OIL]),
    await page("search with no match", [BREAD, RICE, SUGAR], "zzz")
  ];
  const expected = { "0 tiles": 0, "1 tile": 1, "2 tiles": 2, "3 tiles": 3, "4 tiles": 4, "search with no match": 0 };
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
        button: { ...box(button), borderStyle: style.borderTopStyle, borderWidth: parseFloat(style.borderTopWidth) },
        tiles: [...doc.querySelectorAll('[data-item-tile]')].map(box)
      };
    }`
  });
  assert.equal(results.length, pages.length * WIDTHS.length);
  for (const result of results) {
    const at = `${result.page} at ${result.width}px`;
    const { button, grid, tiles } = result;
    assert.equal(tiles.length, expected[result.page], `${at}: item tile count`);
    assert.equal(result.pageOverflow, false, `${at}: no horizontal scroll`);
    assert.ok(button.right <= result.width && button.left >= 0, `${at}: + New item inside the screen`);
    assert.equal(button.borderStyle, "dashed", `${at}: dashed border kept`);
    assert.equal(button.borderWidth, 3, `${at}: 3px border`);
    const rowWidth = grid.width - grid.paddingLeft - grid.paddingRight;
    if (tiles.length % 2 === 0) {
      assert.ok(Math.abs(button.height - 72) <= 0.5, `${at}: 72px tall on its own row (is ${button.height})`);
      assert.ok(Math.abs(button.width - rowWidth) <= 0.5, `${at}: spans the full grid width (${button.width} of ${rowWidth})`);
      if (tiles.length) assert.ok(button.top >= tiles.at(-1).bottom, `${at}: on its own row below the last tile`);
      continue;
    }
    const last = tiles.at(-1);
    assert.ok(Math.abs(button.width - last.width) <= 0.5, `${at}: one tile wide (${button.width} vs ${last.width})`);
    assert.ok(Math.abs(button.top - last.top) <= 0.5 && button.left > last.left, `${at}: beside the last tile on its row`);
    assert.ok(Math.abs(button.height - last.height) <= 0.5 && button.height >= 71.5, `${at}: same height as the tile beside it (${button.height})`);
  }
});
