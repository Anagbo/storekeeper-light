import test from "node:test";
import assert from "node:assert/strict";
import { buildCollectionReceiptMessage } from "../src/pos/collectionReceipt.js";

const collection = {
  amountPesewas: 1250,
  remainingPesewas: 875,
  customerName: "Ama Owusu",
  createdAt: Date.parse("2026-03-08T14:05:00"),
  parts: [
    { paymentMethod: "cash", amountPesewas: 500 },
    { paymentMethod: "momo", amountPesewas: 750 }
  ],
  debtAfter: {
    isInstallmentPlan: true,
    installmentAmount: 300,
    nextDueDate: "2026-03-15"
  }
};

test("receipt previews split payments and the next installment without including contact details", () => {
  const message = buildCollectionReceiptMessage(collection, "Ama's Store");

  assert.match(message, /^Payment received by Ama's Store\n08\/03\/2026, 14:05\n/, "24-hour time, not the device language");
  assert.match(message, /\nFrom: Ama Owusu\n/);
  assert.match(message, /\nAmount: GH₵12\.50 \(Cash GH₵5\.00, MoMo GH₵7\.50\)\n/);
  assert.match(message, /\nStill owed: GH₵8\.75\n/);
  assert.match(message, /\nNext payment: GH₵3\.00 on /);
  assert.match(message, /\nThank you!$/);
  assert.doesNotMatch(message, /233|0241234567|Ghana Card/i);
});

test("receipt omits the next-payment line when the debt is not an active installment plan", () => {
  const message = buildCollectionReceiptMessage({
    ...collection,
    debtAfter: { isInstallmentPlan: false }
  }, "Ama's Store");

  assert.doesNotMatch(message, /Next payment:/);
});

test("receipt validates totals", () => {
  assert.throws(() => buildCollectionReceiptMessage({
    ...collection,
    amountPesewas: 1300
  }, "Ama's Store"), /do not match/);
  assert.ok(buildCollectionReceiptMessage(collection, "Ama's Store"));
});
