import assert from "node:assert/strict";
import { test } from "node:test";
import { appCss, browser, measureInFrames } from "./helpers/browserLayout.js";
import { correctionRow, creditRow, paidRow, proofPages } from "./helpers/proofPages.js";

// Wiring "What happened cards" (final, 16 Nov 2026; replaces the "Balance corrected row" layout), real
// browser at 340, 360 and 393px on 29, 43 and 73: Balance corrected is a dashed card, the title alone on
// its first line (one line), then the label-value rows Was (GH₵old), New balance (bold), Time and Reason.
// Labels never wrap; no amount ever breaks; nothing scrolls sideways.

const skip = browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)";
// The owner's two examples: a new balance of GH₵1,234,567.89, and GH₵105.00 corrected to GH₵0.00.
const CASES = [[150000000, 123456789], [10500, 0]];

const MEASURE = `(frame, win, doc) => {
  const textLines = (el) => { const tops = new Set(); const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT); while (walker.nextNode()) { const node = walker.currentNode; if (!node.textContent.trim()) continue; const range = doc.createRange(); range.selectNodeContents(node); for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top)); } return tops.size; };
  const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
  const title = doc.querySelector("[data-correction-title]");
  const card = title.closest("li");
  const cardStyle = win.getComputedStyle(card);
  const rows = [...card.querySelectorAll("[data-event-detail]")].map((row) => {
    const label = row.querySelector("dt");
    const value = row.querySelector("dd");
    return { name: row.dataset.eventDetail, label: label.textContent, labelLines: textLines(label), value: value.textContent, valueLines: textLines(value), weight: win.getComputedStyle(value).fontWeight, top: box(row).top, valueRight: box(value).right };
  });
  return {
    pageOverflow: doc.scrollingElement.scrollWidth > win.innerWidth,
    count: doc.querySelectorAll("[data-correction-title]").length,
    dashed: cardStyle.borderTopStyle,
    title: { text: title.textContent, lines: textLines(title), ...box(title) },
    contentRight: box(card).right - parseFloat(cardStyle.paddingRight) - parseFloat(cardStyle.borderRightWidth),
    rows
  };
}`;

test("Balance corrected on 29, 43 and 73 at 340, 360 and 393px: dashed card, title alone, then Was, New balance, Time, Reason rows", { skip }, async () => {
  const pages = [];
  for (const [previous, next] of CASES) {
    const history = [correctionRow(`a${previous}`, previous, next), creditRow("c1", 123456789, "Rice", true), paidRow("p1", 10500)];
    for (const page of await proofPages(history)) pages.push({ name: `${page.name}|${previous}`, html: page.html });
  }
  const results = measureInFrames({ pages, css: await appCss(), widths: [340, 360, 393], height: 2600, measure: MEASURE });
  assert.equal(results.length, pages.length * 3);
  for (const result of results) {
    const where = `${result.page} at ${result.width}px`;
    const [previous, next] = CASES.find(([old]) => result.page.endsWith(`|${old}`));
    const { title, rows } = result;
    assert.equal(result.innerWidth, result.width, `${where}: the frame is that wide`);
    assert.equal(result.pageOverflow, false, `${where}: no sideways scroll`);
    assert.equal(result.count, 1, `${where}: one correction card`);
    assert.equal(result.dashed, "dashed", `${where}: the card is dashed`);
    assert.equal(title.text, "Balance corrected");
    assert.equal(title.lines, 1, `${where}: "Balance corrected" is one line`);
    assert.deepEqual(rows.map((row) => row.label), ["Was", "New balance", "Time", "Reason"], `${where}: the rows in order`);
    assert.deepEqual(rows.map((row) => row.name), ["was", "new-balance", "time", "reason"]);
    assert.ok(rows[0].top >= title.bottom - 0.5, `${where}: the rows come under the title`);
    for (let index = 1; index < rows.length; index += 1) assert.ok(rows[index].top > rows[index - 1].top, `${where}: ${rows[index].label} under ${rows[index - 1].label}`);
    assert.equal(rows[0].value, previous === 10500 ? "GH₵105.00" : "GH₵1,500,000.00");
    assert.equal(rows[1].value, next === 0 ? "GH₵0.00" : "GH₵1,234,567.89");
    assert.equal(rows[1].weight, "700", `${where}: the new balance is bold`);
    assert.match(rows[2].value, /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/, `${where}: an older day shows dd/mm/yyyy HH:mm`);
    assert.equal(rows[3].value, "Wrong amount typed", `${where}: the reason entered on 54, no "Reason:" prefix`);
    for (const row of rows) {
      assert.equal(row.labelLines, 1, `${where}: the label "${row.label}" never wraps`);
      assert.ok(Math.abs(row.valueRight - result.contentRight) < 0.5, `${where}: "${row.value}" ends on the card's right edge`);
    }
    assert.equal(rows[0].valueLines, 1, `${where}: Was never breaks`);
    assert.equal(rows[1].valueLines, 1, `${where}: the new balance never breaks`);
  }
});
