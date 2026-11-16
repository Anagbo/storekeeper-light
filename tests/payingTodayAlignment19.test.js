import assert from "node:assert/strict";
import { test } from "node:test";
import { appCss, browser, measureInFrames, toHtml } from "./helpers/browserLayout.js";
import { loadJsx, render } from "./helpers/renderJsx.js";

// Wiring 19 "Paying today alignment" (decided 16 Nov 2026, found on a real phone): in the Paying today
// panel every amount shares one right edge: Cash, MoMo, Total today and the Still owed row. Total today
// uses the same inner padding as the Cash and MoMo rows, so GH₵6.00 ends exactly under GH₵4.00 and
// GH₵2.00. Measured in a real browser at 340, 360 and 393px, for all three panels on 19.

const WIDTHS = [340, 360, 393];
const customer = { name: "Kofi Mensah", totalDebtPesewas: 0 };

async function page19(params) {
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx");
  const view = render({ type: CreditScreens, props: { route: "ALittleAtATime", params: { amountPesewas: 1200, customer, installmentAmount: "4.00", ...params }, onBack() {}, onNavigate() {}, onUpdateParams() {}, onReturnToSplit() {}, onSaveCredit: async () => {} } });
  return toHtml(view.tree);
}

test("19 Paying today: every amount ends on one right edge at 340, 360 and 393px", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)" }, async () => {
  const pages = [
    // Cash only (one row), then Total today and Still owed.
    { name: "one method", html: await page19({ startToday: true, paymentMethod: "cash", todayPaymentAmount: "2.00" }), amounts: 3 },
    // Parts back from 27: Cash GH₵4.00 + MoMo GH₵2.00 = Total today GH₵6.00, then Still owed.
    { name: "split from 27", html: await page19({ startToday: true, paymentMethod: "split", splitTotalPesewas: 600, splitParts: [{ paymentMethod: "cash", amountPesewas: 400 }, { paymentMethod: "momo", amountPesewas: 200, momoMethod: "direct" }] }), amounts: 4 },
    // A split sale (16) paid part today: the panel on 19 lists those parts.
    { name: "paid on 16", html: await page19({ flow: "split", paymentAlreadyMadeToday: true, initialPaymentPesewas: 600, splitParts: [{ paymentMethod: "cash", amountPesewas: 400 }, { paymentMethod: "momo", amountPesewas: 200 }, { paymentMethod: "owe", amountPesewas: 600 }] }), amounts: 4 }
  ];
  const results = measureInFrames({
    pages,
    css: await appCss(),
    widths: WIDTHS,
    height: 1400,
    measure: `(frame, win, doc) => {
      const panel = doc.querySelector('[data-paying-today]');
      const amounts = panel ? [...panel.querySelectorAll('[data-paying-today-amount]')] : [];
      return {
        viewport: win.innerWidth,
        pageOverflow: doc.scrollingElement.scrollWidth > win.innerWidth,
        amounts: amounts.map((el) => ({ text: el.textContent, right: el.getBoundingClientRect().right, numeric: getComputedStyle(el).fontVariantNumeric }))
      };
    }`
  });
  assert.equal(results.length, pages.length * WIDTHS.length);
  for (const result of results) {
    const where = `${result.page} at ${result.width}px`;
    const expected = pages.find((page) => page.name === result.page).amounts;
    assert.equal(result.viewport, result.width, where);
    assert.equal(result.pageOverflow, false, `${where}: no horizontal scroll`);
    assert.equal(result.amounts.length, expected, `${where}: ${result.amounts.map((a) => a.text).join(", ")}`);
    const edge = result.amounts[0].right;
    for (const amount of result.amounts) {
      assert.ok(Math.abs(amount.right - edge) <= 0.5, `${where}: ${amount.text} ends at ${amount.right}, the first amount at ${edge}`);
    }
    for (const amount of result.amounts) assert.match(amount.numeric, /tabular-nums/, `${where}: ${amount.text} uses equal-width digits`);
  }
});
