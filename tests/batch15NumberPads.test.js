import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { normalizeProductInput } from "../src/db/products.js";
import { formatGhs } from "../src/lib/money.js";
import { AMOUNT_KEYPAD_KEYS, amountTextToPesewas, COUNT_KEYPAD, pressAmountKey } from "../src/pos/amountKeypad.js";
import { posText } from "../src/pos/i18n.js";
import wiring from "../src/pos/wiring.json" with { type: "json" };
import { findButton, loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Batch 15: number pads on 37 and 38 as the wiring file and prototype show them.
after(async () => {
  setLiveQuery(null);
  db.close();
  await db.delete();
});
beforeEach(async () => {
  await db.products.clear();
});

const settle = () => new Promise((resolve) => setImmediate(resolve));
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const padLabels = (screenId) => wiring.screens[screenId].controls
  .filter((control) => control.type === "selection_or_edit")
  .map((control) => control.label);
// A key button by its visible text, or by its accessible name (the Delete key has an icon).
// The wiring calls the key "Delete"; its accessible name is "Delete last digit".
const key = (tree, label) => [...walk(tree)].find((node) => node.type === "button" &&
  (textOf(node) === label || node.props?.["aria-label"] === (label === "Delete" ? posText("pad.delete") : label)));
const press = (view, ...labels) => {
  for (const label of labels) {
    const button = key(view.tree, label);
    assert.ok(button, `the pad has a ${label} key`);
    button.props.onClick();
    view.rerender();
  }
};

// ---- the pad logic: integers only ------------------------------------------------------

// Changed 15 Nov 2026 (one shared amount keypad, rules_global.amount_entry): 37 and 38 use the shared
// keypad, so the keys are the wiring's (now with ".") and money fills whole cedis, not pesewas.
test("pad: the keys are exactly the ones in the wiring file for 37 and 38", () => {
  assert.deepEqual(padLabels("37"), padLabels("38"));
  assert.deepEqual([...padLabels("37")].sort(), [...AMOUNT_KEYPAD_KEYS].sort());
});

test("pad: money fills whole cedis: typing 8 is GH₵8.00 and 4 . 5 is GH₵4.50", () => {
  const type = (...keys) => keys.reduce((text, next) => pressAmountKey(text, next), "");
  assert.equal(formatGhs(amountTextToPesewas(type("8"))), "GH₵8.00");
  assert.equal(formatGhs(amountTextToPesewas(type("4", ".", "5"))), "GH₵4.50");
  for (let index = 0; index < 20; index += 1) assert.ok(Number.isSafeInteger(amountTextToPesewas(type(..."9".repeat(index).split("")))));
  assert.equal(amountTextToPesewas(type(..."9".repeat(20).split(""), ".", "9", "9")), 999999999, "at most 999 999 999 pesewas (same as 53)");
});

test("pad: a count is whole, capped at 6 digits, and ignores the decimal point", () => {
  let text = "";
  for (let index = 0; index < 10; index += 1) text = pressAmountKey(text, "9", COUNT_KEYPAD);
  assert.equal(text, "999999");
  assert.equal(pressAmountKey("12", ".", COUNT_KEYPAD), "12");
});

test("pad: money entry does no floating-point arithmetic (37 and the pad logic); the quantity on 38 is a count", () => {
  const source = read("src/pos/SetupScreens.jsx");
  const bodyOf = (name) => {
    const start = source.indexOf(`export function ${name}`);
    const end = source.indexOf("export function", start + 10);
    return source.slice(start, end === -1 ? undefined : end);
  };
  assert.doesNotMatch(bodyOf("HowMuchIsItem"), /toPesewas\(|parseFloat|Number\(|\* 100|\/ 100|toFixed/, "37 must not convert money with floating point");
  assert.doesNotMatch(bodyOf("HowManyItem"), /parseFloat|Number\(|toFixed/, "38 must not parse its count as a float");
  assert.doesNotMatch(read("src/pos/amountKeypad.js"), /parseFloat|Number\(|toFixed|\* 100\b|\/ 100\b|Math\.round/);
});

// ---- 37 ----------------------------------------------------------------------------------

test("37: shows the pad from the wiring file, no text field, and the amount through the formatter", async () => {
  const { HowMuchIsItem } = await loadJsx("src/pos/SetupScreens.jsx");
  const view = render({ type: HowMuchIsItem, props: { params: { product: { id: 1, name: "Sugar" }, saleItems: [] }, onBack() {}, onReturnTo() {} } });
  assert.equal([...walk(view.tree)].filter((node) => node.type === "input").length, 0, "no text field");
  for (const label of padLabels("37")) assert.ok(key(view.tree, label), `${label} key`);
  assert.match(textOf(view.tree), /Price for one/);
  assert.match(textOf(view.tree), /GH₵0\.00/);
  press(view, "8");
  assert.match(textOf(view.tree), /GH₵8\.00/);
  press(view, "00");
  assert.match(textOf(view.tree), /GH₵800\.00/);
  press(view, "Delete", "Delete", ".", "0", "5");
  assert.match(textOf(view.tree), /GH₵8\.05/);
});

test("37: Save price stores the typed pesewas and returns to 20 with the item in the sale", async () => {
  const { HowMuchIsItem } = await loadJsx("src/pos/SetupScreens.jsx");
  const productId = await db.products.add({ name: "Sugar", default_price: "", active: true, createdAt: Date.now(), updatedAt: Date.now() });
  const calls = [];
  const view = render({ type: HowMuchIsItem, props: {
    params: { product: { id: productId, name: "Sugar" }, saleItems: [] },
    onBack() {},
    onReturnTo: (...args) => calls.push(args)
  } });
  press(view, "4", ".", "5");
  findButton(view.tree, "Save price").props.onClick();
  for (let index = 0; index < 20 && !calls.length; index += 1) await settle();
  assert.equal(calls.length, 1);
  const [route, params] = calls[0];
  assert.equal(route, wiring.screens["20"].component);
  assert.deepEqual(params.saleItems, [{ productId, name: "Sugar", quantity: 1, unitPricePesewas: 450 }]);
  assert.equal(params.amountPesewas, 450);
  assert.equal((await db.products.get(productId)).default_price, 4.5);
});

test("37: Save price with nothing typed shows the price message and saves nothing", async () => {
  const { HowMuchIsItem } = await loadJsx("src/pos/SetupScreens.jsx");
  const calls = [];
  const view = render({ type: HowMuchIsItem, props: { params: { product: { id: 1, name: "Sugar" }, saleItems: [] }, onBack() {}, onReturnTo: (...args) => calls.push(args) } });
  findButton(view.tree, "Save price").props.onClick();
  for (let index = 0; index < 5; index += 1) await settle();
  view.rerender();
  assert.equal(calls.length, 0);
  assert.match(textOf(view.tree), /Enter a valid price greater than GH₵0\.00/);
});

test("37: Back goes back", async () => {
  const { HowMuchIsItem } = await loadJsx("src/pos/SetupScreens.jsx");
  let backs = 0;
  const view = render({ type: HowMuchIsItem, props: { params: { product: { id: 1, name: "Sugar" } }, onBack: () => { backs += 1; }, onReturnTo() {} } });
  findButton(view.tree, "Back").props.onClick();
  assert.equal(backs, 1);
});

// ---- 38 ----------------------------------------------------------------------------------

test("38: shows the pad from the wiring file in place of the plus and minus buttons", async () => {
  const { HowManyItem } = await loadJsx("src/pos/SetupScreens.jsx");
  const view = render({ type: HowManyItem, props: { params: { product: { id: 1, name: "Bread", default_price: 2 }, quantity: 12 }, onBack() {}, onReturnTo() {} } });
  for (const label of padLabels("38")) assert.ok(key(view.tree, label), `${label} key`);
  assert.ok(!key(view.tree, "Remove one") && !key(view.tree, "Add one"), "no plus or minus");
  assert.match(textOf(view.tree), /Number of Bread/);
  assert.match(textOf(view.tree), /GH₵2\.00 each/, "the extra {amount} each line is kept");
  assert.ok(findButton(view.tree, "Add 12"), "the button reads Add 12");
});

test("38: typing changes the number and the button; Add puts that many in the sale", async () => {
  const { HowManyItem } = await loadJsx("src/pos/SetupScreens.jsx");
  const calls = [];
  const view = render({ type: HowManyItem, props: {
    params: { product: { id: 7, name: "Bread", default_price: 2 }, saleItems: [] },
    onBack() {},
    onReturnTo: (...args) => calls.push(args)
  } });
  assert.ok(findButton(view.tree, "Add 1"));
  press(view, "1", "2");
  assert.ok(findButton(view.tree, "Add 12"));
  press(view, "Delete");
  assert.ok(findButton(view.tree, "Add 1"));
  press(view, "5");
  findButton(view.tree, "Add 15").props.onClick();
  assert.equal(calls.length, 1);
  const [route, params] = calls[0];
  assert.equal(route, wiring.screens["20"].component);
  assert.deepEqual(params.saleItems, [{ productId: 7, name: "Bread", quantity: 15, unitPricePesewas: 200 }]);
});

test("38: Add with zero shows an error and adds nothing", async () => {
  const { HowManyItem } = await loadJsx("src/pos/SetupScreens.jsx");
  const calls = [];
  const view = render({ type: HowManyItem, props: { params: { product: { id: 7, name: "Bread", default_price: 2 }, saleItems: [] }, onBack() {}, onReturnTo: (...args) => calls.push(args) } });
  press(view, "Delete");
  findButton(view.tree, "Add 0").props.onClick();
  view.rerender();
  assert.equal(calls.length, 0);
  assert.ok([...walk(view.tree)].some((node) => node.props?.role === "alert"));
});

// ---- the price is stored from integer pesewas -------------------------------------------

test("a product price can be given as whole pesewas and is stored without a text-to-number step", () => {
  assert.equal(normalizeProductInput({ name: "Sugar", pricePesewas: 805 }).default_price, 8.05);
  assert.equal(normalizeProductInput({ name: "Sugar", pricePesewas: 1 }).default_price, 0.01);
  assert.throws(() => normalizeProductInput({ name: "Sugar", pricePesewas: 0 }), /valid item price/);
  assert.throws(() => normalizeProductInput({ name: "Sugar", pricePesewas: 1.5 }), /valid item price/);
  assert.throws(() => normalizeProductInput({ name: "Sugar", pricePesewas: -5 }), /valid item price/);
});