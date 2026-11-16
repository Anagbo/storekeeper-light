import assert from "node:assert/strict";
import { test } from "node:test";
import { appCss, browser, measureInFrames } from "./helpers/browserLayout.js";
import { correctionRow, creditRow, paidRow, proofPages } from "./helpers/proofPages.js";

// Wiring 29/43 and 73 "Balance corrected row" (changed 16 Nov 2026), real browser at 340, 360 and 393px:
// line 1 the title alone, one line; line 2 "Was GH₵old" on the left (grey, regular weight) and the NEW
// balance on the right (bold, 24px, neutral dark), ending on the same right edge as the amounts of the
// other rows; line 3 the date and "Reason: …". No amount ever breaks; nothing scrolls sideways.

const skip = browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)";
// The owner's two examples: a new balance of GH₵1,234,567.89, and GH₵105.00 corrected to GH₵0.00.
const CASES = [[150000000, 123456789], [10500, 0]];

const MEASURE = `(frame, win, doc) => {
  const textLines = (el) => { const tops = new Set(); const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT); while (walker.nextNode()) { const node = walker.currentNode; if (!node.textContent.trim()) continue; const range = doc.createRange(); range.selectNodeContents(node); for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top)); } return tops.size; };
  const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
  const title = doc.querySelector("[data-correction-title]");
  const holder = title.parentElement;
  const was = holder.querySelector("[data-correction-was]");
  const now = holder.querySelector("[data-correction-new]");
  const when = holder.querySelector("[data-correction-when]");
  const list = holder.closest("ul");
  const others = [...list.querySelectorAll("li")].filter((li) => li !== holder && !li.contains(holder))
    .map((li) => [...li.querySelectorAll("strong")].filter((el) => /GH₵[\\d,]+\\.\\d\\d$/.test(el.textContent.trim())).pop())
    .filter(Boolean);
  const style = win.getComputedStyle(now);
  const wasStyle = win.getComputedStyle(was);
  return {
    pageOverflow: doc.scrollingElement.scrollWidth > win.innerWidth,
    rowCount: doc.querySelectorAll("[data-correction-title]").length,
    title: { text: title.textContent, lines: textLines(title), ...box(title) },
    was: { text: was.textContent, lines: textLines(was), weight: wasStyle.fontWeight, color: wasStyle.color, ...box(was) },
    now: { text: now.textContent, lines: textLines(now), size: style.fontSize, weight: style.fontWeight, color: style.color, ...box(now) },
    when: { text: when.textContent, ...box(when) },
    holderRight: holder.getBoundingClientRect().right,
    others: others.map((el) => ({ text: el.textContent.trim(), right: el.getBoundingClientRect().right }))
  };
}`;

test("Balance corrected on 29, 43 and 73 at 340, 360 and 393px: title, Was GH₵old with the new balance on the amounts' right edge, then date and reason", { skip }, async () => {
  const pages = [];
  for (const [previous, next] of CASES) {
    const history = [correctionRow(`a${previous}`, previous, next), creditRow("c1", 123456789, "Rice", true), paidRow("p1", 10500)];
    for (const page of await proofPages(history)) pages.push({ name: `${page.name}|${previous}`, html: page.html });
  }
  const results = measureInFrames({ pages, css: await appCss(), widths: [340, 360, 393], height: 2600, measure: MEASURE });
  assert.equal(results.length, pages.length * 3);
  for (const result of results) {
    const where = `${result.page} at ${result.width}px`;
    const [previous] = CASES.find(([old]) => result.page.endsWith(`|${old}`));
    const next = CASES.find(([old]) => old === previous)[1];
    const { title, was, now, when } = result;
    assert.equal(result.innerWidth, result.width, `${where}: the frame is that wide`);
    assert.equal(result.pageOverflow, false, `${where}: no sideways scroll`);
    assert.equal(result.rowCount, 1, `${where}: one correction row`);
    // Line 1: the title alone, one line.
    assert.equal(title.text, "Balance corrected");
    assert.equal(title.lines, 1, `${where}: "Balance corrected" is one line`);
    // Line 2: Was GH₵old on the left, the new balance on the right.
    assert.equal(was.text, previous === 10500 ? "Was GH₵105.00" : "Was GH₵1,500,000.00");
    assert.equal(now.text, next === 0 ? "GH₵0.00" : "GH₵1,234,567.89");
    assert.ok(was.top >= title.bottom - 0.5 && now.top >= title.bottom - 0.5, `${where}: Was and the new balance are under the title`);
    assert.ok(Math.abs(was.left - title.left) < 0.5, `${where}: Was starts on the left edge`);
    assert.equal(was.lines, 1, `${where}: "${was.text}" never breaks`);
    assert.equal(now.lines, 1, `${where}: "${now.text}" never breaks`);
    assert.equal(was.weight, "400", `${where}: Was is regular weight`);
    assert.notEqual(was.color, now.color, `${where}: Was is grey`);
    assert.equal(now.size, "24px", `${where}: the new balance is 24px`);
    assert.equal(now.weight, "700", `${where}: the new balance is bold`);
    assert.equal(now.color, "oklch(0.208 0.042 265.755)", `${where}: the new balance is neutral dark (slate-900), not red or green`);
    assert.ok(result.others.length >= 2, `${where}: the other rows' amounts are measured (${JSON.stringify(result.others)})`);
    for (const other of result.others) {
      assert.ok(Math.abs(now.right - other.right) < 0.5, `${where}: the new balance ends on the right edge of "${other.text}" (${now.right} vs ${other.right})`);
    }
    assert.ok(now.right <= result.holderRight + 0.5, `${where}: the new balance stays inside the row`);
    // Line 3: the date and the reason.
    assert.ok(when.top >= Math.max(was.bottom, now.bottom) - 0.5, `${where}: the date and reason come after line 2`);
    assert.match(when.text, /^\d{2}\/\d{2}\/\d{4} 16:40 · Reason: Wrong amount typed$/);
    if (next === 0) assert.ok(Math.abs(now.top - was.top) < 12, `${where}: GH₵105.00 to GH₵0.00 fits on one line`);
  }
});
