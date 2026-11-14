import assert from "node:assert/strict";
import { test } from "node:test";
import { loadJsx, render, setLiveQuery, walk } from "./helpers/renderJsx.js";

// Wiring 20 (line controls, 14 Nov 2026): every line ends with the bin after the amount (Lucide
// trash-2, 22px, stroke 2.2, grey border #64748B, crimson bin #8B0836, "Remove {item}"). An item line
// is name, Less, quantity, More, amount, bin. Less is disabled at quantity 1 and the bin removes the
// line. At 340px the row must not overflow: buttons 40px, the name may wrap.

const SALE_ITEMS = [
  { productId: null, name: "Other amount", subtitle: "From Sell", quantity: 1, unitPricePesewas: 300 },
  { productId: 1, name: "Bread", quantity: 1, unitPricePesewas: 500 },
  { productId: 2, name: "Rice", quantity: 2, unitPricePesewas: 1200 }
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
// The row that holds a button: the nearest div whose children include it.
function rowOf(tree, button) {
  return [...walk(tree)].find((node) => node.type === "div" && [...walk(node)].includes(button) && [...walk(node)].filter((n) => n.type === "button" && /^Remove /.test(n.props?.["aria-label"] ?? "")).length === 1);
}
const kids = (node) => [node.props.children].flat(Infinity).filter((child) => child && typeof child === "object");

for (const name of ["Other amount", "Bread", "Rice"]) {
  test(`20 ${name}: the bin is the last control, after the amount, with the trash-2 icon at 22px stroke 2.2`, async () => {
    const tree = await show();
    const bin = byLabel(tree, `Remove ${name}`);
    assert.ok(bin, `Remove ${name}`);
    const row = rowOf(tree, bin);
    const parts = kids(row);
    assert.equal(parts.at(-1), bin, "bin is last");
    assert.equal(parts.at(-2).type, "b", "the amount is just before the bin");
    for (const cls of ["h-10", "w-10", "border-slate-500", "bg-white", "text-rose-900"]) assert.ok(classes(bin).includes(cls), `${name} bin has ${cls}`);
    const icon = kids(bin)[0];
    assert.equal(icon.props.size, 22);
    assert.equal(icon.props.strokeWidth, 2.2);
    assert.ok(/trash-?2/i.test(icon.type.displayName ?? icon.type.render?.displayName ?? ""), "Lucide trash-2");
  });
}

test("20 item line order: name, Less, quantity, More, amount, bin; buttons 40px; the name may wrap", async () => {
  const tree = await show();
  const row = rowOf(tree, byLabel(tree, "Remove Bread"));
  const parts = kids(row);
  assert.equal(parts.length, 6);
  assert.equal(parts[0].type, "strong");
  assert.equal(parts[1].props["aria-label"], "Less Bread");
  assert.equal(parts[2].props.children, 1, "the quantity");
  assert.equal(parts[3].props["aria-label"], "More Bread");
  assert.equal(parts[4].type, "b", "the amount");
  assert.equal(parts[5].props["aria-label"], "Remove Bread");
  for (const button of [parts[1], parts[3], parts[5]]) assert.ok(classes(button).includes("h-10") && classes(button).includes("w-10"), `${button.props["aria-label"]} is 40px`);
  assert.ok(!classes(parts[0]).includes("truncate"), "the name wraps instead of being cut");
  assert.ok(classes(parts[0]).includes("break-words"));
});

test("20 Less is disabled at quantity 1 and enabled above; the bin removes the whole line", async () => {
  const updates = [];
  const tree = await show(updates);
  assert.equal(byLabel(tree, "Less Bread").props.disabled, true);
  assert.equal(byLabel(tree, "Less Rice").props.disabled, false);
  byLabel(tree, "Remove Rice").props.onClick();
  assert.deepEqual(updates.at(-1).saleItems.map((line) => line.name), ["Other amount", "Bread"]);
  byLabel(tree, "Remove Other amount").props.onClick();
  assert.deepEqual(updates.at(-1).saleItems.map((line) => line.name), ["Bread", "Rice"]);
});
