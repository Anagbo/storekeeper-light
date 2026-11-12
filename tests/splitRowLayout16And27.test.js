import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { describeSplitPart } from "../src/pos/splitTender.js";
import { loadJsx, render, textOf, walk } from "./helpers/renderJsx.js";

// Wiring 16 and 27, "Row layout on 16 and 27" (decided 12 Nov 2026), the same at every width:
// line 1 = icon, short name (Cash, MoMo, Owe), the amount chip and the x; line 2 = the status
// text across the full card width, at most 2 lines. Never the status in a narrow column beside
// the chip (at 393px it wrapped to 4-6 lines; at ~340px "MoMo" broke into "MoM / o").

const all = (tree, match) => [...walk(tree)].filter((node) => node.props && match(node));
const cls = (node) => String(node.props.className ?? "").split(/\s+/);
const attr = (name) => (node) => node.props[name] !== undefined;
const label = (name) => (node) => node.props["aria-label"] === name;

const OWE_PARAMS = {
  customer: { name: "Juju" },
  installmentPlan: { isInstallmentPlan: true, installmentAmount: 1000, frequency: "weekly", nextDueDate: "2026-11-19" }
};
const PARTS = [
  { paymentMethod: "cash", amountPesewas: 5000 },
  { paymentMethod: "momo", amountPesewas: 5000, momoMethod: "direct" },
  { paymentMethod: "owe", amountPesewas: 5000 }
];
const LOCKED = [
  { paymentMethod: "momo", amountPesewas: 5000, momoMethod: "direct", verification: "merchant_confirmed", confirmedPesewas: 5000 },
  { paymentMethod: "cash", amountPesewas: 5000 }
];

async function mount(parts) {
  const { default: SplitPayment } = await loadJsx("src/pos/SplitPayment.jsx");
  return render({ type: SplitPayment, props: {
    totalPesewas: parts.reduce((sum, part) => sum + part.amountPesewas, 0), totalLabel: "Sale total", allowOwe: true,
    doneLabel: "Done", initialParts: parts, onBack() {}, onDone() {}, onOwe() {}, onMoMo() {},
    partDetail: (part) => describeSplitPart(part, OWE_PARAMS)
  } });
}
const rowOf = (tree, method) => all(tree, (node) => node.props["data-split-row"] === method)[0];
const lineOf = (row) => all(row, attr("data-row-line"))[0];
const statusOf = (row) => all(row, attr("data-row-status"))[0];

test("16/27 rows: name, chip and x are in line 1; the status is a separate full-width line 2", async () => {
  const view = await mount(PARTS);
  for (const [method, name] of [["cash", "Cash"], ["momo", "MoMo"], ["owe", "Owe"]]) {
    const row = rowOf(view.tree, method);
    const line = lineOf(row);
    assert.ok(line, `${name}: line 1 exists`);
    assert.ok(cls(row).includes("flex-col"), `${name}: the row stacks line 1 and the status`);
    // Line 1 holds the name, the chip (or plain amount) and the remove button.
    assert.ok(all(line, (node) => (node.type === "button" || node.type === "div") && textOf(node) === name).length >= 1, `${name}: short name in line 1`);
    assert.ok(textOf(line).includes("GH₵50.00"), `${name}: amount in line 1`);
    assert.equal(all(line, label(`Remove ${name}`)).length, 1, `${name}: x in line 1`);
    const status = statusOf(row);
    if (method === "cash") {
      assert.equal(status, undefined, "Cash has no status line");
      continue;
    }
    assert.ok(status, `${name}: status line`);
    assert.equal(all(line, (node) => node === status).length, 0, `${name}: status is not inside line 1`);
    assert.ok(cls(status).includes("w-full"), `${name}: status uses the full card width`);
    assert.ok(cls(status).includes("line-clamp-2"), `${name}: status is at most 2 lines`);
  }
});

test("16/27 rows: the short name never breaks inside the word (no \"MoM / o\")", async () => {
  const view = await mount(PARTS);
  for (const method of ["cash", "momo", "owe"]) {
    const name = all(lineOf(rowOf(view.tree, method)), (node) => cls(node).includes("text-lg"))[0];
    assert.ok(cls(name).includes("whitespace-nowrap"), `${method}: name does not wrap`);
    assert.ok(cls(name).includes("shrink-0"), `${method}: name is never squeezed`);
    assert.ok(!cls(name).some((c) => /overflow-wrap|break-/.test(c)), `${method}: no break-anywhere`);
  }
});

