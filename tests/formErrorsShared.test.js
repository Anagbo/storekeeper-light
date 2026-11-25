import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { firstProblem, shownMessage } from "../src/pos/formErrors.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Wiring rules_global.form_errors (decided 16 Nov 2026) and 34 "Error on 34": on every form with an
// error box a message appears only after the main button is tapped with a problem, names only what
// is wrong, and disappears as soon as that problem is fixed (no second tap). A fresh or returning
// form never shows one. One test per form.

globalThis.HTMLElement ??= class {};

after(async () => {
  setLiveQuery(null);
  db.close();
  await db.delete();
});

beforeEach(async () => {
  resetBrowserBack();
  setLiveQuery(null);
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
});

const nodes = (tree) => [...walk(tree)].filter((node) => node.props);
const alerts = (tree) => nodes(tree).filter((node) => node.props.role === "alert").map((node) => textOf(node).trim());
const inputs = (tree) => nodes(tree).filter((node) => node.type === "input" || node.type === "textarea");
const form = (tree, index = 0) => nodes(tree).filter((node) => node.type === "form")[index];
const button = (tree, label) => {
  let found = null;
  for (const node of nodes(tree)) {
    const isButton = node.type === "button" || (typeof node.type === "function" && /Button$/.test(node.type.name));
    if (!isButton) continue;
    const text = textOf(node).trim();
    if (label instanceof RegExp ? label.test(text) || label.test(node.props["aria-label"] ?? "") : text === label) found = node;
  }
  assert.ok(found, `no button ${label}`);
  return found;
};
function type(view, input, value) {
  input.props.onChange({ target: { value } });
  view.rerender();
}
function submit(view, index = 0) {
  form(view.tree, index).props.onSubmit({ preventDefault() {} });
  view.rerender();
}
function tap(view, label) {
  button(view.tree, label).props.onClick({ preventDefault() {}, stopPropagation() {} });
  view.rerender();
}

test("shared helpers: the first problem is shown, and only while it is still a problem", () => {
  const problems = [["name", "Enter a name."], ["phone", "Enter a phone."]];
  assert.deepEqual(firstProblem(problems), ["name", "Enter a name."]);
  assert.equal(firstProblem([["name", ""]]), null);
  assert.equal(shownMessage("name", problems), "Enter a name.");
  assert.equal(shownMessage("name", [["name", ""], ["phone", "Enter a phone."]]), "", "fixed: hidden, the next problem waits for a tap");
  assert.equal(shownMessage(null, problems), "", "nothing tapped yet");
});

test("34 New person (sale flow): \"Enter the customer’s name.\" only after Next, gone at the first letter", async () => {
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx");
  const view = render({ type: CreditScreens, props: { route: "NewPerson", params: { amountPesewas: 800 }, onBack() {}, onNavigate() {}, onUpdateParams() {} } });
  assert.deepEqual(alerts(view.tree), [], "fresh form: no error");
  submit(view);
  assert.deepEqual(alerts(view.tree), ["Enter the customer’s name."]);
  assert.doesNotMatch(textOf(view.tree), /valid amount/, "no amount is mentioned");
  type(view, inputs(view.tree)[0], "K");
  assert.deepEqual(alerts(view.tree), [], "typing a name hides it at once");
  type(view, inputs(view.tree)[0], "");
  assert.deepEqual(alerts(view.tree), [], "emptied again: nothing until the next Next");

  // A bad Ghana Card number stays named until it is fixed, then goes.
  type(view, inputs(view.tree)[0], "Kofi");
  type(view, inputs(view.tree)[2], "GHA-12");
  submit(view);
  assert.deepEqual(alerts(view.tree), ["Enter a Ghana Card number like GHA-123456789-0 or 1234567890."]);
  type(view, inputs(view.tree)[2], "GHA-123456789-0");
  assert.deepEqual(alerts(view.tree), []);
});

test("34 New person (returning form, add-debt flow): no error box on a returning form", async () => {
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx");
  const view = render({ type: CreditScreens, props: { route: "NewPerson", params: { manualDebt: true, newPersonName: "", newPersonPhone: "024" }, onBack() {}, onNavigate() {}, onUpdateParams() {} } });
  assert.deepEqual(alerts(view.tree), []);
  submit(view);
  assert.deepEqual(alerts(view.tree), ["Enter the customer’s name."]);
});

test("44 Spent money: \"Enter an amount\" after No, gone once an amount is typed", async () => {
  const { SpentMoney } = await loadJsx("src/pos/SupplierScreens.jsx");
  const view = render({ type: SpentMoney, props: { params: {}, onBack() {}, onNavigate() {}, onUpdateParams() {}, onSave: async () => {} } });
  assert.deepEqual(alerts(view.tree), []);
  tap(view, "No");
  assert.deepEqual(alerts(view.tree), ["Enter an amount before continuing."]);
  type(view, inputs(view.tree)[0], "5");
  assert.deepEqual(alerts(view.tree), [], "fixed: hidden without another tap");
});

