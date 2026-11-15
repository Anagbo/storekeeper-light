import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { db } from "../src/db/db.js";
import { toPesewas } from "../src/lib/money.js";
import {
  AMOUNT_KEYPAD_LAST_ROW,
  amountTextToPesewas,
  normalizeTypedAmount,
  pesewasToAmountText,
  pressAmountKey
} from "../src/pos/amountKeypad.js";
import { posText } from "../src/pos/i18n.js";
import wiring from "../src/pos/wiring.json" with { type: "json" };
import { appCss, browser, measureInFrames, toHtml } from "./helpers/browserLayout.js";
import { findButton, loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// One shared amount keypad (wiring rules_global.amount_entry, decided 15 Nov 2026).
after(async () => {
  setLiveQuery(null);
  db.close();
  await db.delete();
});

const type = (...keys) => keys.reduce((text, key) => pressAmountKey(text, key), "");
const shows = (...keys) => amountTextToPesewas(type(...keys));
const keyButton = (tree, label) => [...walk(tree)].find((node) => node.type === "button" &&
  (textOf(node) === label || node.props?.["aria-label"] === (label === "Delete" ? posText("pad.delete") : label)));
const press = (view, ...labels) => {
  for (const label of labels) {
    const button = keyButton(view.tree, label);
    assert.ok(button, `the pad has a ${label} key`);
    button.props.onClick();
    view.rerender();
  }
};
const lastRow = (tree) => {
  const row = [...walk(tree)].find((node) => node.props?.["data-keypad-last-row"] !== undefined);
  assert.ok(row, "the pad has its last row");
  return [...walk(row)].filter((node) => node.type === "button")
    .map((node) => ({ text: textOf(node), label: node.props["aria-label"] ?? null, className: node.props.className, style: JSON.stringify(node.props.style ?? null) }));
};

// ---- the rules ---------------------------------------------------------------------------------------

test("keypad rules: digits fill whole cedis from the left", () => {
  assert.equal(shows("8"), 800);
  assert.equal(shows("8", "5"), 8500);
  assert.equal(shows("2", ".", "5"), 250);
  assert.equal(shows("2", ".", "0", "5"), 205);
  assert.equal(shows("1", "00"), 10000);
});

test("keypad rules: '.' starts pesewas, at most two decimals, a second '.' is ignored", () => {
  assert.equal(type("2", ".", "5", "0", "9"), "2.50", "a third decimal is ignored");
  assert.equal(type("2", ".", ".", "5"), "2.5", "a second . is ignored");
  assert.equal(type("."), "0.", "a first . gives 0.");
  assert.equal(shows(".", "5"), 50);
});

test("keypad rules: '00' is ignored on an empty pad and after '.'; no leading zeros", () => {
  assert.equal(type("00"), "");
  assert.equal(type("0"), "");
  assert.equal(type("0", "0", "7"), "7");
  assert.equal(type("3", ".", "00"), "3.");
  assert.equal(type("3", ".", "5", "00"), "3.5");
});

test("keypad rules: Delete drops one character; money stays a safe whole number of pesewas", () => {
  assert.equal(type("2", ".", "5", "Delete"), "2.");
  assert.equal(type(".", "Delete"), "", "0. without its point is an empty pad, not a 0");
  assert.equal(type("Delete"), "");
  const long = type(..."9".repeat(30).split(""), ".", "9", "9", "9");
  assert.equal(amountTextToPesewas(long), 999999999);
  assert.ok(Number.isSafeInteger(amountTextToPesewas(long)));
});

test("keypad rules: a draft amount in pesewas comes back as pad text", () => {
  assert.deepEqual([800, 850, 805, 1, 123456].map(pesewasToAmountText), ["8", "8.5", "8.05", "0.01", "1234.56"]);
  for (const pesewas of [800, 850, 805, 1, 123456]) assert.equal(amountTextToPesewas(pesewasToAmountText(pesewas)), pesewas);
  assert.equal(pesewasToAmountText(0), "");
});

test("typed amount (44 and the field on 26) follows the same rules", () => {
  assert.equal(normalizeTypedAmount("8"), "8");
  assert.equal(normalizeTypedAmount("2.5"), "2.5");
  assert.equal(normalizeTypedAmount("2..5"), "2.5");
  assert.equal(normalizeTypedAmount("2.5.5"), "2.55", "the second . is ignored, the digit still counts");
  assert.equal(normalizeTypedAmount("1.234"), "1.23");
  assert.equal(normalizeTypedAmount("007"), "7");
  assert.equal(normalizeTypedAmount("GHS 6,50"), "6.50");
  assert.equal(normalizeTypedAmount("1e2", "1"), "1", "exponent text is refused; the field keeps what it had");
  assert.equal(normalizeTypedAmount("0x10"), "");
});

// ---- every pad -------------------------------------------------------------------------------------------

async function pads() {
  const { default: Sell } = await loadJsx("src/pos/Sell.jsx");
  const { CollectPayPart } = await loadJsx("src/pos/DebtCollection.jsx");
  const { ManualDebtAmount } = await loadJsx("src/pos/ManualDebtScreens.jsx");
  const { HowMuchIsItem, HowManyItem } = await loadJsx("src/pos/SetupScreens.jsx");
  const params = {};
  return {
    "15 Sell": () => render({ type: Sell, props: { params: {}, onNavigate() {}, onUpdateParams() {} } }),
    "26 Collect: pay part": () => render({ type: CollectPayPart, props: { params: { debtId: "d1" }, onBack() {}, onNavigate() {}, onUpdateParams() {}, onRecordCollection() {} } }),
    "53 How much do they owe?": () => render({ type: ManualDebtAmount, props: { params: { customer: { name: "Ama" } }, onBack() {}, onNavigate() {}, onUpdateParams: (next) => Object.assign(params, next), onSaveManualDebt: async () => {} } }),
    "37 How much is {item}?": () => render({ type: HowMuchIsItem, props: { params: { product: { id: 1, name: "Sugar" }, saleItems: [] }, onBack() {}, onReturnTo() {} } }),
    "38 How many {item}?": () => render({ type: HowManyItem, props: { params: { product: { id: 1, name: "Bread", default_price: 2 } }, onBack() {}, onReturnTo() {} } })
  };
}
const MONEY_PADS = ["15 Sell", "26 Collect: pay part", "53 How much do they owe?", "37 How much is {item}?"];

test("every money pad: pressing 8 shows GH₵8.00 and 2 . 5 shows GH₵2.50", async () => {
  setLiveQuery(() => ({ id: "d1", amountPesewas: 10000, customerName: "Ama", status: "unpaid" }));
  try {
    const screens = await pads();
    for (const name of MONEY_PADS) {
      let view = screens[name]();
      assert.equal([...walk(view.tree)].filter((node) => node.type === "input" && node.props?.inputMode === "decimal").length, 0, `${name}: no typed amount field beside the pad`);
      press(view, "8");
      assert.match(textOf(view.tree), /GH₵8\.00/, name);
      view = screens[name]();
      press(view, "2", ".", "5");
      assert.match(textOf(view.tree), /GH₵2\.50/, name);
      if (name.startsWith("26")) assert.match(textOf(view.tree), /GH₵97\.50/, "26: the balance after this payment");
    }
  } finally {
    setLiveQuery(null);
  }
});

test("38 (a count) uses the same keypad: 8 gives 8, and '.' does nothing", async () => {
  const screens = await pads();
  const view = screens["38 How many {item}?"]();
  press(view, "8");
  assert.ok(findButton(view.tree, "Add 8"));
  assert.equal(keyButton(view.tree, ".").props.disabled, true);
});

test("every pad: keys 1 to 9 and the same last row of four keys '. 0 00 Delete'", async () => {
  setLiveQuery(() => ({ id: "d1", amountPesewas: 10000, customerName: "Ama", status: "unpaid" }));
  try {
    const screens = await pads();
    const rows = Object.entries(screens).map(([name, mount]) => {
      const tree = mount().tree;
      for (const digit of ["1", "2", "3", "4", "5", "6", "7", "8", "9"]) assert.ok(keyButton(tree, digit), `${name} has ${digit}`);
      return [name, lastRow(tree)];
    });
    const [, first] = rows[0];
    assert.deepEqual(first.map((key) => key.text || key.label), [".", "0", "00", posText("pad.delete")]);
    assert.equal(new Set(first.map((key) => key.className.replace(/border-2 border-slate-500 bg-white|bg-slate-300/, ""))).size, 2, "Delete differs only in its grey fill");
    assert.match(first[3].className, /bg-slate-300/, "Delete is grey");
    for (const [name, row] of rows) assert.deepEqual(row, first, `${name}: the last row is identical`);
  } finally {
    setLiveQuery(null);
  }
});

test("the wiring's pad screens list the same keys as the keypad", () => {
  for (const id of ["15", "26", "37", "38", "53"]) {
    const labels = wiring.screens[id].controls.map((control) => control.label);
    for (const key of AMOUNT_KEYPAD_LAST_ROW) assert.ok(labels.includes(key), `${id} lists ${key}`);
  }
});

// ---- the last row in a real browser -------------------------------------------------------------------------

test("every pad at 340, 360 and 393px: the last row is four equal keys on one line, inside the screen, nothing clipped", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)" }, async () => {
  setLiveQuery(() => ({ id: "d1", amountPesewas: 10000, customerName: "Ama", status: "unpaid" }));
  let pages;
  try {
    const screens = await pads();
    pages = Object.entries(screens).map(([name, mount]) => ({ name, html: toHtml(mount().tree) }));
  } finally {
    setLiveQuery(null);
  }
  const results = measureInFrames({
    pages,
    css: await appCss(),
    widths: [340, 360, 393],
    height: 1400,
    measure: `(frame, win, doc) => {
      const row = doc.querySelector('[data-keypad-last-row]');
      const keys = [...row.querySelectorAll('button')].map((key) => {
        const box = key.getBoundingClientRect();
        return { text: key.textContent || key.getAttribute('aria-label'), left: box.left, right: box.right, top: Math.round(box.top), width: box.width, height: box.height, clipped: key.scrollWidth > key.clientWidth + 1, bg: getComputedStyle(key).backgroundColor };
      });
      const digit = doc.querySelector('[data-amount-keypad] button').getBoundingClientRect();
      return { keys, digitHeight: digit.height, viewport: win.innerWidth, pageOverflow: doc.scrollingElement.scrollWidth > win.innerWidth };
    }`
  });
  assert.equal(results.length, pages.length * 3);
  for (const result of results) {
    const where = `${result.name} at ${result.width}px`;
    const { keys } = result;
    assert.equal(result.pageOverflow, false, `${where}: no horizontal scroll`);
    assert.deepEqual(keys.map((key) => key.text), [".", "0", "00", "Delete last digit"], where);
    assert.equal(new Set(keys.map((key) => key.top)).size, 1, `${where}: one line, no orphan row`);
    for (const key of keys) {
      assert.ok(Math.abs(key.width - keys[0].width) <= 0.5, `${where}: ${key.text} is as wide as the others (${key.width} vs ${keys[0].width})`);
      assert.ok(key.left >= 0 && key.right <= result.viewport, `${where}: ${key.text} is inside the screen`);
      assert.equal(key.clipped, false, `${where}: ${key.text} is not clipped`);
      assert.ok(key.height >= 44, `${where}: ${key.text} is at least 44px tall`);
      assert.equal(key.height, result.digitHeight, `${where}: ${key.text} is as tall as the digit keys`);
    }
    assert.notEqual(keys[3].bg, keys[0].bg, `${where}: Delete is grey`);
  }
});

