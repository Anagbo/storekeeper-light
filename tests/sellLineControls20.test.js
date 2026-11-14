import assert from "node:assert/strict";
import { test } from "node:test";
import { loadJsx, render, setLiveQuery, walk, textOf } from "./helpers/renderJsx.js";

// Wiring 20 "Line controls and amounts" (14 Nov 2026). Every amount is written in full through
// formatGhs (GH₵10.00). PHONE: an item line has two rows: row 1 the name (wraps) and the amount on
// the right; row 2 Less, quantity, More on the left and the bin on the right. Less is disabled at
// quantity 1; buttons are 44px. The Other amount line has no stepper and stays one row: title and
// "From Sell" on the left, the amount, then the bin. Nothing overflows at 340px.

const LONG = "Extra large imported long grain parboiled rice in a sack";
const SALE_ITEMS = [
  { productId: null, name: "Other amount", subtitle: "From Sell", quantity: 1, unitPricePesewas: 300 },
  { productId: 1, name: "Bread", quantity: 1, unitPricePesewas: 500 },
  { productId: 2, name: LONG, quantity: 2, unitPricePesewas: 6000 } // 6000 x 2 = GH₵120.00 the line
];

async function show(updates = []) {
  const { default: SellWithItems } = await loadJsx("src/pos/SellWithItems.jsx");
  setLiveQuery(() => ({ products: [], error: "" }));
  try {
    return render({ type: SellWithItems, props: { params: { saleItems: SALE_ITEMS }, onBack() {}, onNavigate() {}, onUpdateParams: (next) => updates.push(next) } }).tree;
  } finally {
    setLiveQuery(null);
  }
}

const byLabel = (tree, label) => [...walk(tree)].find((node) => node.type === "button" && node.props?.["aria-label"] === label);
const classes = (node) => String(node.props.className ?? "").split(/\s+/);
const kids = (node) => [node.props.children].flat(Infinity).filter((child) => child && typeof child === "object");
const removeCount = (node) => [...walk(node)].filter((n) => /^Remove /.test(n.props?.["aria-label"] ?? "")).length;
// The outermost div that holds only this line's bin.
function lineOf(tree, name) {
  const bin = byLabel(tree, `Remove ${name}`);
  return [...walk(tree)].find((node) => node.type === "div" && [...walk(node)].includes(bin) && removeCount(node) === 1);
}
const rowsOf = (line) => kids(line).filter((child) => child.type === "div");

test("20 item line has two rows: row 1 name then amount; row 2 stepper group on the left, bin on the right", async () => {
  const tree = await show();
  for (const name of ["Bread", LONG]) {
    const rows = rowsOf(lineOf(tree, name));
    assert.equal(rows.length, 2, `${name}: two rows`);
    const [row1, row2] = rows.map(kids);
    assert.equal(row1[0].type, "strong");
    assert.equal(textOf(row1[0]), name);
    assert.equal(row1[1].type, "b", "the amount on the right of row 1");
    assert.ok(classes(rows[0]).includes("justify-between"));
    const [stepper, bin] = row2;
    assert.equal(bin.props["aria-label"], `Remove ${name}`, "the bin is on the right of row 2");
    const [less, qty, more] = kids(stepper);
    assert.equal(less.props["aria-label"], `Less ${name}`);
    assert.equal(qty.props["aria-label"], `Quantity ${name}`);
    assert.equal(more.props["aria-label"], `More ${name}`);
    assert.ok(classes(rows[1]).includes("justify-between"));
  }
});

test("20 buttons are 44px and the name wraps instead of being cut", async () => {
  const tree = await show();
  for (const name of ["Bread", LONG]) {
    for (const label of [`Less ${name}`, `Quantity ${name}`, `More ${name}`, `Remove ${name}`]) {
      const button = byLabel(tree, label);
      assert.ok(classes(button).includes("h-11"), `${label} is 44px high`);
      assert.ok(classes(button).includes("w-11") || classes(button).includes("min-w-11"), `${label} is 44px wide`);
    }
  }
  const otherBin = byLabel(tree, "Remove Other amount");
  assert.ok(classes(otherBin).includes("h-11") && classes(otherBin).includes("w-11"));
  const strong = kids(rowsOf(lineOf(tree, LONG))[0])[0];
  assert.ok(!classes(strong).includes("truncate"));
  for (const cls of ["break-words", "min-w-0", "flex-1"]) assert.ok(classes(strong).includes(cls), cls);
});