test("45 Stock on credit: \"Enter a name for the new supplier\" after Save, gone once a name is typed", async () => {
  const { StockOnCredit } = await loadJsx("src/pos/SupplierScreens.jsx");
  setLiveQuery(() => []);
  const view = render({ type: StockOnCredit, props: { params: { amountPesewas: 8000, category: "stock" }, onBack() {}, onUpdateParams() {}, onSaveExpense: async () => {} } });
  assert.deepEqual(alerts(view.tree), []);
  tap(view, "Save");
  assert.deepEqual(alerts(view.tree), ["Enter a name for the new supplier."]);
  const name = nodes(view.tree).find((node) => node.props["data-new-supplier-fields"] !== undefined);
  type(view, inputs(name)[0], "Kofi Wholesale");
  assert.deepEqual(alerts(view.tree), []);
});

test("New item: the name error goes once a name is typed; a price error stays until the price is fixed", async () => {
  const { default: ItemScreens } = await loadJsx("src/pos/ItemScreens.jsx");
  const view = render({ type: ItemScreens, props: { route: "NewItem", params: {}, onBack() {}, onNavigate() {} } });
  assert.deepEqual(alerts(view.tree), []);
  submit(view);
  assert.deepEqual(alerts(view.tree), ["Enter an item name."]);
  type(view, inputs(view.tree)[0], "Bread");
  assert.deepEqual(alerts(view.tree), []);
  type(view, inputs(view.tree)[1], "0.00");
  submit(view);
  assert.deepEqual(alerts(view.tree), ["Enter a valid item price greater than GH₵0.00."]);
  type(view, inputs(view.tree)[0], "Bread rolls");
  assert.deepEqual(alerts(view.tree), ["Enter a valid item price greater than GH₵0.00."], "still wrong: still named");
  type(view, inputs(view.tree)[1], "2");
  assert.deepEqual(alerts(view.tree), []);
});

test("Edit contact: a bad phone stays named while it is still bad, and goes once it is valid", async () => {
  const { default: CustomerContactEditor } = await loadJsx("src/pos/CustomerContactEditor.jsx");
  const view = render({ type: CustomerContactEditor, props: { customer: { id: 1, name: "Kofi", phone: "" }, onClose() {}, onSave: async () => {} } });
  const errorBox = () => alerts(view.tree).filter((text) => text.startsWith("Enter a valid Ghana mobile number"));
  type(view, inputs(view.tree)[0], "123");
  assert.equal(errorBox().length, 0, "no box before Save");
  submit(view);
  assert.equal(errorBox().length, 1);
  type(view, inputs(view.tree)[0], "1234");
  assert.equal(errorBox().length, 1, "still wrong: still named");
  type(view, inputs(view.tree)[0], "0241234567");
  assert.equal(errorBox().length, 0);
});

test("Split editor (16 and 27): \"Enter an amount ... left to pay\" stays while too high, goes once it fits", async () => {
  const { default: SplitPayment } = await loadJsx("src/pos/SplitPayment.jsx");
  const view = render({ type: SplitPayment, props: { totalPesewas: 800, totalLabel: "Total", doneLabel: "Done", onBack() {}, onDone() {}, onMoMo() {} } });
  assert.deepEqual(alerts(view.tree), []);
  tap(view, /^MoMo$/);
  const field = () => inputs(view.tree).find((node) => node.props.id === "split-draft-amount");
  type(view, field(), "9");
  assert.deepEqual(alerts(view.tree), [], "no error while typing");
  tap(view, "Save");
  const tooHigh = "Enter an amount that is more than zero and no more than what is left to pay.";
  assert.deepEqual(alerts(view.tree), [tooHigh]);
  type(view, field(), "10");
  assert.deepEqual(alerts(view.tree), [tooHigh], "still too high: still named");
  type(view, field(), "5");
  assert.deepEqual(alerts(view.tree), []);
});

test("Settings shop name: \"Enter a shop name\" after Save with an empty name, gone at the first letter", async () => {
  const { SettingsProfitTools } = await loadJsx("src/pos/SettingsScreens.jsx");
  const view = render({ type: SettingsProfitTools, props: { shopName: "Ama Shop", params: { shopNameDraft: "" }, onShopNameChange() {}, onBack() {}, onUpdateParams() {} } });
  assert.deepEqual(alerts(view.tree), []);
  submit(view);
  assert.deepEqual(alerts(view.tree), ["Enter a shop name before saving."]);
  type(view, inputs(view.tree)[0], "A");
  assert.deepEqual(alerts(view.tree), []);
});

