import assert from "node:assert/strict";
import { test } from "node:test";
import { getDebtorItemDescription } from "../src/utils/debtorItemDescription.js";

test("returns a usable item description for credit history events", () => {
  assert.equal(
    getDebtorItemDescription({ type: "credit", detail: "Rice 5kg" }),
    "Rice 5kg"
  );
});

test("returns no description for generated or missing legacy details", () => {
  assert.equal(getDebtorItemDescription({ type: "credit", detail: "Credit extended" }), "");
  assert.equal(getDebtorItemDescription({ type: "addon", detail: "Debt add-on" }), "");
  assert.equal(getDebtorItemDescription({ type: "credit", detail: null }), "");
  assert.equal(getDebtorItemDescription({ type: "payment", detail: "Rice" }), "");
});
