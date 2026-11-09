import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const correctionSurfaces = [
  "src/pos/DebtCollection.jsx",
  "src/components/DebtLedger.jsx"
];

test("both correction surfaces expose the safe screen 54 contract", async () => {
  const sources = await Promise.all(correctionSurfaces.map((path) => readFile(path, "utf8")));

  for (const source of sources) {
    assert.match(source, /now owed/i);
    assert.match(source, /This lowers the debt by/);
    assert.match(source, /Corrections cannot increase debt\. Use Add to debt\./);
    assert.match(source, /No cash moves\. Use Collect for money received\./);
    assert.match(source, /disabled=\{[^}]*(!correctionCanSave|!editedBalanceValid)/);
    assert.match(source, /wrong_amount/);
    assert.match(source, /customer_dispute/);
    assert.match(source, /returned_goods/);
    assert.match(source, /debt_forgiven/);
    assert.match(source, /other/);
    assert.match(source, /w-full/);
    assert.match(source, /overflow-y-auto/);
  }

  assert.doesNotMatch(sources[0], /onClick=\{openCorrection\}/);
  assert.match(sources[0], /onClick=\{\(\) => openCorrection\(\)\}/);
  assert.match(sources[0], /Open debt entries/);
  assert.match(sources[0], /Correct this entry/);
  assert.match(sources[0], /unpaidDebts/);
});