test("MoMo settings: a bad MoMo number stays named while bad, goes once it is a Ghana number", async () => {
  const { PaymentSettings } = await loadJsx("src/pos/MoMoScreens.jsx");
  const view = render({ type: PaymentSettings, props: { params: { momoSettingsDraft: { enabled: true } }, onBack() {}, onNavigate() {}, onUpdateParams() {} } });
  const number = () => inputs(view.tree).find((node) => node.props["aria-label"] === "My MoMo number");
  type(view, number(), "123");
  assert.deepEqual(alerts(view.tree), []);
  tap(view, "Save");
  assert.deepEqual(alerts(view.tree), ["Enter a Ghana mobile number, like 024 123 4567."]);
  type(view, number(), "1234");
  assert.deepEqual(alerts(view.tree), ["Enter a Ghana mobile number, like 024 123 4567."]);
  type(view, number(), "0241234567");
  assert.deepEqual(alerts(view.tree), []);
});

test("37 How much is {item}?: \"Enter a valid price\" after Save price, gone once a price is above zero", async () => {
  const { HowMuchIsItem } = await loadJsx("src/pos/SetupScreens.jsx");
  const view = render({ type: HowMuchIsItem, props: { params: { product: { id: 1, name: "Bread" } }, onBack() {}, onReturnTo() {} } });
  assert.deepEqual(alerts(view.tree), []);
  tap(view, "Save price");
  assert.deepEqual(alerts(view.tree), ["Enter a valid price greater than GH₵0.00."]);
  tap(view, ".");
  assert.deepEqual(alerts(view.tree), ["Enter a valid price greater than GH₵0.00."], "still zero: still named");
  tap(view, "5");
  assert.deepEqual(alerts(view.tree), []);
});

test("15 Sell: MoMo with no amount shows no message and goes nowhere", async () => {
  const { default: Sell } = await loadJsx("src/pos/Sell.jsx");
  const went = [];
  const view = render({ type: Sell, props: { params: {}, onNavigate: (...a) => went.push(a), onUpdateParams() {} } });
  assert.deepEqual(alerts(view.tree), []);
  tap(view, "MoMo");
  assert.deepEqual(alerts(view.tree), []);
  assert.deepEqual(went, []);
});

async function openApp() {
  // The app's live queries read the fake database (as in newPersonNoAmount.test.js).
  const liveResults = new Map();
  setLiveQuery((deps, query) => {
    const key = `${String(query)}|${JSON.stringify(deps)}`;
    if (!liveResults.has(key)) {
      liveResults.set(key, undefined);
      Promise.resolve().then(query).then((value) => liveResults.set(key, value), () => liveResults.set(key, null));
    }
    return liveResults.get(key);
  });
  const app = await openPosApp();
  after(() => app.restoreConsole());
  return app;
}

test("19 A little at a time: Split with no amount names it once (under the field, not again in the box), and it goes once typed", async () => {
  await recordCreditSale({ name: "juju", amountPesewas: 1000, now: Date.now() - 3 * 86_400_000 });
  const app = await openApp();
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Owe");
  await app.tap(/^JJuju/);
  await app.tap(/^Next/);
  await app.tap(/A little at a time/);
  assert.equal(app.route, "ALittleAtATime");
  // Nothing typed in How much each time?, so Amount paid today (which starts from it) is empty.
  await app.tap("Today");
  assert.deepEqual(alerts(app.view.tree), [], "fresh: no error");
  await app.tap("Split payment");
  assert.deepEqual(alerts(app.view.tree), ["Enter the amount being paid today."], "named once, under the field");
  await app.type("Amount paid today", "2");
  assert.deepEqual(alerts(app.view.tree), []);
});

test("Correct balance: \"Add a note\" for Other goes as soon as a note is typed", async () => {
  await recordCreditSale({ name: "juju", amountPesewas: 1000, now: Date.now() - 3 * 86_400_000 });
  const debt = (await db.debts.toArray())[0];
  const app = await openApp();
  const home = nodes(app.view.tree).find((node) => node.type?.name === "Home");
  home.props.onNavigate("DebtorDetail", { debtId: debt.id, customerName: "juju" });
  await app.settle();
  await app.tap("Correct balance");
  await app.type("pos-correction-amount", "5.00");
  await app.tap("Other");
  assert.deepEqual(alerts(app.view.tree), []);
  const sheet = nodes(app.view.tree).find((node) => node.props["aria-labelledby"] === "pos-correction-title");
  form(sheet).props.onSubmit({ preventDefault() {} });
  await app.settle();
  assert.deepEqual(alerts(app.view.tree), ["Add a note when the correction reason is Other."]);
  const note = nodes(app.view.tree).find((node) => node.props.id === "pos-correction-note");
  note.props.onChange({ target: { value: "Agreed with Juju" } });
  await app.settle();
  assert.deepEqual(alerts(app.view.tree), []);
});
