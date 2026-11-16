import assert from "node:assert/strict";
import { test } from "node:test";
import { appCss, browser, measureInFrames } from "./helpers/browserLayout.js";
import { PROOF_T, correctionRow, creditRow, proofPages } from "./helpers/proofPages.js";

// Wiring "What happened cards" (final, 16 Nov 2026) on 29, 43 and 73, real browser at 340, 360 and 393px:
// every card has a title row (title left, amount right, the amount never drops under the title), then
// label-value rows: the label grey on the left (never wraps), the value bold on the right. A long reason
// (60 characters) and "Cash GH₵1,234.00, MoMo GH₵12,345.00" wrap inside the right column only. Nothing
// scrolls sideways. Paid: Time, Paid with. Credit: Time, Reason, Signature. Corrected: Was, New balance,
// Time, Reason.

const skip = browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)";
const LONG = "Two bags of rice, three tins of Milo, cooking oil and 2 eggs";
const splitPaid = { id: "p1", type: "payment", timestamp: PROOF_T, amountPesewas: 1357900, collectionParts: [{ method: "MoMo", amountPesewas: 1234500 }, { method: "Cash", amountPesewas: 123400 }] };
const HISTORY = [
  correctionRow("a1", 150000000, 123456789, LONG),
  splitPaid,
  creditRow("c1", 123456789, LONG, false),
  creditRow("c2", 6000, "", true)
];

const MEASURE = `(frame, win, doc) => {
  const textLines = (el) => { const tops = new Set(); const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT); while (walker.nextNode()) { const node = walker.currentNode; if (!node.textContent.trim()) continue; const range = doc.createRange(); range.selectNodeContents(node); for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top)); } return tops.size; };
  const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
  const cards = [...doc.querySelectorAll("[data-record-row]")].map((card) => {
    const style = win.getComputedStyle(card);
    const titleEl = card.querySelector("[data-event-title]") ?? card.querySelector("[data-correction-title]");
    const amountEl = card.querySelector("[data-event-amount]");
    return {
      kind: card.dataset.recordRow,
      dashed: style.borderTopStyle === "dashed",
      cardLeft: box(card).left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth),
      cardRight: box(card).right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth),
      title: { text: titleEl.textContent, lines: textLines(titleEl), ...box(titleEl) },
      amount: amountEl ? { text: amountEl.textContent, lines: textLines(amountEl), ...box(amountEl) } : null,
      rows: [...card.querySelectorAll("[data-event-detail]")].map((row) => {
        const label = row.querySelector("dt");
        const value = row.querySelector("dd");
        const ls = win.getComputedStyle(label);
        const vs = win.getComputedStyle(value);
        return {
          label: label.textContent, labelLines: textLines(label), labelBox: box(label), labelWeight: ls.fontWeight, labelColor: ls.color,
          value: value.textContent, valueLines: textLines(value), valueBox: box(value), valueWeight: vs.fontWeight, valueColor: vs.color, valueAlign: vs.textAlign,
          size: vs.fontSize, divider: win.getComputedStyle(row).borderTopWidth
        };
      })
    };
  });
  return { pageOverflow: doc.scrollingElement.scrollWidth > win.innerWidth || doc.body.scrollWidth > win.innerWidth, cards };
}`;

test("What happened cards on 29, 43 and 73 at 340, 360 and 393px: title row, then label-value rows; long values wrap in the right column only", { skip }, async () => {
  assert.equal(LONG.length, 60, "the long reason is 60 characters");
  const pages = await proofPages(HISTORY);
  const results = measureInFrames({ pages, css: await appCss(), widths: [340, 360, 393], height: 3000, measure: MEASURE });
  assert.equal(results.length, 9);
  for (const result of results) {
    const where = `${result.page} at ${result.width}px`;
    assert.equal(result.innerWidth, result.width, `${where}: the frame is that wide`);
    assert.equal(result.pageOverflow, false, `${where}: no sideways scroll`);
    const credit = result.page === "73" ? "Took on credit" : "Added to debt";
    assert.deepEqual(result.cards.map((card) => card.kind), ["corrected", "paid", "credit", "credit"], `${where}: the cards, newest first`);
    assert.deepEqual(result.cards.map((card) => card.title.text), ["Balance corrected", "Paid", credit, credit], `${where}: titles`);
    assert.deepEqual(result.cards.map((card) => card.rows.map((row) => row.label)), [
      ["Was", "New balance", "Time", "Reason"],
      ["Time", "Paid with"],
      ["Time", "Reason", "Signature"],
      ["Time", "Reason", "Signature"]
    ], `${where}: the rows of each card`);
    assert.deepEqual(result.cards.map((card) => card.dashed), [true, false, false, false], `${where}: only Balance corrected is dashed`);
    const [corrected, paid, longCredit, shortCredit] = result.cards;
    assert.equal(corrected.amount, null, `${where}: Balance corrected has the title alone`);
    assert.equal(corrected.title.lines, 1, `${where}: "Balance corrected" never wraps`);
    assert.equal(paid.rows[1].value, "Cash GH₵1,234.00, MoMo GH₵12,345.00", `${where}: Paid with, Cash first`);
    assert.equal(longCredit.rows[1].value, LONG);
    assert.equal(corrected.rows[3].value, LONG);
    assert.equal(shortCredit.rows[1].value, "No reason written");
    // 29/43 offer Get signature next to the pill for an unsigned credit at or above the threshold; 73 does not.
    assert.equal(longCredit.rows[2].value, result.page === "73" ? "Not signed" : "Not signedGet signature");
    assert.equal(shortCredit.rows[2].value, "Signed ✓");
    for (const card of result.cards) {
      const what = `${where} ${card.title.text}`;
      if (card.amount) {
        assert.equal(card.amount.lines, 1, `${what}: the amount "${card.amount.text}" is one line`);
        assert.ok(card.amount.top < card.title.bottom - 0.5, `${what}: the amount never drops under the title`);
        assert.ok(card.amount.left >= card.title.right - 0.5, `${what}: the amount is right of the title`);
        assert.ok(Math.abs(card.amount.right - card.cardRight) < 0.5, `${what}: the amount ends on the card's right edge`);
      }
      for (const row of card.rows) {
        const at = `${what} / ${row.label}`;
        assert.equal(row.labelLines, 1, `${at}: the label never wraps`);
        assert.ok(Math.abs(row.labelBox.left - card.cardLeft) < 0.5, `${at}: the label is on the left`);
        assert.equal(row.labelWeight, "400", `${at}: the label is regular weight`);
        assert.equal(row.valueWeight, "700", `${at}: the value is bold`);
        assert.notEqual(row.labelColor, row.valueColor, `${at}: the label is grey`);
        assert.equal(row.valueAlign, "right", `${at}: the value is right-aligned`);
        assert.equal(row.size, "18px", `${at}: the same size as the card on 72`);
        assert.equal(row.divider, "1px", `${at}: a thin line above the row`);
        assert.ok(row.valueBox.left >= row.labelBox.right - 0.5, `${at}: the value stays in the right column ("${row.value}")`);
        assert.ok(row.valueBox.right <= card.cardRight + 0.5, `${at}: the value stays inside the card`);
      }
    }
    // The long values really wrap (more than one line) at these widths, and stay in their column.
    assert.ok(longCredit.rows[1].valueLines > 1, `${where}: the 60-character reason wraps`);
    assert.ok(corrected.rows[3].valueLines > 1, `${where}: the 60-character correction reason wraps`);
    if (result.width < 393) assert.ok(paid.rows[1].valueLines > 1, `${where}: the Paid with value wraps`);
  }
});
