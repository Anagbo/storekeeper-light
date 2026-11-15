import test from "node:test";
import assert from "node:assert/strict";
import { COLLECTION_UNDO_WINDOW_MS, normalizeCollectionParts } from "../src/db/debts.js";
import { getDefaultCollectionSplit } from "../src/pos/collectionSplit.js";
import { normalizeTypedAmount, pressAmountKey } from "../src/pos/amountKeypad.js";

test("collection parts preserve each payment method and reconcile to one total", () => {
  const result = normalizeCollectionParts([
    { paymentMethod: "cash", amountPesewas: 1250 },
    { paymentMethod: "momo", amountPesewas: 2750 }
  ]);

  assert.deepEqual(result, {
    normalizedParts: [
      { paymentMethod: "cash", amountPesewas: 1250 },
      { paymentMethod: "momo", amountPesewas: 2750 }
    ],
    totalPesewas: 4000
  });
  assert.equal(COLLECTION_UNDO_WINDOW_MS, 10_000);
});

test("collection parts reject empty, invalid, and overflowing totals", () => {
  assert.throws(() => normalizeCollectionParts([]), /at least one payment part/);
  assert.throws(() => normalizeCollectionParts([{ paymentMethod: "cash", amountPesewas: 0 }]), /positive amount/);
  assert.throws(() => normalizeCollectionParts([{ paymentMethod: "cheque", amountPesewas: 100 }]), /valid payment method/);
  assert.throws(() => normalizeCollectionParts([
    { paymentMethod: "cash", amountPesewas: Number.MAX_SAFE_INTEGER },
    { paymentMethod: "momo", amountPesewas: 1 }
  ]), /supported amount/);
});

test("split collection defaults to cash first and allocates the remainder to MoMo", () => {
  const parts = getDefaultCollectionSplit(1000, 600);

  assert.deepEqual(parts, [
    { paymentMethod: "cash", amountPesewas: 600 },
    { paymentMethod: "momo", amountPesewas: 400 }
  ]);
  assert.equal(parts.reduce((sum, part) => sum + part.amountPesewas, 0), 1000);
});

test("split collection is incomplete until both cash and MoMo have a positive share", () => {
  assert.deepEqual(getDefaultCollectionSplit(1000, 0), []);
  assert.deepEqual(getDefaultCollectionSplit(1000, 1000), []);
  assert.deepEqual(getDefaultCollectionSplit(1000, 1200), []);
  assert.throws(() => getDefaultCollectionSplit(1, 0), /at least two pesewas/);
});

// 26 has no typed field any more (15 Nov 2026); typed amounts elsewhere (44) use normalizeTypedAmount.
test("cash amount on the keypad, and typed amount text, follow the same rules", () => {
  const keypadAmount = ["6", ".", "5", "0"].reduce((text, key) => pressAmountKey(text, key), "");
  assert.equal(keypadAmount, "6.50");
  assert.equal(normalizeTypedAmount("6.50"), "6.50");
  assert.equal(normalizeTypedAmount("GHS 6,50"), "6.50");
  assert.equal(normalizeTypedAmount("6.500", "6.50"), "6.50");
  assert.equal(pressAmountKey(keypadAmount, "Delete"), "6.5");
});
