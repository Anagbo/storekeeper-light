import assert from "node:assert/strict";
import { test } from "node:test";
import { appCss, browser, measureInFrames, toHtml } from "./helpers/browserLayout.js";
import { loadJsx, render, setLiveQuery } from "./helpers/renderJsx.js";

// Wiring 22 and 33 "Hide amounts" at 340, 360 and 393px (real browser): the eye is a 48px square on
// the title row (beside "Money left today" on 22, beside "My money" on 33), the title stays on one
// line, nothing scrolls sideways, and the hidden figures are one line and never clipped.

const skip = browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)";
const BIG = 98_765_432_10;

async function homeHtml(hideAmounts) {
  const { default: Home } = await loadJsx("src/pos/Home.jsx");
  setLiveQuery(() => ({
    hideAmounts,
    totals: { cashLeft: BIG, moneyIn: BIG, moneySpent: BIG },
    debtPesewas: BIG,
    urgentDebt: { debtId: "d1", customerName: "Nana Akosua Frimpomaa", amountPesewas: 1234500, dueDate: "2020-01-01", phone: "0244123456" },
    owed: { people: 3, late: 1 }
  }));
  try {
    return toHtml(render({ type: Home, props: { onNavigate() {} } }).tree);
  } finally {
    setLiveQuery(null);
  }
}

async function myMoneyHtml(hideAmounts) {
  const { default: MyMoney } = await loadJsx("src/pos/MyMoney.jsx");
  const summary = Object.fromEntries(["moneyIn", "cashIn", "momoIn", "collectedIn", "givenOnCredit", "moneySpent", "spentCash", "spentMomo", "spentUnrecorded", "cashShouldHave", "momoShouldHave", "moneyLeft", "sales", "stockBought", "otherCosts", "profit"].map((name) => [name, BIG]));
  setLiveQuery(() => ({ hideAmounts, summary, showProfit: true, averageProfitPesewas: BIG, debtPesewas: BIG, supplierBalancePesewas: BIG, uncounted: { sales: 0, other: 0 } }));
  try {
    return toHtml(render({ type: MyMoney, props: { onNavigate() {} } }).tree);
  } finally {
    setLiveQuery(null);
  }
}

const MEASURE = `(frame, win, doc) => {
  const lines = (el) => { const range = doc.createRange(); range.selectNodeContents(el); return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size; };
  const eye = doc.querySelector('[data-hide-amounts]');
  const box = eye.getBoundingClientRect();
  const title = doc.querySelector('h1') || [...doc.querySelectorAll('section[aria-label="Money left today"] p')][0];
  const titleBox = title.getBoundingClientRect();
  return {
    eye: { width: box.width, height: box.height, centre: box.top + box.height / 2, right: box.right, name: eye.getAttribute('aria-label') },
    title: { text: title.textContent, lines: lines(title), centre: titleBox.top + titleBox.height / 2 },
    hidden: [...doc.querySelectorAll('[data-hidden-amount]')].map((el) => ({ lines: lines(el), width: el.getBoundingClientRect().width, fontSize: win.getComputedStyle(el).fontSize, clipped: el.parentElement.scrollWidth > el.parentElement.clientWidth + 0.5 })),
    pageOverflow: doc.scrollingElement.scrollWidth > win.innerWidth
  };
}`;

for (const [screen, html, title, count] of [["22", homeHtml, "Money left today", 5], ["33", myMoneyHtml, "My money", null]]) {
  test(`${screen} at 340, 360 and 393px: the eye is 48px on the title row, in both states, with nothing wrapping or clipped`, { skip }, async () => {
    const results = measureInFrames({
      pages: [{ name: "shown", html: await html(false) }, { name: "hidden", html: await html(true) }],
      css: await appCss(),
      widths: [340, 360, 393],
      measure: MEASURE
    });
    assert.equal(results.length, 6);
    for (const result of results) {
      const where = `${screen} ${result.page} at ${result.width}px`;
      assert.equal(result.pageOverflow, false, `${where}: no sideways scroll`);
      assert.equal(result.eye.width, 48, `${where}: eye 48px wide`);
      assert.equal(result.eye.height, 48, `${where}: eye 48px high`);
      assert.ok(result.eye.right <= result.width, `${where}: eye inside the screen`);
      assert.equal(result.eye.name, result.page === "hidden" ? "Show amounts" : "Hide amounts");
      assert.equal(result.title.text, title);
      assert.equal(result.title.lines, 1, `${where}: the title stays on one line`);
      assert.ok(Math.abs(result.eye.centre - result.title.centre) < 6, `${where}: the eye is on the title's row`);
      if (result.page === "shown") {
        assert.equal(result.hidden.length, 0, `${where}: nothing hidden`);
        continue;
      }
      if (count) assert.equal(result.hidden.length, count, where);
      assert.ok(result.hidden.length > 0, where);
      for (const figure of result.hidden) {
        assert.equal(figure.lines, 1, `${where}: GH₵ •••• on one line`);
        assert.equal(figure.clipped, false, `${where}: GH₵ •••• not clipped`);
      }
    }
  });
}
