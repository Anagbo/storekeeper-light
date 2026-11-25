import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// rules_global.saved_credit_layout (25 Nov 2026), phone review item 4: on Saved as credit (Add debt and
// the sale on credit) a person with no valid phone gets no working-looking WhatsApp button. The dashed
// "+ Add phone for WhatsApp" (c406749) opens the same contact editor as Payment received; once a number
// is saved, the WhatsApp button is back.

globalThis.HTMLElement ??= class {};
afterEach(() => setLiveQuery(null));

const buttons = (tree) => [...walk(tree)].filter((node) => node.type === "button");
const named = (tree, re) => buttons(tree).find((node) => re.test(textOf(node).trim()));
const dialog = (tree) => [...walk(tree)].find((node) => node.props?.role === "dialog");

// The record lookup answers with the stored customer; the reminder lookup with "never reminded".
function liveQueries(stored) {
  setLiveQuery((deps) => (deps[0] === "manualDebtSavedCustomer" ? stored : deps[0] === "manualDebtSavedReminder" ? 0 : stored));
}

// Polish 8 (bed5433): the receipt buttons follow VITE_ENABLE_POS_RECEIPTS, so these tests load the screen with it on.
const ON = { VITE_ENABLE_POS_RECEIPTS: "true" };

async function debtSaved(phone, saves = [], env = ON) {
  const { ManualDebtSaved } = await loadJsx("src/pos/ManualDebtScreens.jsx", env);
  liveQueries({ id: "c1", name: "Ama", phone });
  const params = { customer: { id: "c1", name: "Ama", phone }, amountPesewas: 1000, manualDebtResult: { debt: { id: "d1", amountPesewas: 1000 }, customer: { id: "c1" } } };
  return render({ type: ManualDebtSaved, props: { params, onDone() {}, onNavigate() {}, onSaveCustomerContact: async (details) => { saves.push(details); return { ...details }; }, shopName: "Shop" } });
}

const SEND = /^Send receipt$/;
const ADD = /^\+ Add phone number$/;

test("Add debt saved, no phone: Send receipt is shown (share sheet), with the dashed + Add phone number under it", async () => {
  const view = await debtSaved("");
  assert.equal(named(view.tree, /^WhatsApp Ama$/), undefined, "the old WhatsApp {name} label is gone");
  const send = named(view.tree, SEND);
  assert.ok(send, "Send receipt is always shown");
  const add = named(view.tree, ADD);
  assert.ok(add, "the add-phone button is shown");
  assert.equal(add.props["data-look"], "add");
  const order = buttons(view.tree).map((node) => textOf(node).trim());
  assert.ok(order.indexOf("Send receipt") < order.indexOf("+ Add phone number"), "the add-phone button sits under Send receipt");
  assert.ok(order.indexOf("+ Add phone number") < order.indexOf("See Ama’s details"));
  assert.equal(order[order.length - 1], "Done");
});

test("Add debt saved, no phone: the add-phone button opens the contact editor; a saved number removes it, Send receipt stays", async () => {
  const saves = [];
  const view = await debtSaved("", saves);
  named(view.tree, ADD).props.onClick();
  view.rerender();
  assert.ok(dialog(view.tree), "the contact editor opens");
  const phone = [...walk(dialog(view.tree))].find((node) => node.type === "input" && node.props.type === "tel");
  phone.props.onChange({ target: { value: "0241234567" } });
  view.rerender();
  await [...walk(dialog(view.tree))].find((node) => node.type === "form").props.onSubmit({ preventDefault() {} });
  view.rerender();
  assert.equal(saves.length, 1);
  assert.equal(saves[0].phone, "0241234567");
  assert.equal(dialog(view.tree), undefined, "the editor closes");
  assert.ok(named(view.tree, SEND), "Send receipt stays");
  assert.equal(named(view.tree, /Add phone/), undefined);
});

test("Add debt saved, with a phone: Send receipt, no add-phone button; a number that fails the check counts as none", async () => {
  const view = await debtSaved("0241234567");
  assert.ok(named(view.tree, SEND));
  assert.equal(named(view.tree, /Add phone/), undefined);
  const bad = await debtSaved("12");
  assert.ok(named(bad.tree, SEND));
  assert.ok(named(bad.tree, ADD));
});

test("Add debt saved, receipts flag off: no Send receipt, Copy receipt or add-phone button, with or without a phone", async () => {
  for (const phone of ["", "0241234567"]) {
    const view = await debtSaved(phone, [], {});
    const order = buttons(view.tree).map((node) => textOf(node).trim());
    assert.equal(named(view.tree, SEND), undefined);
    assert.equal(named(view.tree, ADD), undefined);
    assert.equal(named(view.tree, /Copy receipt/), undefined);
    assert.ok(order.includes("See Ama’s details"));
    assert.equal(order[order.length - 1], "Done");
  }
});

test("Add debt saved: the receipt text says who, how much was added and what they owe now", async () => {
  const { buildDebtAddedReceipt } = await loadJsx("src/pos/receiptTemplates.js");
  const text = buildDebtAddedReceipt({ shopName: "Shop", customerName: "ama", addedPesewas: 1000, balancePesewas: 4500, reason: "Rice, Water" });
  assert.match(text, /For: Ama/);
  assert.match(text, /Debt added: GH₵10\.00 \(Rice, Water\)/);
  assert.match(text, /Balance owed as of .*: GH₵45\.00/);
});

test("sale on credit saved (31), receipts on, no phone: the add-phone button opens the contact editor", async () => {
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx", { VITE_ENABLE_POS_RECEIPTS: "true" });
  setLiveQuery(() => null);
  const params = {
    customer: { id: "c1", name: "ama", phone: "" },
    creditResult: { customerId: "c1", customerName: "ama", phone: "", debtId: "d1", amountPesewas: 2500, addedDebtPesewas: 2500, previousDebtPesewas: 0, totalDebtPesewas: 2500, initialPaymentPesewas: 0, initialPaymentParts: [], debtAfter: { isInstallmentPlan: false }, saleTransaction: { timestamp: Date.now() } }
  };
  const view = render({ type: CreditScreens, props: { route: "CreditSaved", params, onHome() {}, onNavigate() {}, onSaveCustomerContact: async (details) => details, shopName: "Shop" } });
  // polish 6: the receipt is always sendable (no phone: the contact chooser), with the add-phone button too.
  assert.ok(named(view.tree, /^Send receipt/), "Send receipt is there without a phone");
  named(view.tree, /^\+ Add phone number$/).props.onClick();
  view.rerender();
  assert.ok(dialog(view.tree));
});
