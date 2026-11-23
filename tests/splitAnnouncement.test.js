import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const split = readFileSync(new URL("../src/pos/SplitPayment.jsx", import.meta.url), "utf8");
// The Left to pay bar: its opening tag (found from its unique class text) to the end of its amount.
const classAt = split.indexOf("rounded-[18px] border-[3px] border-amber-700 bg-amber-100 px-4 py-3");
const barStart = split.lastIndexOf("<div", classAt);
const bar = split.slice(barStart, split.indexOf("{leftPesewas > 0 && !draft"));

test("rule 12: a change to Left to pay is announced to screen readers", () => {
  assert.ok(bar.length > 0, "Left to pay bar not found");
  assert.match(bar, /role="status"/);
  assert.match(bar, /aria-live="polite"/);
  assert.match(bar, /aria-atomic="true"/);
});

test("rule 12: the announced text is the label and the amount together", () => {
  // aria-atomic reads the whole bar, so "Left to pay GH₵5.00" is spoken, not just the number.
  assert.match(bar, /t\("split\.leftToPay"\)/);
  assert.match(bar, /formatGhs\(leftPesewas\)/);
});

test("rule 12: the bar is shown only while something is left (23 Nov 2026)", () => {
  // Wrapped in `leftPesewas > 0`: the row is not rendered at all when nothing is left.
  const before = split.slice(0, barStart).trimEnd();
  assert.ok(before.endsWith("{leftPesewas > 0 && ("), "the bar is inside a leftPesewas > 0 check");
});

test("rule 12: Done drops aria-disabled when it enables", () => {
  assert.match(split, /aria-disabled=\{busy \|\| leftPesewas !== 0 \|\| parts\.length === 0 \|\| !partsValid \? "true" : undefined\}/);
});