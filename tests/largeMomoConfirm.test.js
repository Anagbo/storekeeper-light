import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { findButton, findComponent, loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Brief 3.12 follow-up: a MoMo amount above the limit is confirmed BEFORE it goes to 61 (before
// the customer is asked to pay), never at "Money received" on 62. Same dialog and limit; the
// wording for a MoMo amount is "This MoMo payment is GH₵{amount}. Is the amount right?".
const LIMIT = 100000;
const tick = () => new Promise((resolve) => setImmediate(resolve));

function findDialog(tree) {
  for (const node of walk(tree)) if (node.props?.role === "alertdialog") return node;
  return null;
}
function dialogButton(tree, label) {
  const dialog = findDialog(tree);
  return dialog ? findButton(dialog, label) : null;
}
// The tile whose whole text is the label (the MoMo tile, not a row that mentions MoMo).
function tile(tree, label) {
  let found = null;
  for (const node of walk(tree)) if (node.type === "button" && textOf(node).trim() === label) found = node;
  return found;
}
function openCount(tree) {
  let count = 0;
  for (const node of walk(tree)) if (node.props?.role === "alertdialog") count += 1;
  return count;
}
function inputValue(tree) {
  for (const node of walk(tree)) if (node.type === "input" && node.props.id === "split-draft-amount") return node.props.value;
  return null;
}

// ---- 15 and 55: the MoMo tile --------------------------------------------------------------

test("3.12 MoMo on 15: exactly the limit goes straight to 61", async () => {
  const { default: Sell } = await loadJsx("src/pos/Sell.jsx");
  const navigations = [];
  const view = render({ type: Sell, props: { params: { amountPesewas: LIMIT }, onNavigate: (...args) => navigations.push(args), recordSale: async () => ({}) } });
  tile(view.tree, "MoMo").props.onClick();
  assert.deepEqual(navigations.map((entry) => entry[0]), ["MoMoChoice"]);
  assert.equal(findDialog(view.rerender().tree), null);
});

test("3.12 MoMo on 15: one pesewa above asks about the MoMo payment before 61; Change amount keeps the entry; Yes, save goes to 61 once", async () => {
  const { default: Sell } = await loadJsx("src/pos/Sell.jsx");
  const navigations = [];
  const view = render({ type: Sell, props: { params: { amountPesewas: LIMIT + 1 }, onNavigate: (...args) => navigations.push(args), recordSale: async () => ({}) } });
  const momo = tile(view.tree, "MoMo");
  momo.props.onClick();
  momo.props.onClick();
  assert.equal(navigations.length, 0, "61 is not opened yet");
  view.rerender();
  assert.equal(openCount(view.tree), 1, "one dialog, not two");
  const dialog = findDialog(view.tree);
  assert.match(textOf(dialog), /Large amount/);
  assert.match(textOf(dialog), /This MoMo payment is GH₵1,000\.01\. Is the amount right\?/);
  assert.equal(dialogButton(view.tree, "Change amount").props.autoFocus, true);

  dialogButton(view.tree, "Change amount").props.onClick();
  view.rerender();
  assert.equal(findDialog(view.tree), null);
  assert.equal(navigations.length, 0);
  assert.match(textOf(view.tree), /GH₵1,000\.01/, "the amount is kept");

  tile(view.tree, "MoMo").props.onClick();
  view.rerender();
  const yes = dialogButton(view.tree, "Yes, save");
  yes.props.onClick();
  yes.props.onClick();
  assert.equal(navigations.length, 1);
  assert.equal(navigations[0][0], "MoMoChoice");
  assert.equal(navigations[0][1].amountPesewas, LIMIT + 1);
});

test("3.12 MoMo on 15: Done (cash) still asks about the whole sale with the sale wording", async () => {
  const { default: Sell } = await loadJsx("src/pos/Sell.jsx");
  const view = render({ type: Sell, props: { params: { amountPesewas: LIMIT + 1 }, onNavigate() {}, recordSale: async () => ({}) } });
  findButton(view.tree, "Done").props.onClick();
  const dialog = findDialog(view.rerender().tree);
  assert.match(textOf(dialog), /This sale is GH₵1,000\.01\. Is the amount right\?/);
  assert.doesNotMatch(textOf(dialog), /MoMo payment/);
});

test("3.12 MoMo on 55: exactly the limit goes to 61; one pesewa above asks first", async () => {
  const { default: ReviewAndPay } = await loadJsx("src/pos/ReviewAndPay.jsx");
  const cart = (total) => [{ productId: 1, name: "Rice", quantity: 1, unitPricePesewas: total }];
  const mount = (total) => {
    const navigations = [];
    const view = render({ type: ReviewAndPay, props: { params: { saleItems: cart(total) }, onSaveSale: async () => {}, onBack() {}, onNavigate: (...args) => navigations.push(args) } });
    return { view, navigations };
  };
  const exact = mount(LIMIT);
  tile(exact.view.tree, "MoMo").props.onClick();
  assert.equal(exact.navigations.length, 1);
  assert.equal(findDialog(exact.view.rerender().tree), null);

  const above = mount(LIMIT + 1);
  const momo = tile(above.view.tree, "MoMo");
  momo.props.onClick();
  momo.props.onClick();
  assert.equal(above.navigations.length, 0);
  above.view.rerender();
  assert.equal(openCount(above.view.tree), 1);
  assert.match(textOf(findDialog(above.view.tree)), /This MoMo payment is GH₵1,000\.01\. Is the amount right\?/);
  dialogButton(above.view.tree, "Change amount").props.onClick();
  above.view.rerender();
  assert.equal(above.navigations.length, 0);
  assert.equal(findDialog(above.view.tree), null);
  tile(above.view.tree, "MoMo").props.onClick();
  above.view.rerender();
  dialogButton(above.view.tree, "Yes, save").props.onClick();
  assert.equal(above.navigations.length, 1);
  assert.equal(above.navigations[0][0], "MoMoChoice");
  assert.equal(above.navigations[0][1].amountPesewas, LIMIT + 1);
});

// ---- the "How much MoMo?" editor on 16, 27 and 27 from 19 ------------------------------------

async function mountSale16(totalPesewas, extra = {}) {
  const { default: SaleSplitPayment } = await loadJsx("src/pos/SaleSplitPayment.jsx");
  const navigations = [];
  const saves = [];
  const view = render({ type: SaleSplitPayment, props: { params: { amountPesewas: totalPesewas }, onSaveSale: async (details) => { saves.push(details); }, onBack() {}, onNavigate: (...args) => navigations.push(args), ...extra } });
  return { view, navigations, saves };
}
function openMomoEditor(view) {
  tile(view.tree, "MoMo").props.onClick();
  view.rerender();
}
function saveEditor(view) {
  findButton(view.tree, "Save").props.onClick();
  return view.rerender();
}

test("3.12 MoMo editor on 16: exactly the limit goes to 61 with no dialog", async () => {
  const { view, navigations } = await mountSale16(LIMIT);
  openMomoEditor(view);
  assert.equal(inputValue(view.tree), "1000.00");
  saveEditor(view);
  assert.equal(navigations.length, 1);
  assert.equal(navigations[0][0], "MoMoChoice");
  assert.equal(navigations[0][1].pendingMomoAmountPesewas, LIMIT);
  assert.equal(findDialog(view.tree), null);
});

test("3.12 MoMo editor on 16: one pesewa above asks before 61; Change amount keeps the editor and its entry; Yes, save goes once", async () => {
  const { view, navigations } = await mountSale16(LIMIT + 1);
  openMomoEditor(view);
  assert.equal(inputValue(view.tree), "1000.01");
  const save = findButton(view.tree, "Save");
  save.props.onClick();
  save.props.onClick();
  view.rerender();
  assert.equal(navigations.length, 0);
  assert.equal(openCount(view.tree), 1);
  assert.match(textOf(findDialog(view.tree)), /This MoMo payment is GH₵1,000\.01\. Is the amount right\?/);

  dialogButton(view.tree, "Change amount").props.onClick();
  view.rerender();
  assert.equal(findDialog(view.tree), null);
  assert.equal(navigations.length, 0);
  assert.equal(inputValue(view.tree), "1000.01", "the editor is still open with the same entry");

  saveEditor(view);
  assert.equal(openCount(view.tree), 1, "Save asks again");
  const yes = dialogButton(view.tree, "Yes, save");
  yes.props.onClick();
  yes.props.onClick();
  assert.equal(navigations.length, 1);
  assert.equal(navigations[0][1].pendingMomoAmountPesewas, LIMIT + 1);
});

test("3.12 MoMo editor: the amount asked about is the MoMo amount typed, not the sale total", async () => {
  const { view, navigations } = await mountSale16(300000);
  openMomoEditor(view);
  // A MoMo part at the limit: no dialog even though the sale total is above it.
  for (const node of walk(view.tree)) if (node.type === "input" && node.props.id === "split-draft-amount") node.props.onChange({ target: { value: "1000.00" } });
  view.rerender();
  saveEditor(view);
  assert.equal(navigations.length, 1);
  assert.equal(navigations[0][1].pendingMomoAmountPesewas, LIMIT);
  assert.equal(findDialog(view.tree), null);
});

test("3.12 split: MoMo part above the limit asks once at the editor; Done asks once more about the sale total only when the total is above the limit", async () => {
  // Total above the limit, MoMo part above the limit: one MoMo ask, then (back from 62) one sale ask at Done.
  const big = await mountSale16(250000);
  openMomoEditor(big.view);
  saveEditor(big.view);
  assert.equal(openCount(big.view.tree), 1);
  assert.match(textOf(findDialog(big.view.tree)), /This MoMo payment is GH₵2,500\.00\./);
  dialogButton(big.view.tree, "Yes, save").props.onClick();
  assert.equal(big.navigations.length, 1);
  const parts = [{ paymentMethod: "momo", amountPesewas: 250000, verification: "merchant_confirmed" }];
  findComponent(big.view.rerender().tree, "SplitPayment").props.onDone(parts);
  big.view.rerender();
  assert.equal(openCount(big.view.tree), 1);
  assert.match(textOf(findDialog(big.view.tree)), /This sale is GH₵2,500\.00\./);
  dialogButton(big.view.tree, "Yes, save").props.onClick();
  await tick();
  assert.equal(big.saves.length, 1);

  // Total above the limit, MoMo part at or below it: no MoMo ask, one sale ask at Done.
  const mixed = await mountSale16(150000);
  openMomoEditor(mixed.view);
  for (const node of walk(mixed.view.tree)) if (node.type === "input" && node.props.id === "split-draft-amount") node.props.onChange({ target: { value: "500.00" } });
  mixed.view.rerender();
  saveEditor(mixed.view);
  assert.equal(mixed.navigations.length, 1, "goes to 61 with no dialog");
  assert.equal(findDialog(mixed.view.tree), null);
  findComponent(mixed.view.rerender().tree, "SplitPayment").props.onDone([
    { paymentMethod: "cash", amountPesewas: 100000 },
    { paymentMethod: "momo", amountPesewas: 50000, verification: "merchant_confirmed" }
  ]);
  mixed.view.rerender();
  assert.equal(openCount(mixed.view.tree), 1);
  assert.match(textOf(findDialog(mixed.view.tree)), /This sale is GH₵1,500\.00\./);

  // Total at the limit with a MoMo part at the limit: one MoMo ask-free trip and no Done ask.
  const small = await mountSale16(LIMIT);
  openMomoEditor(small.view);
  saveEditor(small.view);
  assert.equal(small.navigations.length, 1);
  findComponent(small.view.rerender().tree, "SplitPayment").props.onDone([{ paymentMethod: "momo", amountPesewas: LIMIT, verification: "merchant_confirmed" }]);
  await tick();
  assert.equal(small.saves.length, 1);
  assert.equal(findDialog(small.view.rerender().tree), null);
});

test("3.12 MoMo editor on 27 (collect split): above the limit asks before 61; at the limit does not", async () => {
  const { CollectSplitPayment } = await loadJsx("src/pos/DebtCollection.jsx");
  const debt = { id: "d1", amountPesewas: 500000, customerName: "Ama", status: "unpaid" };
  const mount = (amount) => {
    const navigations = [];
    setLiveQuery(([debtId]) => (debtId === "d1" ? debt : undefined));
    const view = render({ type: CollectSplitPayment, props: { params: { debtId: "d1", amount }, onRecordCollection: async () => {}, onBack() {}, onNavigate: (...args) => navigations.push(args) } });
    return { view, navigations };
  };
  try {
  const exact = mount("1000.00");
  openMomoEditor(exact.view);
  saveEditor(exact.view);
  assert.equal(exact.navigations.length, 1);
  assert.equal(findDialog(exact.view.tree), null);

  const above = mount("1000.01");
  openMomoEditor(above.view);
  saveEditor(above.view);
  assert.equal(above.navigations.length, 0);
  assert.match(textOf(findDialog(above.view.tree)), /This MoMo payment is GH₵1,000\.01\. Is the amount right\?/);
  dialogButton(above.view.tree, "Change amount").props.onClick();
  above.view.rerender();
  assert.equal(inputValue(above.view.tree), "1000.01");
  assert.equal(above.navigations.length, 0);
  saveEditor(above.view);
  dialogButton(above.view.tree, "Yes, save").props.onClick();
  assert.equal(above.navigations.length, 1);
  assert.equal(above.navigations[0][0], "MoMoChoice");
  } finally {
    setLiveQuery(null);
  }
});

test("3.12 MoMo editor on 27 from 19 (payment today split): above the limit asks before 61", async () => {
  const { default: InstallmentSplitPayment } = await loadJsx("src/pos/InstallmentSplitPayment.jsx");
  const navigations = [];
  const view = render({ type: InstallmentSplitPayment, props: { params: { todayPaymentAmount: "1000.01" }, onBack() {}, onReturnTo() {}, onUpdateParams() {}, onNavigate: (...args) => navigations.push(args) } });
  openMomoEditor(view);
  saveEditor(view);
  assert.equal(navigations.length, 0);
  assert.match(textOf(findDialog(view.tree)), /This MoMo payment is GH₵1,000\.01\./);
  dialogButton(view.tree, "Yes, save").props.onClick();
  assert.equal(navigations.length, 1);
  assert.equal(navigations[0][1].pendingMomoAmountPesewas, LIMIT + 1);
});

test("3.12 MoMo on 19: the payment-today MoMo choice asks before 61 when the amount is above the limit", async () => {
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx");
  const mount = (today) => {
    const navigations = [];
    const params = { amountPesewas: 500000, customer: { name: "Ama", totalDebtPesewas: 0 }, installmentAmount: "100", frequency: "weekly", startToday: true, todayPaymentAmount: today };
    const view = render({ type: CreditScreens, props: { route: "ALittleAtATime", params, onSaveCredit: async () => {}, onBack() {}, onNavigate: (...args) => navigations.push(args), onReturnToSplit() {}, onUpdateParams() {} } });
    return { view, navigations };
  };
  const exact = mount("1000.00");
  tile(exact.view.tree, "MoMo").props.onClick();
  assert.equal(exact.navigations.length, 1);
  assert.equal(findDialog(exact.view.rerender().tree), null);

  const above = mount("1000.01");
  tile(above.view.tree, "MoMo").props.onClick();
  assert.equal(above.navigations.length, 0);
  above.view.rerender();
  assert.match(textOf(findDialog(above.view.tree)), /This MoMo payment is GH₵1,000\.01\./);
  dialogButton(above.view.tree, "Yes, save").props.onClick();
  assert.equal(above.navigations.length, 1);
  assert.equal(above.navigations[0][0], "MoMoChoice");
});

// ---- 62 does not ask again ----------------------------------------------------------------

test("3.12 on 62 (Money received): no dialog and no large-amount code, the ask is before 61", async () => {
  const source = readFileSync(new URL("../src/pos/MoMoScreens.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /LargeAmountConfirm|largeAmount|isLargeAmount/);
  const { MoMoDirect } = await loadJsx("src/pos/MoMoScreens.jsx");
  const confirmed = [];
  const view = render({ type: MoMoDirect, props: { params: { amountPesewas: LIMIT * 50 }, onBack() {}, onConfirm: async (details) => { confirmed.push(details); }, onPick() {} } });
  assert.equal(findDialog(view.tree), null);
});

test("3.12: the wording comes from the strings file", async () => {
  const { posText } = await import("../src/pos/i18n.js");
  assert.equal(posText("largeAmount.momoBody", { amount: "GH₵1,000.01" }), "This MoMo payment is GH₵1,000.01. Is the amount right?");
});
