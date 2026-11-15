import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { findButton, findComponent, loadJsx, render, textOf, walk } from "./helpers/renderJsx.js";

// Brief 3.12 and wiring global rule large_amount_confirm: a sale above the limit asks
// "This sale is GH₵{amount}. Is the amount right?" before anything is saved.
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
function recorder() {
  const calls = [];
  const save = async (details) => { calls.push(details); return { id: "t1", ...details }; };
  return { calls, save };
}

// ---- the setting -----------------------------------------------------------------------

test("3.12: the limit is a positive whole number of pesewas; anything else uses 100000", async () => {
  const { parseLargeAmountLimit, DEFAULT_LARGE_AMOUNT_CONFIRM_PESEWAS } = await import("../src/pos/largeAmount.js");
  assert.equal(DEFAULT_LARGE_AMOUNT_CONFIRM_PESEWAS, LIMIT);
  for (const bad of [undefined, null, "", "  ", "abc", "0", "-5", "1.5", "1e5", "0x10", "10 00", "+100", "NaN", "Infinity", "99999999999999999999", 5, {}]) {
    assert.equal(parseLargeAmountLimit(bad), LIMIT, `bad setting ${JSON.stringify(bad)} uses the default`);
  }
  assert.equal(parseLargeAmountLimit("250000"), 250000);
  assert.equal(parseLargeAmountLimit(" 5000 "), 5000);
});

test("3.12: exactly the limit is not large; one pesewa above is", async () => {
  const { isLargeAmount } = await import("../src/pos/largeAmount.js");
  assert.equal(isLargeAmount(LIMIT, LIMIT), false);
  assert.equal(isLargeAmount(LIMIT + 1, LIMIT), true);
  assert.equal(isLargeAmount(1, LIMIT), false);
  assert.equal(isLargeAmount(0, LIMIT), false);
});

test("3.12: .env.example documents VITE_LARGE_AMOUNT_CONFIRM_PESEWAS with the default", () => {
  const example = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  assert.match(example, /^VITE_LARGE_AMOUNT_CONFIRM_PESEWAS=100000\r?$/m);
});

// ---- 15 Sell ---------------------------------------------------------------------------

async function sellView(amountPesewas, env, recordSale) {
  const { default: Sell } = await loadJsx("src/pos/Sell.jsx", env);
  const navigations = [];
  const view = render({ type: Sell, props: { params: { amountPesewas }, onNavigate: (...args) => navigations.push(args), recordSale } });
  return { view, navigations };
}

test("3.12 on 15: exactly the limit saves with no dialog", async () => {
  const { calls, save } = recorder();
  const { view, navigations } = await sellView(LIMIT, {}, save);
  findButton(view.tree, "Done").props.onClick();
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].amountPesewas, LIMIT);
  assert.equal(navigations[0][0], "SaleRecorded");
  assert.equal(findDialog(view.rerender().tree), null);
});

test("3.12 on 15: one pesewa above asks and saves nothing yet, and no attempt key is used", async () => {
  const { calls, save } = recorder();
  const { view } = await sellView(LIMIT + 1, {}, save);
  findButton(view.tree, "Done").props.onClick();
  await tick();
  assert.equal(calls.length, 0, "nothing is saved while the dialog is open");
  const dialog = findDialog(view.rerender().tree);
  assert.ok(dialog, "the dialog opens");
  assert.match(textOf(dialog), /Large amount/);
  assert.match(textOf(dialog), /This sale is GH₵1,000\.01\. Is the amount right\?/);
  assert.ok(dialogButton(view.tree, "Change amount"));
  assert.ok(dialogButton(view.tree, "Yes, save"));
  // The save did not start: Done is not showing "Saving…".
  assert.ok(findButton(view.tree, "Done"));
});