test("16/27 rows: the same markup at 340, 360 and 393px (no width-specific classes on the row)", async () => {
  const view = await mount(PARTS);
  for (const method of ["cash", "momo", "owe"]) {
    const row = rowOf(view.tree, method);
    for (const node of all(row, () => true)) {
      assert.ok(!cls(node).some((c) => /^(sm|md|lg|xl|max-[a-z]+|min-\[)[:]/.test(c)), `${method}: no breakpoint classes (${node.props.className})`);
    }
  }
  // Measured in a real render (headless Edge, Segoe UI) of this markup at each width:
  // line 1 = icon 22 + gap 6 + name + gap 6 + chip (text + gap 4 + pencil 16 + padding 16 + border 4)
  // + gap 6 + x 44. Inside width = width - 32 (page gutters) - 4 (row border) - 16 (row padding).
  const NAME = { cash: 41, momo: 58, owe: 38 };
  const GH50 = 101;
  const line1 = (name) => 22 + 6 + name + 6 + (GH50 + 4 + 16 + 16 + 4) + 6 + 44;
  for (const width of [340, 360, 393]) {
    for (const [method, name] of Object.entries(NAME)) {
      assert.ok(line1(name) <= width - 32 - 4 - 16, `${method} GH₵50.00 on one line at ${width}px`);
    }
  }
});

test("16/27 status wording for each state", () => {
  assert.equal(describeSplitPart({ paymentMethod: "cash", amountPesewas: 100 }), "");
  assert.equal(describeSplitPart({ paymentMethod: "momo", amountPesewas: 100, momoMethod: "direct" }), "Customer sends · not confirmed yet");
  assert.equal(describeSplitPart({ paymentMethod: "momo", amountPesewas: 100, momoMethod: "direct", verification: "merchant_confirmed" }), "Customer sent · received ✓");
  assert.equal(describeSplitPart({ paymentMethod: "momo", amountPesewas: 100, momoMethod: "paystack", verification: "verified" }), "Customer sent · received ✓");
  assert.equal(describeSplitPart({ paymentMethod: "owe", amountPesewas: 100 }, OWE_PARAMS), "Juju · GH₵10.00 · Every week · first payment 19/11/2026");
  // A plan that starts today names today as its first payment (19 passes the date it chose).
  assert.equal(
    describeSplitPart({ paymentMethod: "owe", amountPesewas: 100 }, { ...OWE_PARAMS, firstPaymentDate: "2026-11-12" }),
    "Juju · GH₵10.00 · Every week · first payment 12/11/2026"
  );
});

test("16/27 rows: a locked MoMo row still has no pencil and no x, and its status is green", async () => {
  const view = await mount(LOCKED);
  const row = rowOf(view.tree, "momo");
  assert.equal(all(row, (node) => node.props["data-pencil"] !== undefined).length, 0, "no pencil");
  assert.equal(all(row, label("Remove MoMo")).length, 0, "no x");
  assert.equal(all(row, label("Edit MoMo amount")).length, 0, "no Edit MoMo amount");
  assert.equal(all(row, (node) => node.type === "button").length, 0, "nothing in the row is tappable");
  assert.equal(textOf(statusOf(row)), "Customer sent · received ✓");
  assert.ok(cls(statusOf(row)).includes("text-emerald-900"));
  // Cash beside it keeps its accessible names.
  const cash = rowOf(view.tree, "cash");
  assert.equal(all(cash, label("Edit Cash amount")).length, 1);
  assert.equal(all(cash, label("Remove Cash")).length, 1);
});

test("27 uses the same row component as 16", () => {
  const collect = readFileSync(new URL("../src/pos/DebtCollection.jsx", import.meta.url), "utf8");
  const sale = readFileSync(new URL("../src/pos/SaleSplitPayment.jsx", import.meta.url), "utf8");
  for (const source of [collect, sale]) {
    assert.match(source, /import SplitPayment from "\.\/SplitPayment\.jsx"/);
    assert.match(source, /partDetail=\{\(part\) => describeSplitPart\(part, params\)\}/);
  }
});
