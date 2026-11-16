import assert from "node:assert/strict";
import { test } from "node:test";
import { appCss, browser, measureInFrames, toHtml } from "./helpers/browserLayout.js";
import { loadJsx, render, setLiveQuery } from "./helpers/renderJsx.js";

// The add-debt flow (53 > 18/19 > Debt saved): the Payment recorded panel with its total line follows
// the same rule as 19 "Paying today alignment" (16 Nov 2026). Every amount, the Cash and MoMo rows and
// the Total line, ends on one right edge at 340, 360 and 393px (it was 12px off, like 19).

const WIDTHS = [340, 360, 393];

test("Debt saved (add-debt flow): Payment recorded amounts end on one right edge at 340, 360 and 393px", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)" }, async () => {
  const { ManualDebtSaved } = await loadJsx("src/pos/ManualDebtScreens.jsx");
  const page = (params) => {
    setLiveQuery(() => 0);
    try {
      return toHtml(render({ type: ManualDebtSaved, props: { params: { customer: { name: "Kofi Mensah" }, amountPesewas: 1200, ...params }, onDone() {}, onNavigate() {}, shopName: "My shop" } }).tree);
    } finally {
      setLiveQuery(null);
    }
  };
  const pages = [
    { name: "split", html: page({ initialPaymentPesewas: 600, initialPaymentParts: [{ paymentMethod: "cash", amountPesewas: 400 }, { paymentMethod: "momo", amountPesewas: 200 }] }), amounts: 3 },
    { name: "cash only", html: page({ initialPaymentPesewas: 200 }), amounts: 2 }
  ];
  const results = measureInFrames({
    pages,
    css: await appCss(),
    widths: WIDTHS,
    height: 1200,
    measure: `(frame, win, doc) => {
      const panel = doc.querySelector('[data-paying-today]');
      return {
        viewport: win.innerWidth,
        pageOverflow: doc.scrollingElement.scrollWidth > win.innerWidth,
        amounts: panel ? [...panel.querySelectorAll('[data-paying-today-amount]')].map((el) => ({ text: el.textContent, right: el.getBoundingClientRect().right })) : []
      };
    }`
  });
  for (const result of results) {
    const where = `${result.page} at ${result.width}px`;
    assert.equal(result.viewport, result.width, where);
    assert.equal(result.pageOverflow, false, `${where}: no horizontal scroll`);
    assert.equal(result.amounts.length, pages.find((p) => p.name === result.page).amounts, where);
    const edge = result.amounts[0].right;
    for (const amount of result.amounts) assert.ok(Math.abs(amount.right - edge) <= 0.5, `${where}: ${amount.text} ends at ${amount.right}, the first amount at ${edge}`);
  }
});
