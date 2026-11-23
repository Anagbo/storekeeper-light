import assert from "node:assert/strict";
import { test } from "node:test";
import { loadJsx, render, setLiveQuery, walk } from "./helpers/renderJsx.js";

// Wiring 72 + rules_global.soft_tiles (23 Nov 2026): the balance block is the soft tile (fill #F1F5F9,
// no border, no pink), grey "{Name} owes {Shop}" label, amount neutral #0F172A at weight 700, #E2E8F0
// line above the rows. On wide, 72 is drawn inside the shared task column (PosPage with the context).

async function signature() {
  const { default: CustomerSignature } = await loadJsx("src/pos/CustomerSignature.jsx");
  const event = { id: "t1", type: "manual_debt", customer_name: "Ama", creditExtendedPesewas: 12345, createdAt: Date.now(), takenOn: "2026-11-16", note: "Rice" };
  setLiveQuery(() => ({ event, debt: null }));
  try {
    return render({ type: CustomerSignature, props: { params: { transactionId: "t1" }, onFinish() {}, shopName: "Ama Stores" } }).tree;
  } finally {
    setLiveQuery(null);
  }
}
const find = (tree, attr) => [...walk(tree)].find((node) => node.props?.[attr] !== undefined) ?? null;

test("72: the balance block is the soft tile with a neutral amount", async () => {
  const tree = await signature();
  const card = find(tree, "data-sign-card").props.className;
  assert.match(card, /bg-\[#F1F5F9\]/);
  assert.doesNotMatch(card, /FFE4E9|\bborder\b|rose/);
  const amount = find(tree, "data-sign-amount").props.className;
  assert.match(amount, /text-\[#0F172A\]/);
  assert.match(amount, /\bfont-bold\b/);
  assert.doesNotMatch(amount, /rose|extrabold/);
  assert.match(find(tree, "data-sign-details").props.className, /border-\[#E2E8F0\]/);
  assert.equal(find(tree, "data-task-column"), null, "phone: no panel");
});

test("72 is a task column route in PosApp", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("src/pos/PosApp.jsx", "utf8");
  const set = source.slice(source.indexOf("const TASK_COLUMN_ROUTES"), source.indexOf("]);", source.indexOf("const TASK_COLUMN_ROUTES")));
  assert.match(set, /POS_ROUTES\.CustomerSignature\b/);
});