// ---- 44 keeps its typed field ---------------------------------------------------------------------------

test("44 Spent money: a typed field with the decimal keyboard, following the keypad rules", async () => {
  const { SpentMoney } = await loadJsx("src/pos/SupplierScreens.jsx");
  const kept = {};
  const view = render({ type: SpentMoney, props: { params: {}, onBack() {}, onNavigate() {}, onUpdateParams: (next) => Object.assign(kept, next), onSave: async () => {} } });
  const field = () => [...walk(view.tree)].find((node) => node.type === "input");
  assert.equal(field().props.inputMode, "decimal");
  assert.equal(keyButton(view.tree, "00"), undefined, "no keypad on 44");
  for (const [typed, expected] of [["8", "8"], ["2.5", "2.5"], ["2..5", "2.5"], ["1.234", "1.23"], ["05", "5"]]) {
    field().props.onChange({ target: { value: typed } });
    view.rerender();
    assert.equal(field().props.value, expected, typed);
    assert.equal(kept.expenseAmount, expected, `${typed}: the draft keeps the same text`);
  }
  assert.equal(toPesewas(field().props.value), 500);
});

// ---- the scan --------------------------------------------------------------------------------------------

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(js|jsx)$/.test(name) ? [path] : [];
  });
}

const KEYPAD_FILES = ["pos/amountKeypad.js", "pos/AmountKeypad.jsx"];

