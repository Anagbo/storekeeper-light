import assert from "node:assert/strict";
import { test } from "node:test";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Wiring rules_global.amount_entry, zero in a typed field (16 Nov 2026): a lone 0 now stays "0" in
// every typed amount field. Each screen then applies its own validation to the value 0, exactly as it
// did for "0.00" (which the field always kept): where 0 is not allowed (an expense, a supplier payment,
// a split part being added, an amount each time) the field shows its existing message or keeps its
// button disabled; where 0 is valid (45 Paid now) it works. Each case is checked with "0" and "0.00".

globalThis.HTMLElement ??= class {};

const nodes = (tree) => [...walk(tree)].filter((node) => node.props);
const alerts = (tree) => nodes(tree).filter((node) => node.props.role === "alert").map(textOf);
const button = (tree, label) => nodes(tree).filter((node) => node.type === "button" && textOf(node).trim() === label).at(-1);

async function type(view, getField, value) {
  getField().props.onChange({ target: { value } });
  await view.rerender();
  return getField().props.value;
}

for (const zero of ["0", "0.00"]) {
  test(`44 Spent money: ${zero} stays in the field; No shows "Enter an amount before continuing."`, async () => {
    const { SpentMoney } = await loadJsx("src/pos/SupplierScreens.jsx");
    const navigated = [];
    const view = render({ type: SpentMoney, props: { params: {}, onBack() {}, onNavigate: (...args) => navigated.push(args), onUpdateParams() {}, onSave: async () => {} } });
    const field = () => nodes(view.tree).find((node) => node.type === "input" && node.props.inputMode === "decimal");
    assert.equal(await type(view, field, zero), zero);
    button(view.tree, "No").props.onClick();
    view.rerender();
    assert.deepEqual(alerts(view.tree), ["Enter an amount before continuing."]);
    assert.equal(navigated.length, 0, "not on to 45");
  });

  test(`45 Paid now: ${zero} is valid (no message, nothing paid now)`, async () => {
    const { StockOnCredit } = await loadJsx("src/pos/SupplierScreens.jsx");
    setLiveQuery(() => []);
    try {
      const view = render({ type: StockOnCredit, props: { params: { amountPesewas: 8000, category: "stock" }, onBack() {}, onUpdateParams() {}, onSaveExpense: async () => {} } });
      const field = () => nodes(nodes(view.tree).find((node) => node.props["data-card"] === "paid-now")).find((node) => node.type === "input");
      assert.equal(await type(view, field, "5"), "5");
      assert.equal(await type(view, field, zero), zero);
      assert.deepEqual(alerts(view.tree), [], "no message for 0 paid now");
    } finally {
      setLiveQuery(null);
    }
  });

  test(`46 Amount to pay: ${zero} keeps Record payment disabled`, async () => {
    const { YouOweSuppliers } = await loadJsx("src/pos/SupplierScreens.jsx");
    setLiveQuery(() => [{ id: "s1", name: "Kofi Wholesale", balancePesewas: 40000 }]);
    try {
      const view = render({ type: YouOweSuppliers, props: { onBack() {}, onPay: async () => {} } });
      nodes(view.tree).find((node) => node.type === "button" && node.props["aria-label"] === "Pay Kofi Wholesale").props.onClick();
      view.rerender();
      const field = () => nodes(view.tree).find((node) => node.type === "input" && node.props.inputMode === "decimal");
      assert.equal(await type(view, field, "5"), "5");
      assert.equal(button(view.tree, "Record payment").props.disabled, false, "control: GH₵5 can be paid");
      assert.equal(await type(view, field, zero), zero);
      assert.equal(button(view.tree, "Record payment").props.disabled, true);
    } finally {
      setLiveQuery(null);
    }
  });

  test(`16/27 split, adding MoMo: ${zero} shows the split message and does not go to 61`, async () => {
    const { default: SplitPayment } = await loadJsx("src/pos/SplitPayment.jsx");
    const momo = [];
    const view = render({ type: SplitPayment, props: { totalPesewas: 800, totalLabel: "Total", doneLabel: "Done", initialParts: [{ paymentMethod: "cash", amountPesewas: 400 }], onBack() {}, onDone() {}, onMoMo: (...args) => momo.push(args) } });
    button(view.tree, "MoMo").props.onClick();
    view.rerender();
    const field = () => nodes(view.tree).find((node) => node.type === "input" && node.props.id === "split-draft-amount");
    assert.equal(await type(view, field, zero), zero);
    button(view.tree, "Save").props.onClick();
    view.rerender();
    assert.deepEqual(alerts(view.tree), ["Enter an amount that is more than zero and no more than what is left to pay."]);
    assert.equal(momo.length, 0);
  });

  test(`19 How much each time?: ${zero} keeps Save plan disabled`, async () => {
    const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx");
    const params = { amountPesewas: 800, customer: { name: "Kofi" }, startToday: false, installmentAmount: "4.00" };
    const view = render({ type: CreditScreens, props: { route: "ALittleAtATime", params, onBack() {}, onNavigate() {}, onUpdateParams() {}, onSaveCredit: async () => {} } });
    const field = () => nodes(view.tree).find((node) => node.type === "input" && node.props["aria-label"] === "How much each time?");
    const savePlan = () => nodes(view.tree).filter((node) => node.type === "button" && /Save plan/.test(textOf(node))).at(-1);
    assert.equal(await type(view, field, zero), zero);
    assert.equal(savePlan().props.disabled, true);
  });

  test(`16/27 split, editing the Cash row: ${zero} shows the split message`, async () => {
    const { default: SplitPayment } = await loadJsx("src/pos/SplitPayment.jsx");
    const view = render({ type: SplitPayment, props: { totalPesewas: 800, totalLabel: "Total", doneLabel: "Done", initialParts: [{ paymentMethod: "cash", amountPesewas: 400 }, { paymentMethod: "momo", amountPesewas: 400 }], onBack() {}, onDone() {}, onMoMo() {} } });
    nodes(view.tree).find((node) => node.type === "button" && node.props["aria-label"] === "Edit Cash amount").props.onClick();
    view.rerender();
    const field = () => nodes(view.tree).find((node) => node.type === "input" && node.props.id === "split-draft-amount");
    assert.equal(await type(view, field, zero), zero);
    button(view.tree, "Save").props.onClick();
    view.rerender();
    assert.deepEqual(alerts(view.tree), ["Enter an amount that is more than zero and no more than what is left to pay."]);
  });

  test(`New item price: ${zero} shows the price message on Save`, async () => {
    const { default: ItemScreens } = await loadJsx("src/pos/ItemScreens.jsx");
    const view = render({ type: ItemScreens, props: { route: "NewItem", params: {}, onBack() {}, onNavigate() {} } });
    nodes(view.tree).find((node) => node.type === "input" && !node.props.inputMode).props.onChange({ target: { value: "Rice" } });
    view.rerender();
    const field = () => nodes(view.tree).find((node) => node.type === "input" && node.props.inputMode === "decimal");
    assert.equal(await type(view, field, zero), zero);
    await nodes(view.tree).find((node) => node.type === "form").props.onSubmit({ preventDefault() {} });
    view.rerender();
    assert.deepEqual(alerts(view.tree), ["Enter a valid item price greater than GH₵0.00."]);
  });
}
