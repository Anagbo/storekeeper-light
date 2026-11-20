import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { appCss, browser, measureInFrames } from "./helpers/browserLayout.js";
import { creditRow, proofPages } from "./helpers/proofPages.js";

// Polish 16 Nov 2026: the signed tag is the same pill on 29, 43 and 73. "Signed ✓" green border and light
// green fill, "Not signed" grey border and light grey fill, both with words (never colour alone), 16px bold.

const skip = browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)";

test("29/43 (DebtCollection) and 73 (CustomerRecordView) draw the tag only through SignedTag (in EventRows)", () => {
  const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  assert.match(read("src/pos/EventRows.jsx"), /<SignedTag signed=\{event\.signed\} \/>/, "EventRows uses SignedTag");
  for (const file of ["src/pos/DebtCollection.jsx", "src/pos/CustomerRecordView.jsx", "src/pos/EventRows.jsx"]) {
    assert.doesNotMatch(read(file), /creditRow\.(signed|notSigned)/, `${file} draws no tag of its own`);
  }
  for (const file of ["src/pos/DebtCollection.jsx", "src/pos/CustomerRecordView.jsx"]) {
    assert.match(read(file), /<EventRows\b/, `${file} uses EventRows`);
  }
});

const MEASURE = `(frame, win, doc) => [...doc.querySelectorAll("[data-signed]")].map((el) => {
  const s = win.getComputedStyle(el);
  return { kind: el.dataset.signed, text: el.textContent, size: s.fontSize, weight: s.fontWeight, border: s.borderTopColor, borderWidth: s.borderTopWidth, fill: s.backgroundColor, color: s.color, radius: s.borderTopLeftRadius };
})`;

test("Signed ✓ and Not signed look the same on 29, 43 and 73 at 340, 360 and 393px", { skip }, async () => {
  // The unsigned credit is at or above the signature threshold: a smaller one has no Signature row at all
  // (rules_global.customer_proof.threshold_scope, 17 Nov 2026).
  const pages = await proofPages([creditRow("c1", 6000, "Rice", true), creditRow("c2", 5000, "School fees", false)]);
  const results = measureInFrames({ pages, css: await appCss(), widths: [340, 360, 393], height: 2000, measure: `(f, w, d) => ({ tags: (${MEASURE})(f, w, d) })` });
  assert.equal(results.length, 9);
  const reference = {};
  for (const result of results) {
    const where = `${result.page} at ${result.width}px`;
    assert.deepEqual(result.tags.map((tag) => tag.kind), ["yes", "no"], `${where}: one signed and one unsigned tag`);
    for (const tag of result.tags) {
      assert.equal(tag.text, tag.kind === "yes" ? "Signed ✓" : "Not signed", `${where}: the tag has words`);
      assert.equal(tag.size, "16px", `${where}: ${tag.text} is 16px`);
      assert.equal(tag.weight, "700", `${where}: ${tag.text} is bold`);
      assert.equal(tag.borderWidth, "2px", `${where}: ${tag.text} has a border (a pill, not plain text)`);
      assert.notEqual(tag.fill, "rgba(0, 0, 0, 0)", `${where}: ${tag.text} has a fill`);
      reference[tag.kind] ??= tag;
      const { border, fill, color, radius } = reference[tag.kind];
      assert.deepEqual({ border: tag.border, fill: tag.fill, color: tag.color, radius: tag.radius }, { border, fill, color, radius }, `${where}: ${tag.text} is the same pill everywhere`);
    }
  }
  // Green for Signed, grey for Not signed (Tailwind 4 colours come back as oklch(lightness chroma hue)).
  const oklch = (value) => {
    const match = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(value);
    assert.ok(match, `an oklch colour (${value})`);
    return { l: Number(match[1]), c: Number(match[2]), h: Number(match[3]) };
  };
  for (const part of ["border", "fill"]) {
    const green = oklch(reference.yes[part]);
    assert.ok(green.c > 0.03 && green.h >= 120 && green.h <= 180, `Signed ${part} is green (${reference.yes[part]})`);
    assert.ok(oklch(reference.no[part]).c < 0.05, `Not signed ${part} is grey (${reference.no[part]})`);
  }
  assert.ok(oklch(reference.yes.fill).l > 0.9 && oklch(reference.no.fill).l > 0.9, "both fills are light");
});
