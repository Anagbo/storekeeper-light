import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as splitTender from "../src/pos/splitTender.js";
import { posText } from "../src/pos/i18n.js";

const split = readFileSync(new URL("../src/pos/SplitPayment.jsx", import.meta.url), "utf8");
const tile = (method) => ({ paymentMethod: method });

test("K1: one tap on Cash puts the whole Left to pay into the Cash row", () => {
  const { addRemainingToPart } = splitTender;
  assert.equal(typeof addRemainingToPart, "function");
  assert.deepEqual(addRemainingToPart([], "cash", 1300), [{ paymentMethod: "cash", amountPesewas: 1300 }]);
  assert.deepEqual(
    addRemainingToPart([{ paymentMethod: "momo", amountPesewas: 300, momoMethod: "direct" }], "cash", 1300),
    [{ paymentMethod: "momo", amountPesewas: 300, momoMethod: "direct" }, { paymentMethod: "cash", amountPesewas: 1000 }]
  );
});

test("K1: a second quick tap changes nothing, because nothing is left to pay", () => {
  const { addRemainingToPart } = splitTender;
  const once = addRemainingToPart([], "cash", 1300);
  assert.deepEqual(addRemainingToPart(once, "cash", 1300), once);
  assert.deepEqual(addRemainingToPart(once, "momo", 1300), once);
});

test("K1: with a Cash row already there, tapping Cash adds the rest to the same row (one row per mode)", () => {
  const { addRemainingToPart } = splitTender;
  const result = addRemainingToPart([{ paymentMethod: "cash", amountPesewas: 500 }], "cash", 1300);
  assert.deepEqual(result, [{ paymentMethod: "cash", amountPesewas: 1300 }]);
});

test("K1: tapping the amount edits it; the new amount replaces the old one and keeps the MoMo method", () => {
  const { setPartAmount } = splitTender;
  assert.equal(typeof setPartAmount, "function");
  const parts = [{ paymentMethod: "cash", amountPesewas: 500 }, { paymentMethod: "momo", amountPesewas: 300, momoMethod: "direct", verification: "merchant_confirmed" }];
  assert.deepEqual(setPartAmount(parts, "momo", 400, 1300), [
    { paymentMethod: "cash", amountPesewas: 500 },
    { paymentMethod: "momo", amountPesewas: 400, momoMethod: "direct", verification: "merchant_confirmed" }
  ]);
  // Can use what is left plus the row's own amount: 1300 - 500 = 800 for MoMo.
  assert.equal(setPartAmount(parts, "momo", 800, 1300)[1].amountPesewas, 800);
});

test("K1: an edit above the total, at zero, or not a whole number is refused", () => {
  const { setPartAmount } = splitTender;
  const parts = [{ paymentMethod: "cash", amountPesewas: 500 }, { paymentMethod: "momo", amountPesewas: 300 }];
  for (const bad of [801, 0, -5, 10.5, NaN, null]) assert.equal(setPartAmount(parts, "momo", bad, 1300), null, String(bad));
  assert.equal(setPartAmount(parts, "owe", 100, 1300), null, "Owe is never typed");
  assert.equal(setPartAmount(parts, "cash", 100, 1300).length, 2);
});

test("K1: the Cash and MoMo tiles no longer open an amount editor", () => {
  const tiles = split.slice(split.indexOf('{["cash", "momo", ...(allowOwe'), split.indexOf("{draft && ("));
  assert.ok(tiles.length > 0, "tiles block not found");
  assert.doesNotMatch(tiles, /startDraft\(/);
  assert.match(tiles, /setParts\(\(current\) => addRemainingToPart\(current, method, totalPesewas\)\)/);
});

test("K1: the MoMo tile goes straight to 61 with the whole Left to pay as the amount", () => {
  const tiles = split.slice(split.indexOf('{["cash", "momo", ...(allowOwe'), split.indexOf("{draft && ("));
  assert.match(tiles, /method === "momo" && onMoMo\) onMoMo\(parts, leftPesewas\)/);
});

test("K1: Owe still takes the whole Left to pay in one tap", () => {
  const tiles = split.slice(split.indexOf('{["cash", "momo", ...(allowOwe'), split.indexOf("{draft && ("));
  assert.match(tiles, /onOwe\?\.\(\[\.\.\.parts, \{ paymentMethod: "owe", amountPesewas: leftPesewas \}\]\)/);
});

test("K1: the row amount opens the editor, prefilled with the row's amount, and Save replaces it", () => {
  assert.match(split, /function startEdit\(part\)/);
  assert.match(split, /value: formatDraft\(part\.amountPesewas\)/);
  assert.match(split, /setPartAmount\(parts, draft\.paymentMethod, draftPesewas, totalPesewas\)/);
  assert.doesNotMatch(split, /onMoMo\(parts, draftPesewas\)/, "editing a row must not reopen 61");
  assert.equal(posText("split.save"), "Save");
});

test("K1: the Owe row is still never typed", () => {
  assert.match(split, /disabled=\{busy \|\| part\.paymentMethod === "owe"\} onClick=\{\(\) => startEdit\(part\)\}/);
});