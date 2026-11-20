import assert from "node:assert/strict";
import { test } from "node:test";
import { creditRow, proofPages } from "./helpers/proofPages.js";

// rules_global.customer_proof.threshold_scope (decided 17 Nov 2026), item 0b: on 29, 43 and 73 a credit
// event shows the Signature row only when it is signed or its own amount is at or above the signature
// threshold (default GH₵50.00). A small credit that was never signed has Time and Reason only and no Get
// signature. A signed event always shows "Signed ✓".

// Each credit card of the static page: the labels of its rows, its tag and whether Get signature is there.
function creditCards(html) {
  const cards = html.split('data-record-row="credit"').slice(1).map((chunk) => chunk.split("data-record-row=")[0]);
  return cards.map((card) => ({
    labels: [...card.matchAll(/data-event-detail="([^"]+)"/g)].map((match) => match[1]),
    tag: card.includes('data-signed="yes"') ? "Signed ✓" : card.includes('data-signed="no"') ? "Not signed" : null,
    getSignature: card.includes("Get signature")
  }));
}

test("29, 43, 73: GH₵8.00 unsigned has no Signature row; GH₵50.00 unsigned has the tag (and Get signature on 29/43); a signed small credit shows Signed ✓", async () => {
  const pages = await proofPages([
    creditRow("small", 800, "Bread", false),
    creditRow("big", 5000, "Rice", false),
    creditRow("signedSmall", 800, "Sugar", true)
  ]);
  assert.deepEqual(pages.map((page) => page.name), ["29", "43", "73"]);
  for (const page of pages) {
    const [small, big, signedSmall] = creditCards(page.html);
    assert.deepEqual(small, { labels: ["time", "reason"], tag: null, getSignature: false }, `${page.name}: GH₵8.00 never signed`);
    assert.deepEqual(big.labels, ["time", "reason", "signature"], `${page.name}: GH₵50.00 unsigned has the Signature row`);
    assert.equal(big.tag, "Not signed", `${page.name}: GH₵50.00 tag`);
    assert.equal(big.getSignature, page.name !== "73", `${page.name}: Get signature on 29/43 only`);
    assert.deepEqual(signedSmall, { labels: ["time", "reason", "signature"], tag: "Signed ✓", getSignature: false }, `${page.name}: signed small credit`);
  }
});
