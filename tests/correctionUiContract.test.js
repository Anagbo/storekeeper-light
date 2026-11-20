import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const correctionSurfaces = [
  "src/pos/DebtCollection.jsx"
];

test("the correction surface (DebtCollection) exposes the safe screen 54 contract", async () => {
  const sources = await Promise.all(correctionSurfaces.map((path) => readFile(path, "utf8")));

  for (const source of sources) {
    // Sheet header (20 Nov 2026): the name is the title and "Now owed" is a key-value row under it.
    assert.match(source, /<h2 id="pos-correction-title"[^>]*>\{displayName\(data\.name\)\}<\/h2>/);
    assert.match(source, /label=\{t\("kv\.nowOwed"\)\} name="now-owed">\{formatGhs\(correctionCurrentBalancePesewas\)\}/);
    assert.doesNotMatch(source, /· now owed/);
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
