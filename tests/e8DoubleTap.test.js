import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { findButton, findComponent, loadJsx, render, setLiveQuery } from "./helpers/renderJsx.js";

// Two taps in the same frame: the handler runs twice before React re-renders, so both calls
// see the same render. The shim does not re-render between the calls (tests/helpers).
const pending = () => new Promise(() => {});

test("E8: 16 split Done saves the sale once when tapped twice in the same frame", async () => {
  const { default: SaleSplitPayment } = await loadJsx("src/pos/SaleSplitPayment.jsx");
  let saves = 0;
  const view = render({ type: SaleSplitPayment, props: { params: { amountPesewas: 1000 }, onSaveSale: () => { saves += 1; return pending(); }, onBack() {}, onNavigate() {} } });
  const split = findComponent(view.tree, "SplitPayment");
  const parts = [{ paymentMethod: "cash", amountPesewas: 1000 }];
  split.props.onDone(parts);
  split.props.onDone(parts);
  assert.equal(saves, 1);
});

test("E8: 27 Received records the collection once when tapped twice in the same frame", async () => {
  const { CollectSplitPayment } = await loadJsx("src/pos/DebtCollection.jsx");
  let saves = 0;
  const debt = { id: "d1", amountPesewas: 1000, customerName: "Ama", status: "unpaid" };
  setLiveQuery(([debtId]) => (debtId === "d1" ? debt : undefined));
  const view = render({ type: CollectSplitPayment, props: { params: { debtId: "d1", amount: "10.00" }, onRecordCollection: () => { saves += 1; return pending(); }, onBack() {}, onNavigate() {} } });
  setLiveQuery(null);
  const split = findComponent(view.tree, "SplitPayment");
  assert.ok(split, "27 renders the split hub");
  const parts = [{ paymentMethod: "cash", amountPesewas: 1000 }];
  split.props.onDone(parts);
  split.props.onDone(parts);
  assert.equal(saves, 1);
});

test("E8: 19 Save plan saves once when tapped twice in the same frame", async () => {
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx");
  let saves = 0;
  const params = { amountPesewas: 10000, customer: { name: "Ama", totalDebtPesewas: 0 }, installmentAmount: "20", frequency: "weekly" };
  const view = render({ type: CreditScreens, props: { route: "ALittleAtATime", params, onSaveCredit: () => { saves += 1; return pending(); }, onBack() {}, onNavigate() {}, onReturnToSplit() {} } });
  const button = findButton(view.tree, "Save plan");
  assert.ok(button, "19 shows Save plan");
  button.props.onClick();
  button.props.onClick();
  assert.equal(saves, 1);
});

test("E8: 18 Save saves once when tapped twice in the same frame", async () => {
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx");
  let saves = 0;
  const params = { amountPesewas: 10000, customer: { name: "Ama", totalDebtPesewas: 0 } };
  const view = render({ type: CreditScreens, props: { route: "WhenWillTheyPay", params, onSaveCredit: () => { saves += 1; return pending(); }, onBack() {}, onNavigate() {}, onReturnToSplit() {} } });
  const button = findButton(view.tree, "Save");
  assert.ok(button, "18 shows Save");
  button.props.onClick();
  button.props.onClick();
  assert.equal(saves, 1);
});

test("E8: after a failed save the button works again (the guard is released)", async () => {
  const { default: SaleSplitPayment } = await loadJsx("src/pos/SaleSplitPayment.jsx");
  let saves = 0;
  const view = render({ type: SaleSplitPayment, props: { params: { amountPesewas: 1000 }, onSaveSale: async () => { saves += 1; throw new Error("disk full"); }, onBack() {}, onNavigate() {} } });
  const parts = [{ paymentMethod: "cash", amountPesewas: 1000 }];
  const originalError = console.error;
  console.error = () => {};
  try {
    await findComponent(view.tree, "SplitPayment").props.onDone(parts);
    await new Promise((resolve) => setImmediate(resolve));
    view.rerender();
    findComponent(view.tree, "SplitPayment").props.onDone(parts);
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    console.error = originalError;
  }
  assert.equal(saves, 2);
});