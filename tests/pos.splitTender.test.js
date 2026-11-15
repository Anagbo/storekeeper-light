import assert from "node:assert/strict";
import test from "node:test";
import { areSplitTenderAmountsComplete, areSplitTenderAmountsValid } from "../src/pos/splitTender.js";

test("sale split accepts partial cash and MoMo amounts for the Owe action", () => {
  assert.equal(areSplitTenderAmountsValid(10000, 3000, 2000), true);
  assert.equal(areSplitTenderAmountsComplete(10000, 3000, 2000), false);
});

test("Done is enabled only when cash and MoMo add up to the sale total", () => {
  assert.equal(areSplitTenderAmountsComplete(10000, 3000, 7000), true);
  assert.equal(areSplitTenderAmountsComplete(10000, 3000, 6000), false);
  assert.equal(areSplitTenderAmountsComplete(10000, 3000, 8000), false);
});

test("collection split requires a positive cash and MoMo part that exactly matches the amount", () => {
  assert.equal(areSplitTenderAmountsComplete(10000, 4000, 6000, true), true);
  assert.equal(areSplitTenderAmountsComplete(10000, 0, 10000, true), false);
  assert.equal(areSplitTenderAmountsComplete(10000, 4000, 5000, true), false);
  assert.equal(areSplitTenderAmountsComplete(10000, 4000, 7000, true), false);
});

test("invalid or unsafe split amounts cannot be recorded", () => {
  assert.equal(areSplitTenderAmountsValid(10000, -1, 10001), false);
  assert.equal(areSplitTenderAmountsValid(10000, Number.MAX_SAFE_INTEGER, 1), false);
  assert.equal(areSplitTenderAmountsComplete(0, 0, 0), false);
});
