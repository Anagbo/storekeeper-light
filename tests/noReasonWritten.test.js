import assert from "node:assert/strict";
import { test } from "node:test";
import { creditRow, proofPages } from "./helpers/proofPages.js";
import { loadJsx, render, setLiveQuery } from "./helpers/renderJsx.js";
import { toHtml } from "./helpers/browserLayout.js";

// Polish 16 Nov 2026: a credit with no reason shows only "No reason written" on 29, 43 and 73 (no "For:",
// no "Reason:", nothing else on that line). On 72 it is the value of the "For" label-value row.

const strip = (html) => html.replace(/<[^>]+>/g, "");

test("29, 43 and 73: the reason line of a credit with no reason is only \"No reason written\"", async () => {
  for (const page of await proofPages([creditRow("c1", 6000, "")])) {
    const lines = [...page.html.matchAll(/<[a-z]+ data-reason=""[^>]*>([\s\S]*?)<\/[a-z]+>/g)].map((match) => strip(match[1]));
    assert.deepEqual(lines, ["No reason written"], `${page.name}: the reason line`);
    assert.doesNotMatch(strip(page.html), /(For|Reason): No reason written/, `${page.name}: no label in front`);
  }
});

test("72: with no reason, For is a label-value row whose value is \"No reason written\"", async () => {
  const { default: CustomerSignature } = await loadJsx("src/pos/CustomerSignature.jsx");
  const event = { id: "t1", type: "sale", paymentType: "credit", customer_name: "Juju", creditExtendedPesewas: 5000, createdAt: Date.now(), items_json: JSON.stringify([{ name: "Sale", quantity: 1 }]) };
  setLiveQuery(() => ({ event, debt: null }));
  let html;
  try {
    html = toHtml(render({ type: CustomerSignature, props: { params: { transactionId: "t1" }, onFinish() {}, shopName: "My shop" } }).tree);
  } finally {
    setLiveQuery(null);
  }
  const forRow = /<div data-sign-detail=""[^>]*><dt[^>]*>([^<]*)<\/dt><dd[^>]*>([^<]*)<\/dd><\/div>/.exec(html);
  assert.ok(forRow, "a label-value row");
  assert.deepEqual([forRow[1], forRow[2]], ["For", "No reason written"]);
  assert.doesNotMatch(strip(html), /For: /);
});
