import assert from "node:assert/strict";
import { test } from "node:test";
import { appCss, browser, measureInFrames } from "./helpers/browserLayout.js";
import { PROOF_T, correctionRow, creditRow, proofPages } from "./helpers/proofPages.js";

// Wiring "What happened cards" (final, 16 Nov 2026) on 29, 43 and 73, real browser at 340, 360 and 393px:
// every card has a title row (title left, amount right, the amount never drops under the title), then
// label-value rows: the label grey on the left (never wraps), the value bold on the right. A long reason
// (60 characters) wraps inside the right column only; Paid with is one line per method (Cash, then MoMo). Nothing
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
      action: (() => {
        const button = card.querySelector("button");
        if (!button) return null;
        const bs = win.getComputedStyle(button);
        const rows = [...card.querySelectorAll("[data-event-detail]")];
        return { text: button.textContent, look: button.getAttribute("data-look"), lines: textLines(button), overflow: button.scrollWidth > button.clientWidth, height: button.getBoundingClientRect().height, border: bs.borderTopStyle + " " + bs.borderTopWidth, background: bs.backgroundColor, lastRowBottom: box(rows.at(-1)).bottom, ...box(button) };
      })(),
      rows: [...card.querySelectorAll("[data-event-detail]")].map((row) => {
        const label = row.querySelector("dt");
        const value = row.querySelector("dd");
        const ls = win.getComputedStyle(label);
        const vs = win.getComputedStyle(value);
        return {
          label: label.textContent, labelLines: textLines(label), labelBox: box(label), labelWeight: ls.fontWeight, labelColor: ls.color,
          value: value.textContent, valueLines: textLines(value), valueBox: box(value), valueWeight: vs.fontWeight, valueColor: vs.color, valueAlign: vs.textAlign,
          paidLines: [...value.querySelectorAll("[data-paid-line]")].map((line) => ({ text: line.textContent, lines: textLines(line), ...box(line) })),
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
    // Decision (4) after the build (16 Nov 2026): no "+" before the Paid amount on any of the three.
    assert.equal(paid.amount.text, "GH₵13,579.00", `${where}: the Paid amount has no "+"`);
    // Paid with is one line per method since 297db30 (no comma list), Cash first.
    assert.deepEqual(paid.rows[1].paidLines.map((line) => line.text), ["Cash GH₵1,234.00", "MoMo GH₵12,345.00"], `${where}: Paid with, Cash first, one line each`);
    for (const line of paid.rows[1].paidLines) {
      assert.equal(line.lines, 1, `${where}: "${line.text}" is one line`);
      assert.ok(line.right <= paid.cardRight + 0.5 && line.left >= paid.rows[1].labelBox.right - 0.5, `${where}: "${line.text}" stays in the right column`);
    }
    assert.ok(paid.rows[1].paidLines[0].bottom <= paid.rows[1].paidLines[1].top + 0.5, `${where}: MoMo is under Cash`);
    assert.equal(longCredit.rows[1].value, LONG);
    assert.equal(corrected.rows[3].value, LONG);
    assert.equal(shortCredit.rows[1].value, "No reason written");
    // Wiring "Signature row and Get signature" (17 Nov 2026): the Signature row shows only the status tag.
    // 29/43 offer Get signature for an unsigned credit at or above the threshold: on its own line below the
    // card's last row, full width of the card, 52px, the add look without the "+"; 73 and signed entries
    // have no button.
    assert.equal(longCredit.rows[2].value, "Not signed");
    assert.equal(shortCredit.rows[2].value, "Signed ✓");
    assert.equal(shortCredit.action, null, `${where}: no button on a signed entry`);
    for (const card of [corrected, paid]) assert.equal(card.action, null, `${where}: no button on ${card.kind}`);
    if (result.page === "73") assert.equal(longCredit.action, null, `${where}: no Get signature on 73`);
    else {
      const action = longCredit.action;
      assert.ok(action, `${where}: Get signature is shown`);
      assert.equal(action.text, "Get signature", `${where}: the label is exactly Get signature, no "+"`);
      assert.equal(action.look, "add", `${where}: the add look`);
      assert.equal(action.border, "dashed 2px", `${where}: dashed 2px border`);
      assert.equal(action.background, "rgba(0, 0, 0, 0)", `${where}: no fill`);
      assert.ok(action.top >= action.lastRowBottom - 0.5, `${where}: below the last row (${action.top} vs ${action.lastRowBottom})`);
      assert.ok(Math.abs(action.left - longCredit.cardLeft) < 0.5 && Math.abs(action.right - longCredit.cardRight) < 0.5, `${where}: full width of the card`);
      assert.ok(Math.abs(action.height - 52) < 0.5, `${where}: 52px (${action.height})`);
      assert.equal(action.lines, 1, `${where}: one line`);
      assert.ok(!action.overflow, `${where}: no overflow`);
    }
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
    assert.equal(paid.rows[1].valueLines, 2, `${where}: the Paid with value is two lines, one per method`);
  }
});