test("scan: there is no second keypad implementation in src", () => {
  const root = fileURLToPath(new URL("../src", import.meta.url));
  const problems = [];
  for (const path of sourceFiles(root)) {
    const name = path.slice(root.length + 1).replaceAll("\\", "/");
    if (KEYPAD_FILES.includes(name)) continue;
    if (/(?:Number|Digit|Amount)?Pad\.(js|jsx)$|Keypad\.(js|jsx)$/i.test(name)) problems.push(`${name}: a keypad file`);
    const source = readFileSync(path, "utf8");
    source.split(/\r?\n/).forEach((line, index) => {
      const code = line.replace(/\/\/.*$/, "");
      const where = `${name}:${index + 1}: ${code.trim().slice(0, 100)}`;
      if (/["']7["']\s*,\s*["']8["']\s*,\s*["']9["']/.test(code)) problems.push(`${where} (a list of digit keys)`);
      if (/import\s*\{[^}]*\bDelete\b[^}]*\}\s*from\s*["']lucide-react["']/.test(code)) problems.push(`${where} (a Delete key icon)`);
      if (/["']backspace["']/.test(code)) problems.push(`${where} (a backspace key)`);
      if (/["']00["']/.test(code) && !/startsWith\(\s*["']00["']\s*\)/.test(code)) problems.push(`${where} (a 00 key)`);
    });
  }
  assert.deepEqual(problems, []);
});

test("scan: every screen with a pad renders the shared AmountKeypad", () => {
  for (const file of ["src/pos/Sell.jsx", "src/pos/DebtCollection.jsx", "src/pos/ManualDebtScreens.jsx", "src/pos/SetupScreens.jsx"]) {
    assert.match(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), /<AmountKeypad\b/, file);
  }
});