test("20 every amount on the lines is written in full through formatGhs", async () => {
  const tree = await show();
  const amounts = [...walk(tree)].filter((node) => node.type === "b").map((node) => textOf(node));
  assert.equal(amounts.length, 3);
  assert.equal(amounts[0], "GH₵3.00");
  assert.equal(amounts[1], "GH₵5.00");
  assert.equal(amounts[2], "GH₵120.00", "6000 x 2 = 12000 pesewas");
});

test("20 Other amount stays one row with no stepper: title and From Sell, the amount, then the bin", async () => {
  const tree = await show();
  const line = lineOf(tree, "Other amount");
  const parts = kids(line);
  assert.equal(parts.length, 3);
  assert.equal(parts[0].type, "span");
  assert.match(textOf(parts[0]), /Other amount/);
  assert.match(textOf(parts[0]), /From Sell/);
  assert.equal(parts[1].type, "b");
  assert.equal(parts[2].props["aria-label"], "Remove Other amount");
  assert.ok(!byLabel(tree, "Less Other amount") && !byLabel(tree, "More Other amount"));
  assert.ok(!classes(line).includes("flex-col"), "one row");
});

// Width budget at the three phone widths: page padding 16px each side, section border 2px each side
// and padding 12px each side. Row 2 holds three 44px controls, 4px gaps, the 8px gap and the bin;
// row 1 holds the amount (about 10px a character at 16px bold) and leaves the name room.
for (const viewport of [340, 360, 393]) {
  test(`20 nothing overflows at ${viewport}px with a long name and GH₵120.00`, async () => {
    const tree = await show();
    const inner = viewport - 32 - 4 - 24;
    const row2 = 44 * 3 + 2 * 4 + 8 + 44;
    assert.ok(row2 <= inner, `row 2 needs ${row2}px, has ${inner}px`);
    const amountWidth = "GH₵120.00".length * 10;
    assert.ok(inner - amountWidth - 8 >= 100, "the name keeps room");
    assert.ok(inner - (amountWidth + 8 + 44 + 8) >= 100, "Other amount title keeps room");
    const line = lineOf(tree, LONG);
    assert.ok(classes(line).includes("flex-col"), "phone: rows stack");
    assert.ok(classes(line).includes("sm:flex-row"), "wide: one row");
    const amount = kids(rowsOf(line)[0])[1];
    assert.ok(classes(amount).includes("shrink-0") && classes(amount).includes("whitespace-nowrap"));
  });
}

test("20 Less is disabled at quantity 1 and enabled above; the bin removes the whole line", async () => {
  const updates = [];
  const tree = await show(updates);
  assert.equal(byLabel(tree, "Less Bread").props.disabled, true);
  assert.equal(byLabel(tree, `Less ${LONG}`).props.disabled, false);
  byLabel(tree, `Remove ${LONG}`).props.onClick();
  assert.deepEqual(updates.at(-1).saleItems.map((line) => line.name), ["Other amount", "Bread"]);
  byLabel(tree, "Remove Other amount").props.onClick();
  assert.deepEqual(updates.at(-1).saleItems.map((line) => line.name), ["Bread", LONG]);
});

test("20 the bin is the Lucide trash-2 at 22px, stroke 2.2, crimson on a grey border", async () => {
  const tree = await show();
  for (const name of ["Other amount", "Bread", LONG]) {
    const bin = byLabel(tree, `Remove ${name}`);
    for (const cls of ["border-slate-500", "bg-white", "text-rose-900"]) assert.ok(classes(bin).includes(cls));
    const icon = kids(bin)[0];
    assert.equal(icon.props.size, 22);
    assert.equal(icon.props.strokeWidth, 2.2);
    assert.ok(/trash-?2/i.test(icon.type.displayName ?? icon.type.render?.displayName ?? ""));
  }
});