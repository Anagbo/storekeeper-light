import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Screen 25 and the other debt screens: the Loading debt details state is a soft grey tile (#F1F5F9),
// and the loading tile itself has no pink, red or mint fill.
const source = readFileSync(new URL("../src/pos/DebtCollection.jsx", import.meta.url), "utf8");
const soft = readFileSync(new URL("../src/pos/softTile.js", import.meta.url), "utf8");

test("the loading state is one grey tile with no pink or mint fill", () => {
  const start = source.indexOf("function CollectionLoading");
  assert.ok(start > 0, "CollectionLoading exists");
  const tile = source.slice(start, source.indexOf("\n}", start));
  assert.match(tile, /SOFT_TILE/);
  assert.match(soft, /bg-\[#F1F5F9\]/);
  assert.doesNotMatch(tile, /(bg|border)-(red|rose|pink|green|emerald|teal)-/);
  assert.equal(source.includes('<p role="status">{t("collect.loading")}</p>'), false, "no plain loading line is left");
});
