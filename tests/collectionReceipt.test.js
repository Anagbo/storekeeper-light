import test from "node:test";
import assert from "node:assert/strict";
import { buildCollectionReceiptLink, buildCollectionReceiptMessage } from "../src/pos/collectionReceipt.js";

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

  assert.match(message, /^Payment received by Ama's Store\n/);
  assert.match(message, /\nFrom: Ama Owusu\n/);
  assert.match(message, /\nAmount: GHS 12\.50 \(Cash GHS 5\.00, MoMo GHS 7\.50\)\n/);
  assert.match(message, /\nStill owed: GHS 8\.75\n/);
  assert.match(message, /\nNext payment: GHS 3\.00 on /);
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

test("receipt validates totals and creates a WhatsApp link only for a valid Ghana mobile number", () => {
  assert.throws(() => buildCollectionReceiptMessage({
    ...collection,
    amountPesewas: 1300
  }, "Ama's Store"), /do not match/);

  const message = buildCollectionReceiptMessage(collection, "Ama's Store");
  const link = buildCollectionReceiptLink("024 123 4567", message);
  assert.match(link, /^https:\/\/wa\.me\/233241234567\?text=/);
  assert.equal(decodeURIComponent(link.split("?text=")[1]), message);
  assert.equal(buildCollectionReceiptLink("not a phone", message), null);
});
