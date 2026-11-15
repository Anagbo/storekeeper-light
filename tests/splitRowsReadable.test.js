import assert from "node:assert/strict";
import { test } from "node:test";
import { loadJsx, render, walk, textOf } from "./helpers/renderJsx.js";

// Cleanup batch, commit 2 (c): the Owe row (and a verified MoMo row) on the split screens are
// read-only, not unavailable. They are not editable by typing, but they carry what the merchant
// must read (the person, the terms, the first payment date), so they keep the same text colour as
// Cash and MoMo. Only a saving screen (busy) dims every row.

const OWE_DETAIL = "Ama · GH₵1.00 every week · First payment 07/03/2099";
const parts = [
  { paymentMethod: "cash", amountPesewas: 200 },
  { paymentMethod: "momo", amountPesewas: 400, momoMethod: "paystack", verification: "verified", confirmedPesewas: 400 },
  { paymentMethod: "owe", amountPesewas: 200 }
];

async function rows({ busy = false } = {}) {
  const { default: SplitPayment } = await loadJsx("src/pos/SplitPayment.jsx");
  const view = render({ type: SplitPayment, props: {
    totalPesewas: 800, totalLabel: "Total", doneLabel: "Done", allowOwe: true, busy, onBack() {}, onDone() {},
    initialParts: parts, partDetail: (part) => (part.paymentMethod === "owe" ? OWE_DETAIL : "")
  } });
  // The row's name element: a button on an editable row, plain text on a read-only one (wiring 16:
  // Owe and a locked MoMo row are not tappable).
  const label = (name) => [...walk(view.tree)].find((node) => (node.type === "button" || node.type === "div") && textOf(node).startsWith(name) && /text-lg/.test(node.props?.className ?? ""));
  return { cash: label("Cash"), momo: label("MoMo"), owe: label("Owe"), view };
}

test("the Owe row and a verified MoMo row are not dimmed; they stay read-only", async () => {
  const { cash, momo, owe, view } = await rows();
  assert.ok(cash && momo && owe);
  assert.equal(cash.type, "button");
  assert.equal(cash.props.disabled, false);
  assert.equal(owe.type, "div", "Owe is still never typed: not a button");
  assert.equal(momo.type, "div", "a verified row is still never edited: not a button");
  for (const [name, button] of Object.entries({ cash, momo, owe })) {
    assert.doesNotMatch(button.props.className, /opacity/, `${name} row text is not dimmed`);
  }
  assert.equal(owe.props.className, cash.props.className, "same classes as the Cash row, so the same text colour");
  // Wiring 16 row layout (12 Nov 2026): the terms are on the row's own status line, not in the name.
  const oweRow = [...walk(view.tree)].find((node) => node.props?.["data-split-row"] === "owe");
  const status = [...walk(oweRow)].find((node) => node.props?.["data-row-status"] !== undefined);
  assert.equal(textOf(status), OWE_DETAIL);
  assert.doesNotMatch(status.props.className, /opacity/);
});

test("a saving screen still dims every row", async () => {
  const { cash, momo, owe } = await rows({ busy: true });
  for (const button of [cash, momo, owe]) assert.match(button.props.className, /opacity-50/);
});

// Contrast (WCAG 2.x) of the row's real colours on its white background (bg-white row,
// text-slate-950 from the page, text-slate-700 for the detail line).
const hex = (value) => [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16));
const channel = (value) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const onWhite = (value) => contrast(hex(value), [255, 255, 255]);
const atHalfOpacity = (value) => contrast(hex(value).map((c) => Math.round(c * 0.5 + 255 * 0.5)), [255, 255, 255]);

test("contrast: the row text and its detail line pass 4.5:1; the old 50% dimming did not", () => {
  const SLATE_950 = "#020617";
  const SLATE_700 = "#334155";
  assert.ok(onWhite(SLATE_950) >= 4.5, `name ${onWhite(SLATE_950).toFixed(2)}`);
  assert.ok(onWhite(SLATE_700) >= 4.5, `detail ${onWhite(SLATE_700).toFixed(2)}`);
  assert.ok(atHalfOpacity(SLATE_950) < 4.5, `the old dimmed name was ${atHalfOpacity(SLATE_950).toFixed(2)}:1`);
  assert.ok(atHalfOpacity(SLATE_700) < 3, `the old dimmed detail was ${atHalfOpacity(SLATE_700).toFixed(2)}:1`);
});

test("the detail line keeps text-slate-700 and the page keeps text-slate-950 (the colours checked above)", async () => {
  const { readFileSync } = await import("node:fs");
  const split = readFileSync(new URL("../src/pos/SplitPayment.jsx", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/pos/PosApp.jsx", import.meta.url), "utf8");
  assert.match(split, /"font-semibold text-slate-700"/);
  assert.match(app, /pos-app [^"]*text-slate-950/);
});
