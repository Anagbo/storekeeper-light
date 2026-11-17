import assert from "node:assert/strict";
import { test } from "node:test";
import { findButton, loadJsx, render, textOf, walk } from "./helpers/renderJsx.js";

// Cleanup batch, commit 1 (a): the amount editor on the split screens turns the typed text into
// pesewas by integer math on the text, not through floating point. Rounding rule: a third
// decimal digit of 5 or more rounds the pesewa up (as Math.round did), the rest is dropped.

const editorInput = (tree) => [...walk(tree)].find((node) => node.type === "input");
const alertText = (tree) => [...walk(tree)].filter((node) => node.props?.role === "alert").map(textOf).join("");

async function editCashRowTo(value, totalPesewas = 20000) {
  const { default: SplitPayment } = await loadJsx("src/pos/SplitPayment.jsx");
  const changes = [];
  const view = render({ type: SplitPayment, props: {
    totalPesewas, totalLabel: "Total", doneLabel: "Done", onBack() {}, onDone() {},
    onPartsChange: (parts) => changes.push(parts),
    initialParts: [{ paymentMethod: "cash", amountPesewas: totalPesewas }]
  } });
  [...walk(view.tree)].find((node) => node.props?.["aria-label"] === "Edit Cash amount").props.onClick();
  view.rerender();
  const startValue = editorInput(view.tree).props.value;
  editorInput(view.tree).props.onChange({ target: { value } });
  view.rerender();
  findButton(view.tree, "Save").props.onClick();
  view.rerender();
  return { startValue, changes, view, saved: changes.at(-1)?.[0]?.amountPesewas ?? null, alert: alertText(view.tree) };
}

test("the editor starts from the row amount written by integer math", async () => {
  for (const [pesewas, text] of [[20000, "200.00"], [5, "0.05"], [100, "1.00"], [1999, "19.99"], [900719925474099, "9007199254740.99"]]) {
    const { default: SplitPayment } = await loadJsx("src/pos/SplitPayment.jsx");
    const view = render({ type: SplitPayment, props: {
      totalPesewas: pesewas, totalLabel: "Total", doneLabel: "Done", onBack() {}, onDone() {},
      initialParts: [{ paymentMethod: "cash", amountPesewas: pesewas }]
    } });
    [...walk(view.tree)].find((node) => node.props?.["aria-label"] === "Edit Cash amount").props.onClick();
    view.rerender();
    assert.equal(editorInput(view.tree).props.value, text, `${pesewas} pesewas`);
  }
});

test("typed amounts that are exact in two decimals are saved exactly", async () => {
  const cases = [
    ["20", 2000], ["20.5", 2050], ["20.05", 2005], ["0.1", 10], ["0.01", 1], ["19.99", 1999],
    ["20,05", 2005], [" 7 ", 700], [".5", 50], ["5.", 500], ["200", 20000], ["199.99", 19999]
  ];
  for (const [typed, expected] of cases) {
    const result = await editCashRowTo(typed);
    assert.equal(result.saved, expected, `"${typed}"`);
  }
});

test("more than two decimals: the third digit decides, exactly (floating point got these wrong)", async () => {
  const cases = [
    ["1.005", 101],   // 1.005 * 100 = 100.49999999999999 in floating point
    ["1.255", 126],   // 125.49999999999999
    ["0.285", 29],    // 28.499999999999996
    ["199.994", 19999],
    ["199.995", 20000],
    ["10.999999999999999", 1100],
    ["0.10000000000000001", 10]
  ];
  for (const [typed, expected] of cases) {
    const result = await editCashRowTo(typed);
    assert.equal(result.saved, expected, `"${typed}"`);
  }
});

test("text that is not a plain amount is refused, not read as a number", async () => {
  // "1e2" and "0x10" are valid JavaScript numbers; they are not amounts a merchant typed.
  // Since 16 Nov 2026 (rules_global.amount_entry) the field itself ignores them: it keeps the amount
  // it had, so nothing is ever read from them.
  for (const typed of ["-1", "1e2", "0x10", "abc", "1.2.3", "Infinity", "99999999999999999999", "9007199254740993"]) {
    const { default: SplitPayment } = await loadJsx("src/pos/SplitPayment.jsx");
    const view = render({ type: SplitPayment, props: {
      totalPesewas: 20000, totalLabel: "Total", doneLabel: "Done", onBack() {}, onDone() {},
      initialParts: [{ paymentMethod: "cash", amountPesewas: 20000 }]
    } });
    [...walk(view.tree)].find((node) => node.props?.["aria-label"] === "Edit Cash amount").props.onClick();
    view.rerender();
    editorInput(view.tree).props.onChange({ target: { value: typed } });
    view.rerender();
    assert.equal(editorInput(view.tree).props.value, "200.00", `"${typed}" is ignored by the field`);
  }
  // What the field takes but is not an amount that fits shows the message and changes nothing.
  for (const typed of ["", " ", ".", "0", "0.00", "0.001", "1 000", "200.01"]) {
    const result = await editCashRowTo(typed);
    assert.equal(result.changes.length, 0, `"${typed}" changes nothing`);
    assert.notEqual(result.alert, "", `"${typed}" shows the message`);
  }
});

// ---- the parser itself ------------------------------------------------------------------------------

import { formatPesewasText, parseAmountToPesewas } from "../src/lib/parsePesewas.js";

test("parseAmountToPesewas: the amounts from the brief, a long decimal, and the limits", () => {
  const expected = { "20": 2000, "20.5": 2050, "20.05": 2005, "0.1": 10, "0.01": 1, "19.99": 1999, "0": 0, "0.00": 0, "007.50": 750 };
  for (const [typed, pesewas] of Object.entries(expected)) assert.equal(parseAmountToPesewas(typed), pesewas, typed);
  // A long decimal: only the third digit matters; the tail is never added up as floating point.
  assert.equal(parseAmountToPesewas("19.999999999999999999"), 2000);
  assert.equal(parseAmountToPesewas("19.994999999999999999"), 1999);
  assert.equal(parseAmountToPesewas("0.10000000000000000555"), 10);
  // Largest accepted whole part (13 digits) stays a safe integer; one more digit is refused.
  assert.equal(parseAmountToPesewas("9999999999999.99"), 999999999999999);
  assert.equal(parseAmountToPesewas("10000000000000"), null);
  assert.equal(Number.isSafeInteger(parseAmountToPesewas("9999999999999.999")), true);
  for (const typed of [null, undefined, "", " ", ".", ",", "-0", "+1", "1e3", "0x1", "1.2.3", "1,000.50", "١٢"]) {
    assert.equal(parseAmountToPesewas(typed), null, String(typed));
  }
});

test("formatPesewasText is the exact inverse for whole pesewas", () => {
  for (const pesewas of [0, 1, 9, 10, 99, 100, 101, 1999, 2005, 100000, 999999999999999]) {
    assert.equal(parseAmountToPesewas(formatPesewasText(pesewas)), pesewas, String(pesewas));
  }
  assert.equal(formatPesewasText(2005), "20.05");
  assert.equal(formatPesewasText(-1), "");
  assert.equal(formatPesewasText(1.5), "");
});

test("the split editor no longer uses floating-point toPesewas", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../src/pos/SplitPayment.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source.replace(/\/\/.*$/gm, ""), /\btoPesewas\b|toFixed|parseFloat|Number\(.*draft/);
});
