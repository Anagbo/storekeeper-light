import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadJsx, render, textOf, walk } from "./helpers/renderJsx.js";

// Wiring 18 "Reason on 18" (16 Nov 2026): 19 (A little at a time) shows the reason carried from 18 as
// a read-only "For" row, in a plain credit sale and in a split; no row when there is no reason.

const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx");

function render19(params) {
  const view = render({ type: CreditScreens, props: {
    route: "ALittleAtATime",
    params: { amountPesewas: 800, customer: { name: "Kofi", nameLower: "kofi" }, ...params },
    onBack() {}, onNavigate() {}, onUpdateParams() {}, onReturnToSplit() {}, onSaveCredit() {}
  } });
  const nodes = [...walk(view.tree)];
  const row = nodes.find((node) => node.props?.["data-credit-for"] !== undefined);
  return { row: row ? textOf(row) : null, inputs: nodes.filter((node) => node.type === "input").map((node) => node.props?.id ?? node.props?.["aria-label"]) };
}

test("19: the typed reason is a read-only For row (keypad sale and split)", () => {
  assert.equal(render19({ creditReason: "School fees" }).row, "ForSchool fees");
  const split = render19({ creditReason: "Rice · beans", flow: "split", paymentAlreadyMadeToday: true, initialPaymentPesewas: 300, initialPaymentParts: [{ paymentMethod: "cash", amountPesewas: 300 }] });
  assert.equal(split.row, "ForRice · beans");
  assert.equal(split.inputs.includes("credit-reason"), false, "no field on 19");
});

test("19: items and the 53 note show as the For row too", () => {
  assert.equal(render19({ saleItems: [{ productId: 3, name: "Rice", quantity: 2, unitPricePesewas: 400, total_amount: 800 }] }).row, "ForRice × 2");
  assert.equal(render19({ manualDebt: true, note: "Old fridge" }).row, "ForOld fridge");
});

test("19: no reason, no For row", () => {
  assert.equal(render19({}).row, null);
  assert.equal(render19({ creditReason: "   " }).row, null);
  assert.equal(render19({ manualDebt: true, note: "" }).row, null);
});
