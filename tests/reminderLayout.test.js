import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { appCss, browser, measureInFrames, toHtml } from "./helpers/browserLayout.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// A7: the Last reminder line on 29 and 43 and the Send another reminder? sheet in a real browser at
// 340, 360 and 393px: no wrapping or clipping, nothing overlaps, no button hidden off screen.

const WIDTHS = [340, 360, 393];
const LONG_NAME = "Akosua Mensah-Boateng";
const dayOffset = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const freshTap = () => ({ preventDefault() {} });

async function detail({ late, phone, lastReminderAt, env = {} }) {
  const { DebtorDetail } = await loadJsx("src/pos/DebtCollection.jsx", env);
  const debt = { id: "d1", customerId: "c1", customerName: LONG_NAME, amountPesewas: 1234500, status: "unpaid", isInstallmentPlan: false, dueDate: dayOffset(late ? -3 : 7) };
  const data = { name: LONG_NAME, customerId: "c1", phone, ghanaCardNumber: "", balancePesewas: 1234500, debt, unpaidDebts: [debt], unpaidDebtCount: 1, lastReminderAt, history: [] };
  setLiveQuery(([debtId]) => (debtId === "d1" ? data : undefined));
  const view = render({ type: DebtorDetail, props: { params: { debtId: "d1", customerName: LONG_NAME }, onBack() {}, onNavigate() {}, onCollect() {}, shopName: "My shop" } });
  return view;
}

// The longest form of the line: an older date with a time.
const OLDER = new Date(2026, 10, 3, 23, 58).getTime();
const RECENT_OLDER_DAY = () => { const d = new Date(); d.setDate(d.getDate() - 5); d.setHours(23, 58, 0, 0); return d.getTime(); };

// The Last reminder row (Key-value rows, 16 Nov 2026): the whole row (label and value) is measured. No
// reminder yet: no row at all.
const LINE_MEASURE = `(frame, win, doc) => {
  const value = doc.querySelector("[data-last-reminder]");
  if (!value) return { none: true, text: doc.body.textContent, pageOverflow: doc.scrollingElement.scrollWidth > win.innerWidth };
  const line = value.closest('[data-row="last-reminder"]');
  const row = doc.querySelector('[data-row="debtor-actions"]');
  const correct = [...doc.querySelectorAll("button")].find((el) => el.textContent.trim() === "Correct balance");
  const r = line.getBoundingClientRect();
  const lineHeight = parseFloat(win.getComputedStyle(line).lineHeight);
  return {
    fontSize: parseFloat(win.getComputedStyle(line).fontSize), align: win.getComputedStyle(line).textAlign,
    valueWeight: win.getComputedStyle(value).fontWeight, pageWidth: win.innerWidth,
    buttonBottom: (() => { const b = [...doc.querySelectorAll("button")].find((el) => /Send reminder on WhatsApp/.test(el.textContent)); return b ? b.getBoundingClientRect().bottom : null; })(),
    text: line.textContent, top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, lineHeight,
    rowBottom: row.getBoundingClientRect().bottom,
    correctTop: correct ? correct.getBoundingClientRect().top : null,
    overflowX: line.scrollWidth > line.clientWidth + 0.5,
    pageOverflow: doc.scrollingElement.scrollWidth > win.innerWidth
  };
}`;

const SHEET_MEASURE = `(frame, win, doc) => {
  const dialog = doc.querySelector('[role="dialog"][aria-labelledby="reminder-again-title"]');
  const rect = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width }; };
  const find = (label) => [...dialog.querySelectorAll("a, button")].find((el) => el.textContent.trim() === label);
  // Lines of text actually laid out (the buttons are taller than one line on purpose).
  const textLines = (el) => { const range = doc.createRange(); range.selectNodeContents(el); return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size; };
  const one = (el) => ({ ...rect(el), lines: textLines(el), overflowX: el.scrollWidth > el.clientWidth + 0.5 });
  const title = doc.getElementById("reminder-again-title");
  const text = doc.getElementById("reminder-again-text");
  const sendAgain = find("Send again");
  const notNow = find("Not now");
  const tr = title.getBoundingClientRect();
  return {
    innerHeight: win.innerHeight,
    dialog: rect(dialog),
    title: { ...rect(title), lines: Math.round(tr.height / parseFloat(win.getComputedStyle(title).lineHeight)) },
    text: { ...rect(text), overflowX: text.scrollWidth > text.clientWidth + 0.5 },
    sendAgain: one(sendAgain),
    notNow: one(notNow),
    sendAgainBg: win.getComputedStyle(sendAgain).backgroundColor,
    notNowBg: win.getComputedStyle(notNow).backgroundColor,
    pageOverflow: doc.scrollingElement.scrollWidth > win.innerWidth
  };
}`;

