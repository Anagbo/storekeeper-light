import assert from "node:assert/strict";
import { test } from "node:test";
import { appCss, browser, measureInFrames, toHtml } from "./helpers/browserLayout.js";
import { loadJsx, render } from "./helpers/renderJsx.js";

// 34 New person in a real browser at 340, 360 and 393px (wiring 34 "No amount field on 34", 15 Nov
// 2026), both flows: no horizontal scroll, only Name, Phone number and Ghana Card number, buttons at
// least 44px. Sale on credit: "Owes from this sale:" and the amount on one row (label left, amount
// right, no wrapping), the box 56 to 64px tall, the amount about 28px and smaller only when a long
// amount needs it. Add debt: no amount line at all.

const WIDTHS = [340, 360, 393];
const FIELDS = ["e.g. Kofi Mensah", "024 000 0000", "GHA-000000000-0"];

async function page34(params) {
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx");
  const view = render({ type: CreditScreens, props: { route: "NewPerson", params: { newPersonName: "Kofi Mensah-Asamoah", newPersonPhone: "0241112223", newPersonGhanaCard: "GHA-123456789-0", ...params }, onBack() {}, onNavigate() {}, onUpdateParams() {} } });
  return toHtml(view.tree);
}

test("34 at 340, 360 and 393px in both flows", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)" }, async () => {
  const pages = [
    { name: "add debt", html: await page34({ manualDebt: true, flow: "add_debt" }), amount: null },
    { name: "sale", html: await page34({ amountPesewas: 800 }), amount: "GH₵8.00" },
    { name: "sale part paid", html: await page34({ amountPesewas: 1334567, initialPaymentPesewas: 100000 }), amount: "GH₵12,345.67" },
    { name: "sale large", html: await page34({ amountPesewas: 12345678 }), amount: "GH₵123,456.78" }
  ];
  const results = measureInFrames({
    pages,
    css: await appCss(),
    widths: WIDTHS,
    height: 1000,
    measure: `(frame, win, doc) => {
      const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height }; };
      const line = doc.querySelector('[data-owes-from-sale]');
      const label = line && line.querySelector('span');
      const amount = line && line.querySelector('strong');
      return {
        viewport: win.innerWidth,
        pageOverflow: doc.scrollingElement.scrollWidth > win.innerWidth,
        text: doc.body.textContent,
        inputs: [...doc.querySelectorAll('input')].map((el) => ({ placeholder: el.placeholder, ...box(el) })),
        buttons: [...doc.querySelectorAll('button')].map((el) => ({ text: el.textContent.trim(), ...box(el), clipped: el.scrollWidth > el.clientWidth + 1 })),
        line: line ? {
          ...box(line),
          text: line.textContent.trim(),
          bg: getComputedStyle(line).backgroundColor,
          label: { ...box(label), lineHeight: parseFloat(getComputedStyle(label).lineHeight), clipped: label.scrollWidth > label.clientWidth + 1 },
          amount: { ...box(amount), text: amount.textContent, fontSize: parseFloat(getComputedStyle(amount).fontSize), lineHeight: parseFloat(getComputedStyle(amount).lineHeight), color: getComputedStyle(amount).color, clipped: amount.scrollWidth > amount.clientWidth + 1 }
        } : null
      };
    }`
  });
  assert.equal(results.length, pages.length * WIDTHS.length);
  for (const result of results) {
    const where = `${result.page} at ${result.width}px`;
    const expectedAmount = pages.find((page) => page.name === result.page).amount;
    assert.equal(result.viewport, result.width, where);
    assert.equal(result.pageOverflow, false, `${where}: no horizontal scroll`);
    assert.deepEqual(result.inputs.map((input) => input.placeholder), FIELDS, `${where}: only the three person fields`);
    for (const input of result.inputs) assert.ok(input.left >= 0 && input.right <= result.viewport, `${where}: ${input.placeholder} inside the screen`);
    assert.ok(result.buttons.length >= 2, `${where}: Back and Next`);
    for (const button of result.buttons) {
      assert.ok(button.height >= 44, `${where}: ${button.text} is at least 44px (${button.height})`);
      assert.ok(button.left >= 0 && button.right <= result.viewport, `${where}: ${button.text} inside the screen`);
      assert.equal(button.clipped, false, `${where}: ${button.text} not clipped`);
    }
    assert.doesNotMatch(result.text, /Amount owed|enter the amount next/, where);

    if (expectedAmount === null) {
      assert.equal(result.line, null, `${where}: no amount line`);
      assert.doesNotMatch(result.text, /Owes from this sale/, where);
      continue;
    }
    const { line } = result;
    const { label, amount } = line;
    assert.equal(line.text.replace(/\s+/g, " "), `Owes from this sale: ${expectedAmount}`, where);
    assert.equal(amount.text, expectedAmount, where);
    assert.notEqual(line.bg, "rgba(0, 0, 0, 0)", `${where}: pink background`);
    assert.ok(line.left >= 0 && line.right <= result.viewport, `${where}: the line inside the screen`);
    assert.ok(line.height >= 56 && line.height <= 64, `${where}: the box is 56 to 64px tall (${line.height})`);
    // One row: label and amount each on a single line, side by side, amount on the right.
    assert.ok(label.height <= label.lineHeight + 1, `${where}: the label does not wrap (${label.height})`);
    assert.ok(amount.height <= amount.lineHeight + 1, `${where}: the amount does not wrap (${amount.height})`);
    assert.ok(amount.left >= label.right, `${where}: the amount is right of the label`);
    assert.ok(amount.top < label.bottom && label.top < amount.bottom, `${where}: label and amount on the same row`);
    assert.ok(Math.abs(amount.right - (line.right - 12)) <= 1, `${where}: the amount sits at the right edge`);
    assert.equal(amount.clipped, false, `${where}: the amount is not cut off (${amount.fontSize}px)`);
    assert.equal(label.clipped, false, `${where}: the label is not cut off`);
    assert.ok(amount.fontSize <= 28, `${where}: the amount is at most 28px (${amount.fontSize})`);
    if (expectedAmount === "GH₵8.00") assert.ok(amount.fontSize >= 26, `${where}: a short amount is about 28px (${amount.fontSize})`);
    if (result.width >= 360 && expectedAmount === "GH₵8.00") assert.equal(amount.fontSize, 28, `${where}: full size`);
    assert.ok(amount.fontSize >= 12, `${where}: the amount stays readable (${amount.fontSize})`);
  }
});
