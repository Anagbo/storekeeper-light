import assert from "node:assert/strict";
import { test } from "node:test";
import { loadJsx, render, textOf, walk } from "./helpers/renderJsx.js";

// 16 Split payment (11 Nov 2026): editable amounts are chips with a green pencil (wiring rule for 16).
// Owner decision: Owe is set on 18/19 and is not typed here, so its chip has no pencil.

const all = (tree, match) => [...walk(tree)].filter((node) => node.props && match(node));
const cls = (node) => String(node.props.className ?? "").split(/\s+/);

async function mount(parts, totalPesewas = 1500) {
  const { default: SplitPayment } = await loadJsx("src/pos/SplitPayment.jsx");
  return render({ type: SplitPayment, props: {
    totalPesewas, totalLabel: "Sale total", allowOwe: true, doneLabel: "Done",
    initialParts: parts, onBack() {}, onDone() {}, onOwe() {}, onMoMo() {}
  } });
}
const row = (tree, method) => all(tree, (n) => n.props["data-split-row"] === method)[0];
const chip = (tree, method) => all(tree, (n) => n.type === "button" && n.props["aria-label"] === `Edit ${method} amount`)[0];
// Lucide passes its props down, so one pencil is matched only at its outermost node.
const pencils = (node) => all(node, (n) => typeof n.type === "function" && n.props["data-pencil"] !== undefined && "rendered" in n && n.rendered?.props?.["data-pencil"] !== undefined && typeof n.rendered.type === "function");
const editor = (tree) => all(tree, (n) => n.type === "input" && n.props.id === "split-draft-amount")[0];

const PARTS = [
  { paymentMethod: "cash", amountPesewas: 500 },
  { paymentMethod: "momo", amountPesewas: 300, momoMethod: "direct" },
  { paymentMethod: "owe", amountPesewas: 700 }
];

test("16 chips: Cash and MoMo have a pencil chip with its accessible name; Owe shows its amount with no pencil", async () => {
  const view = await mount(PARTS);
  for (const method of ["Cash", "MoMo"]) {
    const node = chip(view.tree, method);
    assert.ok(node, `Edit ${method} amount`);
    assert.equal(pencils(node).length, 1, `${method} pencil`);
    assert.match(pencils(node)[0].props.className, /text-emerald-900/);
    const c = cls(node);
    for (const want of ["min-h-12", "border-2", "border-slate-400", "bg-slate-100", "text-[21px]", "font-extrabold", "whitespace-nowrap", "shrink-0"]) assert.ok(c.includes(want), `${method} chip ${want}`);
  }
  assert.equal(textOf(chip(view.tree, "Cash")), "GH₵5.00");
  assert.equal(chip(view.tree, "Owe"), undefined, "no Edit Owe amount button");
  assert.equal(pencils(row(view.tree, "owe")).length, 0, "no pencil on Owe");
  assert.ok(textOf(row(view.tree, "owe")).includes("GH₵7.00"));
  assert.equal(pencils(view.tree).length, 2);
});

test("16 chips: a verified (phone request) MoMo row shows no pencil and no remove button", async () => {
  const view = await mount([{ paymentMethod: "momo", amountPesewas: 800, momoMethod: "paystack", verification: "verified" }, { paymentMethod: "cash", amountPesewas: 700 }]);
  assert.equal(chip(view.tree, "MoMo"), undefined);
  assert.equal(pencils(row(view.tree, "momo")).length, 0);
  assert.ok(textOf(row(view.tree, "momo")).includes("GH₵8.00"));
  assert.equal(all(row(view.tree, "momo"), (n) => n.props["aria-label"] === "Remove MoMo").length, 0);
  assert.ok(chip(view.tree, "Cash"));
});

test("16 chips: tapping the chip opens the editor with that amount; tapping the row name does too", async () => {
  const view = await mount(PARTS);
  assert.equal(editor(view.tree), undefined);
  chip(view.tree, "Cash").props.onClick();
  view.rerender();
  assert.equal(editor(view.tree).props.value, "5.00");
  assert.ok(textOf(view.tree).includes("How much"));
  const again = await mount(PARTS);
  const nameButton = all(row(again.tree, "momo"), (n) => n.type === "button" && textOf(n).startsWith("MoMo"))[0];
  nameButton.props.onClick();
  again.rerender();
  assert.equal(editor(again.tree).props.value, "3.00");
});

test("16 chips: the remove (x) stays separate at the far right, after the chip", async () => {
  const view = await mount(PARTS);
  const nodes = [...walk(row(view.tree, "cash"))];
  const edit = nodes.find((n) => n.props?.["aria-label"] === "Edit Cash amount");
  const remove = nodes.find((n) => n.props?.["aria-label"] === "Remove Cash");
  assert.ok(edit && remove);
  assert.ok(nodes.indexOf(remove) > nodes.indexOf(edit));
  assert.equal(all(edit, (n) => n === remove).length, 0, "remove is not inside the chip");
  assert.equal(nodes.at(-1) === remove || [...walk(remove)].includes(nodes.at(-1)), true, "remove is the last control in the row");
});

test("16: one quiet line under Sale total, \"Tap an amount to change it.\"", async () => {
  const view = await mount(PARTS);
  const hints = all(view.tree, (n) => n.props["data-edit-hint"] !== undefined);
  assert.equal(hints.length, 1);
  assert.equal(textOf(hints[0]), "Tap an amount to change it.");
  const nodes = [...walk(view.tree)];
  const total = nodes.find((n) => n.type === "strong" && textOf(n) === "GH₵15.00");
  assert.ok(nodes.indexOf(hints[0]) > nodes.indexOf(total), "under the total");
  assert.ok(nodes.indexOf(hints[0]) < nodes.indexOf(row(view.tree, "cash")), "above the rows");
});

test("16 at 360px: GH₵12,345.00 is never clipped and the remove button stays in the row (class contract)", async () => {
  const view = await mount([{ paymentMethod: "cash", amountPesewas: 1234500 }], 2000000);
  const r = row(view.tree, "cash");
  assert.ok(cls(r).includes("flex-wrap"), "chip and remove wrap under the name when they do not fit");
  assert.ok(cls(r).includes("min-w-0"));
  const c = chip(view.tree, "Cash");
  assert.equal(textOf(c), "GH₵12,345.00");
  assert.ok(cls(c).includes("whitespace-nowrap") && cls(c).includes("shrink-0"));
  assert.ok(!cls(c).some((x) => /^(truncate|overflow-hidden|text-ellipsis|amount-fit)$/.test(x)), "never clipped or shrunk");
  const group = all(r, (n) => n.type === "div" && cls(n).includes("ml-auto"))[0];
  assert.ok(group, "chip and remove travel together");
  assert.ok(cls(group).includes("shrink-0"));
  assert.ok(all(group, (n) => n.props["aria-label"] === "Remove Cash").length === 1);
  // Width check at 360px: page 16px gutters, row border 2px and padding 12px each side = 300px inside.
  // Chip: ~150px text + 8px gap + 18px pencil + 24px padding + 4px border; then 8px gap and the 48px remove.
  assert.ok(150 + 8 + 18 + 24 + 4 + 8 + 48 <= 360 - 32 - 4 - 24);
});