test("3.12 on 15: Change amount keeps the entry and saves nothing; Done asks again", async () => {
  const { calls, save } = recorder();
  const { view, navigations } = await sellView(LIMIT + 1, {}, save);
  findButton(view.tree, "Done").props.onClick();
  view.rerender();
  dialogButton(view.tree, "Change amount").props.onClick();
  await tick();
  view.rerender();
  assert.equal(findDialog(view.tree), null, "the dialog closes");
  assert.equal(calls.length, 0);
  assert.equal(navigations.length, 0, "stays on the screen");
  assert.match(textOf(view.tree), /GH₵1,000\.01/, "the amount is kept");
  findButton(view.tree, "Done").props.onClick();
  view.rerender();
  assert.ok(findDialog(view.tree), "Done asks again");
  assert.equal(calls.length, 0);
});

test("3.12 on 15: Yes, save saves once even if tapped twice, with the normal save", async () => {
  const { calls, save } = recorder();
  const { view, navigations } = await sellView(LIMIT + 1, {}, save);
  findButton(view.tree, "Done").props.onClick();
  view.rerender();
  const yes = dialogButton(view.tree, "Yes, save");
  yes.props.onClick();
  yes.props.onClick();
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].amountPesewas, LIMIT + 1);
  assert.equal(calls[0].cashReceivedPesewas, LIMIT + 1);
  assert.ok(calls[0].attemptId, "the attempt key is created only now, for the real save");
  assert.equal(navigations[0][0], "SaleRecorded");
});

test("3.12 on 15: a second tap on Done while the dialog is open does not stack a second dialog or save", async () => {
  const { calls, save } = recorder();
  const { view } = await sellView(LIMIT + 1, {}, save);
  const done = findButton(view.tree, "Done");
  done.props.onClick();
  done.props.onClick();
  view.rerender();
  const yes = dialogButton(view.tree, "Yes, save");
  yes.props.onClick();
  await tick();
  assert.equal(calls.length, 1);
});

test("3.12 on 15: below the limit there is no dialog", async () => {
  const { calls, save } = recorder();
  const { view } = await sellView(5000, {}, save);
  findButton(view.tree, "Done").props.onClick();
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(findDialog(view.rerender().tree), null);
});

test("3.12: a bad VITE_LARGE_AMOUNT_CONFIRM_PESEWAS uses the default on 15", async () => {
  for (const bad of ["abc", "0", "-1", "1.5", ""]) {
    const env = { VITE_LARGE_AMOUNT_CONFIRM_PESEWAS: bad };
    const exact = recorder();
    const exactView = (await sellView(LIMIT, env, exact.save)).view;
    findButton(exactView.tree, "Done").props.onClick();
    await tick();
    assert.equal(exact.calls.length, 1, `${bad}: exactly the default saves`);
    const above = recorder();
    const aboveView = (await sellView(LIMIT + 1, env, above.save)).view;
    findButton(aboveView.tree, "Done").props.onClick();
    await tick();
    assert.equal(above.calls.length, 0, `${bad}: one pesewa above the default asks`);
    assert.ok(findDialog(aboveView.rerender().tree));
  }
});

test("3.12: a valid setting changes the limit", async () => {
  const env = { VITE_LARGE_AMOUNT_CONFIRM_PESEWAS: "5000" };
  const exact = recorder();
  const exactView = (await sellView(5000, env, exact.save)).view;
  findButton(exactView.tree, "Done").props.onClick();
  await tick();
  assert.equal(exact.calls.length, 1);
  const above = recorder();
  const aboveView = (await sellView(5001, env, above.save)).view;
  findButton(aboveView.tree, "Done").props.onClick();
  await tick();
  assert.equal(above.calls.length, 0);
  assert.ok(findDialog(aboveView.rerender().tree));
});

