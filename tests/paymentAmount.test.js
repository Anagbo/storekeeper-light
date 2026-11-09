import assert from "node:assert/strict";
import test from "node:test";
import { getInitialPaymentParts, getMomoAmountPesewas, getPaidPaymentPesewas, getRemainingPaymentPesewas } from "../src/pos/paymentAmount.js";

test("resolves the remaining MoMo amount after split payment parts", () => {
  assert.equal(getRemainingPaymentPesewas({
    amountPesewas: 800,
    splitTotalPesewas: 1000,
    splitParts: [{ paymentMethod: "cash", amountPesewas: 600 }]
  }), 400);
});

test("uses the full amount when no split parts exist", () => {
  assert.equal(getRemainingPaymentPesewas({ amountPesewas: 800 }), 800);
});

test("uses the explicitly entered first MoMo split amount", () => {
  assert.equal(getMomoAmountPesewas({
    amountPesewas: 8800,
    pendingMomoAmountPesewas: 3000
  }), 3000);
});

test("replaces a prior MoMo part instead of duplicating it on retry", () => {
  assert.deepEqual(getInitialPaymentParts({
    splitParts: [
      { paymentMethod: "cash", amountPesewas: 4000 },
      { paymentMethod: "momo", amountPesewas: 2000 }
    ],
    pendingMomoAmountPesewas: 3000,
    momoMethod: "direct",
    verification: "merchant_confirmed"
  }, 10000), [
    { paymentMethod: "cash", amountPesewas: 4000 },
    { paymentMethod: "momo", amountPesewas: 3000, momoMethod: "direct", verification: "merchant_confirmed" }
  ]);
});

test("preserves confirmed Cash, MoMo and Owe parts after saving screen 19", () => {
  const parts = [
    { paymentMethod: "cash", amountPesewas: 2000 },
    { paymentMethod: "momo", amountPesewas: 3000, momoMethod: "direct", verification: "merchant_confirmed" },
    { paymentMethod: "owe", amountPesewas: 5000 }
  ];

  assert.deepEqual(getInitialPaymentParts({
    splitParts: parts,
    momoMethod: "direct"
  }, 10000), parts);
});

test("ignores stale pending MoMo metadata when confirmed parts already equal the total", () => {
  const parts = [
    { paymentMethod: "cash", amountPesewas: 2000 },
    { paymentMethod: "momo", amountPesewas: 3000, momoMethod: "direct", verification: "merchant_confirmed" },
    { paymentMethod: "owe", amountPesewas: 5000 }
  ];

  assert.deepEqual(getInitialPaymentParts({
    splitParts: parts,
    pendingMomoAmountPesewas: 3000,
    momoMethod: "direct",
    verification: "merchant_confirmed"
  }, 10000), parts);
});

test("rejects split parts greater than the total", () => {
  assert.throws(() => getRemainingPaymentPesewas({
    splitTotalPesewas: 1000,
    splitParts: [{ paymentMethod: "cash", amountPesewas: 1100 }]
  }), /cannot exceed/);
});

test("counts Cash and MoMo as paid while leaving Owe as credit", () => {
  const parts = [
    { paymentMethod: "cash", amountPesewas: 2000 },
    { paymentMethod: "momo", amountPesewas: 3000, momoMethod: "direct", verification: "merchant_confirmed" },
    { paymentMethod: "owe", amountPesewas: 5000 }
  ];

  assert.equal(getPaidPaymentPesewas(parts), 5000);
  assert.equal(parts.reduce((total, part) => total + part.amountPesewas, 0), 10000);
});
