import assert from "node:assert/strict";
import { test } from "node:test";
import { appCss, browser, measureInFrames, toHtml } from "./helpers/browserLayout.js";
import { loadJsx, render, setLiveQuery } from "./helpers/renderJsx.js";

// Wiring 29/43 and 73 (16 Nov 2026), real browser at 340, 360 and 393px: "Balance corrected" is on its
// own line and never wraps; "GH₵old → GH₵new" is on the next line, its amounts never broken; then the
// date and reason. Nothing scrolls sideways.

const skip = browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)";
const NAME = "Nana Akosua Frimpomaa";
const T = new Date(2026, 10, 12, 16, 40).getTime();
const correction = (previous, next) => ({ id: `a${previous}`, type: "adjustment", timestamp: T, previousBalancePesewas: previous, newBalancePesewas: next, deltaPesewas: next - previous, amountPesewas: previous - next, reasonCode: "other", reasonNote: "Wrong amount typed", reasonLabel: "Other" });
// The owner's example, and one far larger.
const CASES = [[123450, 120000], [123456789, 111111111]];

async function detailHtml(late, history) {
  const { DebtorDetail } = await loadJsx("src/pos/DebtCollection.jsx", {});
  const debt = { id: "d1", customerId: "c1", customerName: NAME, amountPesewas: 120000, status: "unpaid", isInstallmentPlan: false, dueDate: late ? "2020-01-01" : "2099-01-01" };
  setLiveQuery(([debtId]) => (debtId === "d1" ? { name: NAME, customerId: "c1", phone: "", ghanaCardNumber: "", balancePesewas: 120000, debt, unpaidDebts: [debt], unpaidDebtCount: 1, history, lastReminderAt: 0 } : undefined));
  try {
    return toHtml(render({ type: DebtorDetail, props: { params: { debtId: "d1", customerName: NAME }, onBack() {}, onNavigate() {}, onCollect() {}, shopName: "My shop" } }).tree);
  } finally {
    setLiveQuery(null);
  }
}

async function recordHtml(rows) {
  const { default: CustomerRecordView } = await loadJsx("src/pos/CustomerRecordView.jsx");
  setLiveQuery(() => ({ name: NAME, balancePesewas: 120000, rows }));
  try {
    return toHtml(render({ type: CustomerRecordView, props: { params: { customerId: "c1" }, onBack() {} } }).tree);
  } finally {
    setLiveQuery(null);
  }
}

// Lines of text (text nodes only, so icons and element boxes are not counted).
const MEASURE = `(frame, win, doc) => {
  const textLines = (el) => { const tops = new Set(); const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT); while (walker.nextNode()) { const node = walker.currentNode; if (!node.textContent.trim()) continue; const range = doc.createRange(); range.selectNodeContents(node); for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top)); } return [...tops]; };
  const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
  return {
    pageOverflow: doc.scrollingElement.scrollWidth > win.innerWidth,
    rows: [...doc.querySelectorAll("[data-correction-title]")].map((title) => {
      const holder = title.parentElement;
      const change = holder.querySelector("[data-correction-change]");
      const when = holder.querySelector("[data-correction-when]");
      return {
        title: title.textContent, titleLines: textLines(title).length, titleBox: box(title),
        change: change.textContent, changeBox: box(change), whenBox: box(when), whenText: when.textContent,
        amounts: [...change.children].map((part) => ({ text: part.textContent, lines: textLines(part).length, right: part.getBoundingClientRect().right })),
        changeLines: textLines(change).length, holderRight: holder.getBoundingClientRect().right
      };
    })
  };
}`;

test("Balance corrected at 340, 360 and 393px on 29, 43 and 73: title alone, amounts on the next line, then date and reason", { skip }, async () => {
  const pages = [];
  for (const [previous, next] of CASES) {
    const rows = [correction(previous, next)];
    pages.push({ name: `29|${previous}`, html: await detailHtml(false, rows) });
    pages.push({ name: `43|${previous}`, html: await detailHtml(true, rows) });
    pages.push({ name: `73|${previous}`, html: await recordHtml(rows) });
  }
  const results = measureInFrames({ pages, css: await appCss(), widths: [340, 360, 393], height: 2000, measure: MEASURE });
  assert.equal(results.length, pages.length * 3);
  for (const result of results) {
    const where = `${result.page} at ${result.width}px`;
    const example = result.page.endsWith("|123450");
    assert.equal(result.innerWidth, result.width, `${where}: the frame is that wide`);
    assert.equal(result.pageOverflow, false, `${where}: no sideways scroll`);
    assert.equal(result.rows.length, 1, `${where}: one correction row`);
    const [row] = result.rows;
    assert.equal(row.title, "Balance corrected");
    assert.equal(row.titleLines, 1, `${where}: "Balance corrected" is one line`);
    assert.ok(row.changeBox.top >= row.titleBox.bottom - 0.5, `${where}: old → new is on the line after the title`);
    assert.ok(row.whenBox.top >= row.changeBox.bottom - 0.5, `${where}: the date and reason come after old → new`);
    assert.match(row.whenText, /^\d{2}\/\d{2}\/\d{4} 16:40 · Reason: Wrong amount typed$/);
    for (const amount of row.amounts) {
      assert.equal(amount.lines, 1, `${where}: "${amount.text}" is never broken`);
      assert.ok(amount.right <= row.holderRight + 0.5, `${where}: "${amount.text}" stays inside the row`);
    }
    if (example) {
      assert.equal(row.change, "GH₵1,234.50 → GH₵1,200.00");
      assert.equal(row.changeLines, 1, `${where}: GH₵1,234.50 → GH₵1,200.00 is one line`);
    }
  }
});
