import assert from "node:assert/strict";
import { test } from "node:test";
import { appCss, browser, measureInFrames, toHtml } from "./helpers/browserLayout.js";
import { loadJsx, render, setLiveQuery } from "./helpers/renderJsx.js";

// Wiring 72 rules.1 (16 Nov 2026), real browser at 340, 360 and 393px: under a thin line, three
// label-value rows "For", "Taken", "Pay by". The label is on the left in grey regular weight, the value
// on the right, bold, right-aligned. A long value (an 80-character reason, or one long unbroken word)
// wraps inside its own column and never pushes the label. With no reason the value is "No reason written".

const skip = browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)";
const REASON_80 = "Two bags of rice, three tins of Milo, cooking oil 5L, sugar and a crate of eggs!";
const LONG_WORD = "Supercalifragilisticexpialidociousbagsofriceandsugarforthewholemonth";
const CASES = { long: REASON_80, word: LONG_WORD, none: "" };

async function signatureHtml(note) {
  const { default: CustomerSignature } = await loadJsx("src/pos/CustomerSignature.jsx");
  const event = { id: "t1", type: "manual_debt", customer_name: "Nana Akosua Frimpomaa", creditExtendedPesewas: 1234567, createdAt: new Date(2026, 10, 16, 10, 0).getTime(), takenOn: "2026-11-16", dueDate: "2026-11-23", note };
  setLiveQuery(() => ({ event, debt: null }));
  try {
    return toHtml(render({ type: CustomerSignature, props: { params: { transactionId: "t1" }, onFinish() {}, shopName: "Mama Esi's Provisions Store" } }).tree);
  } finally {
    setLiveQuery(null);
  }
}

const MEASURE = `(frame, win, doc) => {
  const textLines = (el) => { const tops = new Set(); const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT); while (walker.nextNode()) { const node = walker.currentNode; if (!node.textContent.trim()) continue; const range = doc.createRange(); range.selectNodeContents(node); for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top)); } return tops.size; };
  const card = doc.querySelector("[data-sign-card]");
  const cardStyle = win.getComputedStyle(card);
  const cardBox = card.getBoundingClientRect();
  const list = doc.querySelector("[data-sign-details]");
  const amount = doc.querySelector("[data-sign-amount]");
  return {
    pageOverflow: doc.scrollingElement.scrollWidth > win.innerWidth,
    cardOverflow: card.scrollWidth > card.clientWidth,
    content: { left: cardBox.left + parseFloat(cardStyle.paddingLeft), right: cardBox.right - parseFloat(cardStyle.paddingRight) },
    line: { width: win.getComputedStyle(list).borderTopWidth, style: win.getComputedStyle(list).borderTopStyle, top: list.getBoundingClientRect().top, amountBottom: amount.getBoundingClientRect().bottom },
    rows: [...list.querySelectorAll("[data-sign-detail]")].map((row) => {
      const label = row.querySelector("dt"); const value = row.querySelector("dd");
      const l = label.getBoundingClientRect(); const v = value.getBoundingClientRect();
      const ls = win.getComputedStyle(label); const vs = win.getComputedStyle(value);
      return { label: label.textContent, value: value.textContent, labelLeft: l.left, labelRight: l.right, labelTop: l.top, labelLines: textLines(label), valueLeft: v.left, valueRight: v.right, valueLines: textLines(value),
        valueClipped: value.scrollWidth > value.clientWidth + 1, labelWeight: ls.fontWeight, labelColor: ls.color, valueWeight: vs.fontWeight, valueAlign: vs.textAlign, valueColor: vs.color };
    })
  };
}`;

test("72 card at 340, 360 and 393px: For, Taken and Pay by as label-value rows; long values wrap in their own column", { skip }, async () => {
  const pages = [];
  for (const [name, note] of Object.entries(CASES)) pages.push({ name, html: await signatureHtml(note) });
  const results = measureInFrames({ pages, css: await appCss(), widths: [340, 360, 393], height: 1600, measure: MEASURE });
  assert.equal(results.length, 9);
  for (const result of results) {
    const where = `72 (${result.page} reason) at ${result.width}px`;
    assert.equal(result.pageOverflow, false, `${where}: no sideways scroll`);
    assert.equal(result.cardOverflow, false, `${where}: nothing sticks out of the card`);
    assert.equal(result.line.style, "solid", `${where}: a thin line above the rows`);
    assert.equal(result.line.width, "1px", `${where}: the line is thin`);
    assert.ok(result.line.top >= result.line.amountBottom - 0.5, `${where}: the rows are under the amount`);
    assert.deepEqual(result.rows.map((row) => row.label), ["For", "Taken", "Pay by"], `${where}: For, Taken, Pay by`);
    assert.deepEqual(result.rows.map((row) => row.value).slice(1), ["16/11/2026", "23/11/2026"]);
    assert.equal(result.rows[0].value, CASES[result.page] || "No reason written", `${where}: the For value`);
    for (const row of result.rows) {
      assert.ok(Math.abs(row.labelLeft - result.content.left) < 1, `${where}: "${row.label}" starts at the card's left edge`);
      assert.equal(row.labelLines, 1, `${where}: "${row.label}" is one line`);
      assert.equal(row.labelWeight, "400", `${where}: "${row.label}" is regular weight`);
      assert.notEqual(row.labelColor, row.valueColor, `${where}: "${row.label}" is grey, not the value colour`);
      assert.equal(row.valueWeight, "700", `${where}: the "${row.label}" value is bold`);
      assert.equal(row.valueAlign, "right", `${where}: the "${row.label}" value is right-aligned`);
      assert.ok(Math.abs(row.valueRight - result.content.right) < 1, `${where}: the "${row.label}" value ends at the card's right edge`);
      assert.ok(row.valueLeft >= row.labelRight, `${where}: the "${row.label}" value stays in its own column`);
      assert.equal(row.valueClipped, false, `${where}: the "${row.label}" value is not cut`);
    }
    if (result.page !== "none") assert.ok(result.rows[0].valueLines > 1, `${where}: the long For value wraps (${result.rows[0].valueLines} lines)`);
  }
});
