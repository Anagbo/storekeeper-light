import assert from "node:assert/strict";
import { test } from "node:test";
import { appCss, browser, measureInFrames } from "./helpers/browserLayout.js";
import { detailHtml } from "./helpers/proofPages.js";

// Polish 16 Nov 2026, 29/43 header card: Edit contact is on its own row under Back and the name, 48px high,
// its left edge on the Back button's left edge. Real browser at 340, 360 and 393px, short and long names.

const skip = browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)";
const NAMES = { short: "Ama", long: "Nana Akosua Frimpomaa Boatemaa-Asantewaa Owusu" };

const MEASURE = `(frame, win, doc) => {
  const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }; };
  const card = doc.querySelector('[data-row="debtor-header"]');
  const edit = card.querySelector("[data-edit-contact]");
  return {
    pageOverflow: doc.scrollingElement.scrollWidth > win.innerWidth,
    card: box(card), back: box(card.querySelector('button[aria-label="Back"]')), name: box(card.querySelector("strong")),
    edit: { ...box(edit), text: edit.textContent.trim(), clipped: edit.scrollWidth > edit.clientWidth + 1 }
  };
}`;

test("29/43 header at 340, 360 and 393px: Edit contact on its own row, left-aligned with Back, 48px", { skip }, async () => {
  const pages = [];
  for (const [size, name] of Object.entries(NAMES)) {
    pages.push({ name: `29|${size}`, html: await detailHtml({ name }) });
    pages.push({ name: `43|${size}`, html: await detailHtml({ name, late: true }) });
  }
  const results = measureInFrames({ pages, css: await appCss(), widths: [340, 360, 393], height: 1600, measure: MEASURE });
  assert.equal(results.length, 12);
  for (const result of results) {
    const where = `${result.page} at ${result.width}px`;
    const { back, name, edit, card } = result;
    assert.equal(result.pageOverflow, false, `${where}: no sideways scroll`);
    assert.equal(edit.text, "Edit contact");
    assert.ok(Math.abs(edit.height - 48) < 0.5, `${where}: Edit contact is 48px high (${edit.height})`);
    assert.ok(Math.abs(edit.left - back.left) < 0.5, `${where}: Edit contact starts on Back's left edge (${edit.left} vs ${back.left})`);
    assert.ok(edit.top >= back.bottom - 0.5 && edit.top >= name.bottom - 0.5, `${where}: Edit contact is on its own row under Back and the name`);
    assert.ok(edit.bottom <= card.bottom && edit.right <= card.right, `${where}: Edit contact is inside the card`);
    assert.equal(edit.clipped, false, `${where}: Edit contact is not cut`);
  }
});