test("29 and 43 at 340, 360 and 393px: the Last reminder row fits on one line between the actions and Correct balance; no row without a reminder", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)" }, async () => {
  const pages = [];
  for (const late of [false, true]) {
    for (const [label, at] of [["date", OLDER], ["none", 0], ["yesterday", Date.now() - 24 * 3600 * 1000]]) {
      for (const env of [{}, { VITE_ENABLE_POS_RECEIPTS: "true" }]) {
        const view = await detail({ late, phone: "+233241234567", lastReminderAt: at, env });
        pages.push({ name: `${late ? 43 : 29}|${label}|${env.VITE_ENABLE_POS_RECEIPTS ? "receipts" : "plain"}`, html: toHtml(view.tree) });
      }
    }
  }
  setLiveQuery(null);
  const results = measureInFrames({ pages, css: await appCss(), widths: WIDTHS, height: 1400, measure: LINE_MEASURE });
  if (process.env.LAYOUT_DUMP) console.log(JSON.stringify(results, null, 1));
  assert.equal(results.length, pages.length * WIDTHS.length);
  for (const result of results) {
    const where = `${result.page} at ${result.width}px`;
    assert.equal(result.innerWidth, result.width, `${where}: frame width`);
    assert.equal(result.pageOverflow, false, `${where}: no horizontal page scroll`);
    if (result.page.includes("|none|")) {
      assert.equal(result.none, true, `${where}: no reminder, no row`);
      assert.doesNotMatch(result.text, /Last reminder|No reminder sent yet/, `${where}: no reminder text`);
      continue;
    }
    assert.equal(result.fontSize, 15, `${where}: 15px`);
    assert.equal(result.align, "center", `${where}: centred`);
    assert.ok(Number(result.valueWeight) >= 700, `${where}: the value is bold`);
    if (result.page.startsWith("43")) assert.ok(result.buttonBottom !== null && Math.abs(result.top - result.buttonBottom - 8) <= 1.5, `${where}: 8px under the WhatsApp reminder button`);
    assert.equal(result.overflowX, false, `${where}: the line is not clipped`);
    assert.ok(result.height <= result.lineHeight * 1.5, `${where}: one line (${result.height}px for a ${result.lineHeight}px line): "${result.text}"`);
    if (result.page.startsWith("29")) assert.ok(result.top >= result.rowBottom - 0.5, `${where}: under the action buttons`);
    assert.ok(result.correctTop !== null && result.bottom <= result.correctTop + 0.5, `${where}: above Correct balance, not overlapping it`);
  }
});

test("Send another reminder? at 340, 360 and 393px: text wraps inside the sheet, both buttons on screen, one line each, no overlap", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)" }, async () => {
  const pages = [];
  for (const late of [false, true]) {
    const view = await detail({ late, phone: "+233241234567", lastReminderAt: RECENT_OLDER_DAY() });
    const button = [...walk(view.tree)].find((node) => node.type === "button" && (late ? textOf(node).includes("Send reminder on WhatsApp") : node.props["aria-label"] === `WhatsApp reminder for ${LONG_NAME}`));
    button.props.onClick(freshTap());
    view.rerender();
    assert.ok([...walk(view.tree)].some((node) => node.props?.["data-reminder-again"] !== undefined), "the sheet opened");
    pages.push({ name: `${late ? 43 : 29}|sheet`, html: toHtml(view.tree) });
  }
  setLiveQuery(null);
  // 640px tall: a small phone with the browser bars showing.
  const results = measureInFrames({ pages, css: await appCss(), widths: WIDTHS, height: 640, measure: SHEET_MEASURE });
  if (process.env.LAYOUT_DUMP) console.log(JSON.stringify(results, null, 1));
  for (const result of results) {
    const where = `${result.page} at ${result.width}px`;
    assert.equal(result.pageOverflow, false, `${where}: no horizontal page scroll`);
    for (const part of ["dialog", "title", "text", "sendAgain", "notNow"]) {
      const box = result[part];
      assert.ok(box.left >= -0.5 && box.right <= result.width + 0.5, `${where}: ${part} inside the screen width`);
      assert.ok(box.top >= -0.5 && box.bottom <= result.innerHeight + 0.5, `${where}: ${part} visible (top ${box.top}, bottom ${box.bottom} of ${result.innerHeight})`);
    }
    assert.ok(Math.abs(result.dialog.bottom - result.innerHeight) < 1, `${where}: a bottom sheet on a phone`);
    assert.equal(result.text.overflowX, false, `${where}: the message wraps, never clipped`);
    for (const name of ["sendAgain", "notNow"]) {
      assert.equal(result[name].lines, 1, `${where}: ${name} label on one line`);
      assert.equal(result[name].overflowX, false, `${where}: ${name} label not clipped`);
      assert.ok(result[name].height >= 48, `${where}: ${name} is ${result[name].height}px tall`);
    }
    assert.ok(result.sendAgain.bottom <= result.notNow.top + 0.5, `${where}: Send again above Not now, no overlap`);
    assert.ok(result.text.bottom <= result.sendAgain.top + 0.5, `${where}: the message does not run into the buttons`);
    assert.notEqual(result.sendAgainBg, result.notNowBg, `${where}: Send again is the strong one`);
  }
});
