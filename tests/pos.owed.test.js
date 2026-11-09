import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const owedSource = readFileSync(new URL("../src/pos/OwedScreens.jsx", import.meta.url), "utf8");

test("POS Owed screen uses bounded pages and exposes Show more", () => {
  assert.match(owedSource, /loadUnpaidDebtPage/);
  assert.match(owedSource, /const firstPage = useLiveQuery/);
  assert.match(owedSource, /setAdditionalDebts/);
  assert.match(owedSource, /"Show more"/);
  assert.match(owedSource, /onClick=\{\(\) => setFilter\(value\)\}/);
  assert.match(owedSource, /isDebtLate/);
  assert.match(owedSource, /isDebtDueSoon/);
  assert.doesNotMatch(owedSource, /where\("status"\)\.equals\("unpaid"\)\.toArray\(\)/);
});
