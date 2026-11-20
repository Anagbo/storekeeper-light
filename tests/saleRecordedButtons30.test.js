import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { flushEffects, loadJsx, render, textOf, walk } from "./helpers/renderJsx.js";

// Wiring 30, "Buttons on 30" (decided 17 Nov 2026): all stacked, full width, one above the other, never two
// side by side. Top to bottom: Send receipt (other look with the WhatsApp icon, not green outline), the
// offline line (offline only), Copy receipt (other), Done (other), New sale (main). Receipt buttons only with
// the receipts flag on. "Owe line on 30" (final, 17 Nov 2026): the last row of the sale card, label
// "{Name} owes" (name cut at 10 characters with an ellipsis) over a small grey "from this sale", the amount
// bold dark red on the right.

const ON = { VITE_ENABLE_POS_RECEIPTS: "true" };
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const realWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  Object.defineProperty(globalThis, "navigator", realNavigator);
  if (realWindow) Object.defineProperty(globalThis, "window", realWindow);
  else delete globalThis.window;
});
function setOnline(onLine) {
  Object.defineProperty(globalThis, "navigator", { value: { onLine, userAgent: "Mozilla/5.0 (Linux; Android 13) Mobile", share: async () => {} }, configurable: true });
  Object.defineProperty(globalThis, "window", { value: new EventTarget(), configurable: true });
}

const sale = (extra = {}) => ({
  id: "s1", amountPesewas: 800, total_amount: 800, payment_method: "cash", cashReceivedPesewas: 300, momoReceivedPesewas: 0,
  paymentType: "credit", customer_name: "Juju", customerName: "Juju", creditExtendedPesewas: 500,
  items_json: JSON.stringify([{ name: "Sale", quantity: 1, total_amount: 800 }]), timestamp: Date.now(), ...extra
});

async function show(env, transaction = sale()) {
  const { default: SaleRecorded } = await loadJsx("src/pos/SaleRecorded.jsx", env);
  const view = render({ type: SaleRecorded, props: { transaction, shopName: "Shop", onDone() {}, onNewSale() {} } });
  flushEffects(view);
  return view;
}
const nodes = (tree) => [...walk(tree)].filter((node) => node.props);
const cls = (node) => String(node.props.className ?? "");
const buttons = (tree) => nodes(tree).filter((node) => node.type === "button");

test("30, receipts on, offline: Send receipt, offline line, Copy receipt, Done, New sale, stacked full width", async () => {
  setOnline(false);
  const view = await show(ON);
  const all = nodes(view.tree);
  const order = all.filter((node) => node.type === "button" || node.props["data-receipt-offline"] !== undefined)
    .map((node) => (node.type === "button" ? textOf(node).trim() : "offline line"));
  assert.deepEqual(order, ["Send receipt", "offline line", "Copy receipt", "Done", "New sale"]);
  for (const button of buttons(view.tree)) {
    const name = textOf(button).trim();
    assert.match(cls(button), /(^|\s)w-full(\s|$)/, `${name}: full width`);
    assert.equal(button.props["data-look"], name === "New sale" ? "main" : "other", `${name}: its look`);
    if (name !== "New sale") assert.doesNotMatch(cls(button), /border-emerald/, `${name}: not green outline`);
  }
  const send = buttons(view.tree).find((node) => textOf(node).trim() === "Send receipt");
  assert.ok([...walk(send)].some((node) => node.type === "svg"), "Send receipt keeps the WhatsApp icon");
  // Never two side by side: no grid with two columns holds any of the buttons.
  assert.equal(all.filter((node) => /grid-cols-2/.test(cls(node))).length, 0);
});

test("30: the check circle is 80px (h-20 w-20) on the receipt and on the Sale saved fallback", async () => {
  setOnline(true);
  const circles = (tree) => nodes(tree).filter((node) => node.props["data-check-circle"] !== undefined);
  const receipt = circles((await show({})).tree);
  const { default: SaleRecorded } = await loadJsx("src/pos/SaleRecorded.jsx", {});
  const quiet = console.warn; console.warn = () => {};
  let fallback;
  try { fallback = circles(render({ type: SaleRecorded, props: { transaction: { id: "bad" }, shopName: "Shop", onDone() {}, onNewSale() {} } }).tree); } finally { console.warn = quiet; }
  for (const [where, found] of [["receipt", receipt], ["fallback", fallback]]) {
    assert.equal(found.length, 1, `${where}: one circle`);
    assert.match(cls(found[0]), /(^|\s)h-20 w-20(\s|$)/, `${where}: 80px`);
  }
});

test("30, receipts off: only Done (other) and New sale (main)", async () => {
  setOnline(false);
  const view = await show({});
  assert.deepEqual(buttons(view.tree).map((node) => [textOf(node).trim(), node.props["data-look"]]), [["Done", "other"], ["New sale", "main"]]);
  assert.doesNotMatch(textOf(view.tree), /You are offline|Copy receipt|Send receipt/);
});

test("30: the owe row is the last row of the sale card: label, small grey line, amount bold dark red", async () => {
  setOnline(true);
  const view = await show({});
  const row = nodes(view.tree).find((node) => node.props["data-owe-row"] !== undefined);
  assert.ok(row, "the owe row");
  const part = (name) => nodes(row).find((node) => node.props[name] !== undefined);
  assert.equal(textOf(part("data-owe-label")), "Juju owes");
  assert.match(cls(part("data-owe-label")), /whitespace-nowrap/, "one line");
  assert.equal(textOf(part("data-owe-sub")), "from this sale");
  assert.match(cls(part("data-owe-sub")), /text-sm text-slate-700/, "14px grey");
  assert.equal(textOf(part("data-owe-amount")), "GH₵5.00");
  assert.equal(part("data-owe-amount").type, "strong");
  assert.match(cls(part("data-owe-amount")), /text-rose-900/);
  assert.match(cls(row), /items-center/, "the amount is centred against the two lines");
  assert.doesNotMatch(textOf(view.tree), /owes GH₵|still owes/, "the old sentence is gone");
  // A long name is cut at 10 characters with an ellipsis.
  const long = await show({}, sale({ customer_name: "Nana Akosua Frimpomaa", customerName: "Nana Akosua Frimpomaa" }));
  assert.equal(textOf(nodes(long.tree).find((node) => node.props["data-owe-label"] !== undefined)), "Nana Akosu… owes");
});
