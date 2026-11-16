import assert from "node:assert/strict";
import { test } from "node:test";
import { appCss, browser, measureInFrames, toHtml } from "./helpers/browserLayout.js";
import { loadJsx, render, setLiveQuery } from "./helpers/renderJsx.js";

// Wiring 20 "Item tiles" in a real browser at 340, 360 and 393px (fix of 16 Nov 2026: the price ran
// under the ×n badge). The badge sits on the tile's top-right corner, over the edge; the name and the
// price use the full tile width; the price stays on one line at 14px or more and inside the tile; the
// badge covers neither the price nor the name.

const WIDTHS = [340, 360, 393];
const products = [
  { id: 1, name: "Bread", default_price: 2 },
  { id: 2, name: "Extra large imported long grain parboiled rice", default_price: 2000 },
  { id: 3, name: "Sugar", default_price: 5 }
];
const saleItems = [
  { productId: 1, name: "Bread", quantity: 1, unitPricePesewas: 200 },
  { productId: 2, name: "Extra large imported long grain parboiled rice", quantity: 12, unitPricePesewas: 200000 }
];

test("20 selected tiles: the price and the ×n badge never meet, at 340, 360 and 393px", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)" }, async () => {
  const { default: SellWithItems } = await loadJsx("src/pos/SellWithItems.jsx");
  setLiveQuery(() => ({ products, error: "" }));
  let html;
  try {
    html = toHtml(render({ type: SellWithItems, props: { params: { saleItems }, onBack() {}, onNavigate() {}, onUpdateParams() {} } }).tree);
  } finally {
    setLiveQuery(null);
  }
  const results = measureInFrames({
    pages: [{ name: "20", html }],
    css: await appCss(),
    widths: WIDTHS,
    height: 1200,
    measure: `(frame, win, doc) => {
      const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
      return {
        viewport: win.innerWidth,
        pageOverflow: doc.scrollingElement.scrollWidth > win.innerWidth,
        tiles: [...doc.querySelectorAll('[data-item-tile]')].map((tile) => {
          const price = tile.querySelector('[data-tile-price]');
          const name = tile.querySelector('[data-tile-name]');
          const badge = tile.querySelector('[data-count-badge]');
          return {
            name: tile.getAttribute('data-item-tile'),
            tile: box(tile),
            price: { ...box(price), text: price.textContent, scroll: price.scrollWidth, client: price.clientWidth, fontSize: parseFloat(getComputedStyle(price).fontSize), lines: Math.round(price.getBoundingClientRect().height / parseFloat(getComputedStyle(price).lineHeight)) },
            nameBox: box(name),
            badge: badge ? { ...box(badge), text: badge.textContent, fontSize: parseFloat(getComputedStyle(badge).fontSize), fontWeight: getComputedStyle(badge).fontWeight } : null
          };
        })
      };
    }`
  });
  const meets = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  for (const result of results) {
    const where = `at ${result.width}px`;
    assert.equal(result.viewport, result.width, where);
    assert.equal(result.pageOverflow, false, `${where}: no horizontal scroll`);
    for (const tile of result.tiles) {
      const at = `${tile.name} ${where}`;
      const { price } = tile;
      assert.ok(price.left >= tile.tile.left && price.right <= tile.tile.right, `${at}: the price ${price.text} inside the tile`);
      assert.ok(price.scroll <= price.client + 1, `${at}: the price ${price.text} not cut (needs ${price.scroll}px, has ${price.client}px)`);
      assert.equal(price.lines, 1, `${at}: the price on one line`);
      assert.ok(price.fontSize >= 14, `${at}: the price at 14px or more`);
      if (!tile.badge) continue;
      assert.equal(meets(price, tile.badge), false, `${at}: the price and the badge do not intersect`);
      assert.equal(meets(tile.nameBox, tile.badge), false, `${at}: the badge does not cover the name`);
      assert.ok(tile.badge.right > tile.tile.right && tile.badge.top < tile.tile.top, `${at}: the badge sits over the top-right corner`);
      assert.ok(tile.badge.width >= 24 && tile.badge.height >= 24, `${at}: the badge is at least 24px`);
      assert.equal(tile.badge.fontSize, 14, `${at}: badge text 14px`);
      assert.ok(Number(tile.badge.fontWeight) >= 700, `${at}: badge text bold`);
      assert.ok(tile.badge.right <= result.viewport, `${at}: the badge inside the screen`);
    }
    assert.ok(result.tiles.filter((tile) => tile.badge).length === 2, `${where}: Bread and the rice are selected`);
  }
});