test("3.12: it works offline (no network call is made to ask or to save)", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("The confirmation must not use the network."); };
  try {
    const { calls, save } = recorder();
    const { view } = await sellView(LIMIT + 1, {}, save);
    findButton(view.tree, "Done").props.onClick();
    view.rerender();
    dialogButton(view.tree, "Yes, save").props.onClick();
    await tick();
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
  const source = readFileSync(new URL("../src/pos/LargeAmountConfirm.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|navigator\.onLine/);
});

// ---- the dialog: announcement and focus --------------------------------------------------

test("3.12: the dialog is announced (alertdialog, modal, named and described) and focus starts on Change amount", async () => {
  const { save } = recorder();
  const { view } = await sellView(LIMIT + 1, {}, save);
  findButton(view.tree, "Done").props.onClick();
  const dialog = findDialog(view.rerender().tree);
  assert.equal(dialog.props["aria-modal"], "true");
  const byId = (id) => {
    for (const node of walk(dialog)) if (node.props?.id === id) return node;
    return null;
  };
  assert.equal(textOf(byId(dialog.props["aria-labelledby"])), "Large amount");
  assert.match(textOf(byId(dialog.props["aria-describedby"])), /^This sale is GH₵1,000\.01\. Is the amount right\?$/);
  const change = dialogButton(view.tree, "Change amount");
  const yes = dialogButton(view.tree, "Yes, save");
  assert.equal(change.props.autoFocus, true, "focus starts on the safe choice");
  assert.notEqual(yes.props.autoFocus, true);
  // The buttons are in this order: the safe choice first.
  const labels = [...walk(dialog)].filter((node) => node.type === "button").map((node) => textOf(node));
  assert.deepEqual(labels, ["Change amount", "Yes, save"]);
});

test("3.12: Escape on the dialog is Change amount (never a save)", async () => {
  const { calls, save } = recorder();
  const { view } = await sellView(LIMIT + 1, {}, save);
  findButton(view.tree, "Done").props.onClick();
  const dialog = findDialog(view.rerender().tree);
  let prevented = false;
  dialog.props.onKeyDown({ key: "Escape", preventDefault() { prevented = true; }, stopPropagation() {} });
  view.rerender();
  assert.equal(prevented, true);
  assert.equal(findDialog(view.tree), null);
  assert.equal(calls.length, 0);
});

// ---- 55 Review and pay -------------------------------------------------------------------

function cart(totalPesewas) {
  return [{ productId: 1, name: "Rice", quantity: 1, unitPricePesewas: totalPesewas }];
}

test("3.12 on 55: exactly the limit saves; one pesewa above asks; Change amount saves nothing; Yes, save saves once", async () => {
  const { default: ReviewAndPay } = await loadJsx("src/pos/ReviewAndPay.jsx");
  const mount = (total) => {
    const saves = [];
    const view = render({ type: ReviewAndPay, props: { params: { saleItems: cart(total) }, onSaveSale: async (details) => { saves.push(details); }, onBack() {}, onNavigate() {} } });
    return { view, saves };
  };
  const exact = mount(LIMIT);
  findButton(exact.view.tree, "Done").props.onClick();
  await tick();
  assert.equal(exact.saves.length, 1);

  const above = mount(LIMIT + 1);
  findButton(above.view.tree, "Done").props.onClick();
  await tick();
  assert.equal(above.saves.length, 0);
  above.view.rerender();
  assert.match(textOf(findDialog(above.view.tree)), /This sale is GH₵1,000\.01\./);
  dialogButton(above.view.tree, "Change amount").props.onClick();
  above.view.rerender();
  assert.equal(above.saves.length, 0);
  assert.equal(findDialog(above.view.tree), null);
  findButton(above.view.tree, "Done").props.onClick();
  above.view.rerender();
  const yes = dialogButton(above.view.tree, "Yes, save");
  yes.props.onClick();
  yes.props.onClick();
  await tick();
  assert.equal(above.saves.length, 1);
  assert.equal(above.saves[0].amountPesewas, LIMIT + 1);
  assert.ok(above.saves[0].attemptId);
});

// ---- 16 Split payment ----------------------------------------------------------------------

test("3.12 on 16: a split above the limit asks once and saves once on Yes, save", async () => {
  const { default: SaleSplitPayment } = await loadJsx("src/pos/SaleSplitPayment.jsx");
  const saves = [];
  const view = render({ type: SaleSplitPayment, props: { params: { amountPesewas: 200000 }, onSaveSale: async (details) => { saves.push(details); }, onBack() {}, onNavigate() {} } });
  const parts = [{ paymentMethod: "cash", amountPesewas: 150000 }, { paymentMethod: "momo", amountPesewas: 50000 }];
  const split = findComponent(view.tree, "SplitPayment");
  split.props.onDone(parts);
  split.props.onDone(parts);
  await tick();
  assert.equal(saves.length, 0);
  view.rerender();
  assert.match(textOf(findDialog(view.tree)), /This sale is GH₵2,000\.00\./);
  const yes = dialogButton(view.tree, "Yes, save");
  yes.props.onClick();
  yes.props.onClick();
  await tick();
  assert.equal(saves.length, 1);
  assert.equal(saves[0].cashReceivedPesewas, 150000);
  assert.equal(saves[0].momoReceivedPesewas, 50000);
});

test("3.12 on 16: exactly the limit saves with no dialog; Change amount keeps the parts and saves nothing", async () => {
  const { default: SaleSplitPayment } = await loadJsx("src/pos/SaleSplitPayment.jsx");
  const exactSaves = [];
  const exactView = render({ type: SaleSplitPayment, props: { params: { amountPesewas: LIMIT }, onSaveSale: async (details) => { exactSaves.push(details); }, onBack() {}, onNavigate() {} } });
  findComponent(exactView.tree, "SplitPayment").props.onDone([{ paymentMethod: "cash", amountPesewas: LIMIT }]);
  await tick();
  assert.equal(exactSaves.length, 1);

  const saves = [];
  const updates = [];
  const view = render({ type: SaleSplitPayment, props: { params: { amountPesewas: LIMIT + 1 }, onSaveSale: async (details) => { saves.push(details); }, onUpdateParams: (next) => updates.push(next), onBack() {}, onNavigate() {} } });
  findComponent(view.tree, "SplitPayment").props.onDone([{ paymentMethod: "cash", amountPesewas: LIMIT + 1 }]);
  view.rerender();
  dialogButton(view.tree, "Change amount").props.onClick();
  view.rerender();
  assert.equal(findDialog(view.tree), null);
  assert.equal(saves.length, 0);
  assert.ok(findComponent(view.tree, "SplitPayment"), "back on 16");
});

test("3.12 on 16: a split with an Owe part (credit) above the limit asks once", async () => {
  const { default: SaleSplitPayment } = await loadJsx("src/pos/SaleSplitPayment.jsx");
  const saves = [];
  const view = render({ type: SaleSplitPayment, props: { params: { amountPesewas: 300000, customer: { name: "Ama" } }, onSaveSale: async (details) => { saves.push(details); }, onBack() {}, onNavigate() {} } });
  const parts = [{ paymentMethod: "cash", amountPesewas: 100000 }, { paymentMethod: "owe", amountPesewas: 200000 }];
  findComponent(view.tree, "SplitPayment").props.onDone(parts);
  view.rerender();
  assert.match(textOf(findDialog(view.tree)), /This sale is GH₵3,000\.00\./);
  dialogButton(view.tree, "Yes, save").props.onClick();
  await tick();
  assert.equal(saves.length, 1);
  assert.equal(saves[0].parts.length, 2);
});

// ---- credit sale (18) and plan (19) ---------------------------------------------------------

test("3.12 on the credit sale save (18): above the limit asks once; Yes, save saves once", async () => {
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx");
  const saves = [];
  const params = { amountPesewas: LIMIT + 1, customer: { name: "Ama", totalDebtPesewas: 0 } };
  const view = render({ type: CreditScreens, props: { route: "WhenWillTheyPay", params, onSaveCredit: async (details) => { saves.push(details); }, onBack() {}, onNavigate() {}, onReturnToSplit() {} } });
  const save = findButton(view.tree, "Save");
  save.props.onClick();
  save.props.onClick();
  await tick();
  assert.equal(saves.length, 0);
  view.rerender();
  assert.match(textOf(findDialog(view.tree)), /This sale is GH₵1,000\.01\./);
  dialogButton(view.tree, "Change amount").props.onClick();
  view.rerender();
  assert.equal(saves.length, 0);
  findButton(view.tree, "Save").props.onClick();
  view.rerender();
  const yes = dialogButton(view.tree, "Yes, save");
  yes.props.onClick();
  yes.props.onClick();
  await tick();
  assert.equal(saves.length, 1);
  assert.ok(saves[0].attemptId);
});

test("3.12 on the credit sale save (18): exactly the limit saves with no dialog", async () => {
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx");
  const saves = [];
  const params = { amountPesewas: LIMIT, customer: { name: "Ama", totalDebtPesewas: 0 } };
  const view = render({ type: CreditScreens, props: { route: "WhenWillTheyPay", params, onSaveCredit: async (details) => { saves.push(details); }, onBack() {}, onNavigate() {}, onReturnToSplit() {} } });
  findButton(view.tree, "Save").props.onClick();
  await tick();
  assert.equal(saves.length, 1);
  assert.equal(findDialog(view.rerender().tree), null);
});

test("3.12 on the plan save (19): above the limit asks once; Yes, save saves once", async () => {
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx");
  const saves = [];
  const params = { amountPesewas: 500000, customer: { name: "Ama", totalDebtPesewas: 0 }, installmentAmount: "100", frequency: "weekly" };
  const view = render({ type: CreditScreens, props: { route: "ALittleAtATime", params, onSaveCredit: async (details) => { saves.push(details); }, onBack() {}, onNavigate() {}, onReturnToSplit() {} } });
  const button = findButton(view.tree, "Save plan");
  button.props.onClick();
  button.props.onClick();
  await tick();
  assert.equal(saves.length, 0);
  view.rerender();
  assert.match(textOf(findDialog(view.tree)), /This sale is GH₵5,000\.00\./);
  const yes = dialogButton(view.tree, "Yes, save");
  yes.props.onClick();
  yes.props.onClick();
  await tick();
  assert.equal(saves.length, 1);
  assert.ok(saves[0].installmentPlan);
});

test("3.12: in a split flow 18 and 19 do not ask (16 asks once when it saves)", async () => {
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx");
  const returns = [];
  const base = { amountPesewas: 500000, flow: "split", initialPaymentParts: [], customer: { name: "Ama", totalDebtPesewas: 0 } };
  const eighteen = render({ type: CreditScreens, props: { route: "WhenWillTheyPay", params: base, onSaveCredit: async () => { throw new Error("must not save here"); }, onBack() {}, onNavigate() {}, onReturnToSplit: (details) => returns.push(details) } });
  findButton(eighteen.tree, "Save").props.onClick();
  await tick();
  assert.equal(returns.length, 1);
  assert.equal(findDialog(eighteen.rerender().tree), null);

  const nineteen = render({ type: CreditScreens, props: { route: "ALittleAtATime", params: { ...base, installmentAmount: "100", frequency: "weekly" }, onSaveCredit: async () => { throw new Error("must not save here"); }, onBack() {}, onNavigate() {}, onReturnToSplit: (details) => returns.push(details) } });
  findButton(nineteen.tree, "Save plan").props.onClick();
  await tick();
  assert.equal(returns.length, 2);
  assert.equal(findDialog(nineteen.rerender().tree), null);
});

test("3.12: manual debts are not covered yet (later extension): no dialog on 18 for a manual debt", async () => {
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx");
  const saves = [];
  const params = { manualDebt: true, amountPesewas: 500000, customer: { name: "Ama", totalDebtPesewas: 0 } };
  const view = render({ type: CreditScreens, props: { route: "WhenWillTheyPay", params, onSaveCredit: async (details) => { saves.push(details); }, onBack() {}, onNavigate() {}, onReturnToSplit() {} } });
  findButton(view.tree, "Save").props.onClick();
  await tick();
  assert.equal(saves.length, 1);
  assert.equal(findDialog(view.rerender().tree), null);
});

test("3.12: the wording comes from the strings file", async () => {
  const { posText } = await import("../src/pos/i18n.js");
  assert.equal(posText("largeAmount.title"), "Large amount");
  assert.equal(posText("largeAmount.body", { amount: "GH₵1,000.01" }), "This sale is GH₵1,000.01. Is the amount right?");
  assert.equal(posText("largeAmount.change"), "Change amount");
  assert.equal(posText("largeAmount.save"), "Yes, save");
});
