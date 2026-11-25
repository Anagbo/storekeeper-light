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

async function debtSaved(phone, saves = []) {
  const { ManualDebtSaved } = await loadJsx("src/pos/ManualDebtScreens.jsx");
  liveQueries({ id: "c1", name: "Ama", phone });
  const params = { customer: { id: "c1", name: "Ama", phone }, amountPesewas: 1000, manualDebtResult: { debt: { id: "d1", amountPesewas: 1000 }, customer: { id: "c1" } } };
  return render({ type: ManualDebtSaved, props: { params, onDone() {}, onNavigate() {}, onSaveCustomerContact: async (details) => { saves.push(details); return { ...details }; }, shopName: "Shop" } });
}

test("Add debt saved, no phone: no WhatsApp Ama button, the dashed add-phone button instead", async () => {
  const view = await debtSaved("");
  assert.equal(named(view.tree, /^WhatsApp Ama$/), undefined);
  const add = named(view.tree, /^\+ Add phone for WhatsApp$/);
  assert.ok(add, "the add-phone button is shown");
  assert.equal(add.props["data-look"], "add");
});

test("Add debt saved, no phone: the add-phone button opens the contact editor; a saved number brings WhatsApp back", async () => {
  const saves = [];
  const view = await debtSaved("", saves);
  named(view.tree, /^\+ Add phone for WhatsApp$/).props.onClick();
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
  assert.ok(named(view.tree, /^WhatsApp Ama$/), "WhatsApp is back");
  assert.equal(named(view.tree, /Add phone/), undefined);
});

test("Add debt saved, with a phone: WhatsApp Ama, no add-phone button; a number that fails the check counts as none", async () => {
  const view = await debtSaved("0241234567");
  assert.ok(named(view.tree, /^WhatsApp Ama$/));
  assert.equal(named(view.tree, /Add phone/), undefined);
  const bad = await debtSaved("12");
  assert.equal(named(bad.tree, /^WhatsApp Ama$/), undefined);
  assert.ok(named(bad.tree, /^\+ Add phone for WhatsApp$/));
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
