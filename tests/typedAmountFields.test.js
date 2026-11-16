import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { typeAmountText } from "../src/pos/amountKeypad.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Wiring rules_global.amount_entry, last sentences (decided 16 Nov 2026; found on the Split screen,
// where 4.00 then 2 showed 4.002). Typed amount fields (split field on 16/27, 19 each time and paid
// today, 44, 45, 46, balance correction): focus selects the whole amount, so the first digit replaces
// it; at most two decimals while typing; one "."; digits only; right-aligned with GH₵ on the left.
// Pasted text with more than two decimals still rounds (third digit 5 or more rounds up).

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

test("shared rule: typing replays the keys, a pasted third decimal rounds", () => {
  assert.equal(typeAmountText("4.002", "4.00"), "4.00", "a typed third decimal is not accepted");
  assert.equal(typeAmountText("4.0.", "4.0"), "4.0", "one .");
  assert.equal(typeAmountText("4a", "4"), "4", "digits only");
  assert.equal(typeAmountText("2", "4.00"), "2", "the selected amount is replaced by the first digit");
  assert.equal(typeAmountText("", "4"), "", "deleting works");
  assert.equal(typeAmountText("4.005", ""), "4.01", "pasted: rounds up from 5");
  assert.equal(typeAmountText("4.004", ""), "4.00", "pasted: below 5 is dropped");
  assert.equal(typeAmountText("1.005", "200.00"), "1.01", "pasted over the selected amount: rounds, never 1.005");
  assert.equal(typeAmountText("1.2.3", "200.00"), "200.00", "a pasted text that is not an amount is refused");
  assert.equal(typeAmountText("-1", "200.00"), "200.00", "a sign is refused");
  assert.equal(typeAmountText("GH₵ 12.50", ""), "12.50", "the sign and spaces are dropped");
  assert.equal(typeAmountText("1e2", "1"), "1", "exponent text is refused");
});

// One field, through its own screen: GH₵ on the left, right-aligned, focus selects, and the rules.
async function checkField(name, getField, rerender, { start } = {}) {
  let field = getField();
  assert.ok(field, `${name}: field`);
  assert.match(String(field.props.className), /\btext-right\b/, `${name}: right-aligned`);
  assert.equal(field.props.type, "text", `${name}: a text field (type=number allows e and -)`);
  assert.equal(field.props.inputMode, "decimal", `${name}: the decimal keyboard`);

  const type = async (value) => { getField().props.onChange({ target: { value } }); await rerender(); return getField().props.value; };
  if (start !== undefined) assert.equal(field.props.value, start, `${name}: starts with ${start}`);
  else assert.equal(await type("4.00"), "4.00");

  let selected = false;
  getField().props.onFocus({ currentTarget: { value: getField().props.value, select() { selected = true; } }, target: {} });
  assert.equal(selected, true, `${name}: focus selects the whole amount`);
  assert.equal(await type("2"), "2", `${name}: the first digit replaces the selected amount`);

  assert.equal(await type("2."), "2.");
  assert.equal(await type("2.."), "2.", `${name}: one "."`);
  assert.equal(await type("2.5"), "2.5");
  assert.equal(await type("2.50"), "2.50");
  assert.equal(await type("2.502"), "2.50", `${name}: no third decimal while typing`);
  assert.equal(await type("2.50x"), "2.50", `${name}: digits only`);
  assert.equal(await type(""), "");
  assert.equal(await type("1.005"), "1.01", `${name}: pasted text still rounds`);
}

// The GH₵ label sits before the field in the same box (on its left).
function assertSignOnLeft(name, tree, field) {
  // The field may be rendered by a component (AmountTextInput): a box child holds it.
  const holds = (kid) => kid && typeof kid === "object" && [...walk(kid)].includes(field);
  const box = nodes(tree).findLast((node) => node.type !== "input" && typeof node.type === "string" && Array.isArray(node.props.children) &&
    node.props.children.flat(Infinity).some(holds));
  assert.ok(box, `${name}: the field's box`);
  const kids = box.props.children.flat(Infinity).filter(Boolean);
  const signAt = kids.findIndex((kid) => textOf(kid).trim() === "GH₵");
  assert.ok(signAt !== -1 && signAt < kids.findIndex(holds), `${name}: GH₵ on the left of the field`);
}

test("16/27 split field: replace, no third decimal, one \".\" (4.00 then 2 is 2, never 4.002)", async () => {
  const { default: SplitPayment } = await loadJsx("src/pos/SplitPayment.jsx");
  const view = render({ type: SplitPayment, props: { totalPesewas: 800, totalLabel: "Total", doneLabel: "Done", initialParts: [{ paymentMethod: "cash", amountPesewas: 400 }], onBack() {}, onDone() {}, onMoMo() {} } });
  nodes(view.tree).find((node) => node.type === "button" && node.props["aria-label"] === "Edit Cash amount").props.onClick();
  view.rerender();
  const field = () => nodes(view.tree).find((node) => node.type === "input" && node.props.id === "split-draft-amount");
  assertSignOnLeft("16/27", view.tree, field());
  await checkField("16/27", field, () => view.rerender(), { start: "4.00" });
});

async function show19() {
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx");
  const params = { amountPesewas: 800, customer: { name: "Kofi" }, startToday: true, installmentAmount: "4.00" };
  return render({ type: CreditScreens, props: { route: "ALittleAtATime", params, onBack() {}, onNavigate() {}, onUpdateParams() {}, onSaveCredit: async () => {} } });
}

test("19 How much each time?: replace, no third decimal, one \".\"", async () => {
  const view = await show19();
  const field = () => nodes(view.tree).find((node) => node.type === "input" && node.props["aria-label"] === "How much each time?");
  assertSignOnLeft("19 each time", view.tree, field());
  await checkField("19 each time", field, () => view.rerender(), { start: "4.00" });
});

test("19 Amount paid today: replace, no third decimal, one \".\"", async () => {
  const view = await show19();
  const field = () => nodes(view.tree).find((node) => node.type === "input" && node.props["aria-label"] === "Amount paid today");
  assertSignOnLeft("19 paid today", view.tree, field());
  await checkField("19 paid today", field, () => view.rerender(), { start: "4.00" });
});

test("44 Spent money amount: replace, no third decimal, one \".\"", async () => {
  const { SpentMoney } = await loadJsx("src/pos/SupplierScreens.jsx");
  const view = render({ type: SpentMoney, props: { params: {}, onBack() {}, onNavigate() {}, onUpdateParams() {}, onSave: async () => {} } });
  const field = () => nodes(view.tree).find((node) => node.type === "input" && node.props.inputMode === "decimal");
  assertSignOnLeft("44", view.tree, field());
  await checkField("44", field, () => view.rerender());
});

test("45 Paid now: replace, no third decimal, one \".\", GH₵ on the left", async () => {
  const { StockOnCredit } = await loadJsx("src/pos/SupplierScreens.jsx");
  setLiveQuery(() => []);
  const view = render({ type: StockOnCredit, props: { params: { amountPesewas: 8000, category: "stock" }, onBack() {}, onUpdateParams() {}, onSaveExpense: async () => {} } });
  const field = () => nodes(nodes(view.tree).find((node) => node.props["data-card"] === "paid-now")).find((node) => node.type === "input");
  assertSignOnLeft("45", view.tree, field());
  await checkField("45", field, () => view.rerender());
});

test("46 Amount to pay: replace, no third decimal, one \".\"", async () => {
  const { YouOweSuppliers } = await loadJsx("src/pos/SupplierScreens.jsx");
  setLiveQuery(() => [{ id: "s1", name: "Kofi Wholesale", balancePesewas: 40000 }]);
  const view = render({ type: YouOweSuppliers, props: { onBack() {}, onPay: async () => {} } });
  nodes(view.tree).find((node) => node.type === "button" && node.props["aria-label"] === "Pay Kofi Wholesale").props.onClick();
  view.rerender();
  const field = () => nodes(view.tree).find((node) => node.type === "input" && node.props.inputMode === "decimal");
  assertSignOnLeft("46", view.tree, field());
  await checkField("46", field, () => view.rerender(), { start: "400.00" });
});

test("Correct balance (29/43): replace, no third decimal, one \".\", GH₵ on the left", async () => {
  await recordCreditSale({ name: "juju", amountPesewas: 1000, now: Date.now() - 3 * 86_400_000 });
  const debt = (await db.debts.toArray())[0];
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
  nodes(app.view.tree).find((node) => node.type?.name === "Home").props.onNavigate("DebtorDetail", { debtId: debt.id, customerName: "juju" });
  await app.settle();
  await app.tap("Correct balance");
  const field = () => nodes(app.view.tree).find((node) => node.type === "input" && node.props.id === "pos-correction-amount");
  assertSignOnLeft("correction", app.view.tree, field());
  await checkField("correction", field, () => app.settle(), { start: "10.00" });
});

test("New item price: the same field (replace, no third decimal, one \".\"), GH₵ on the left", async () => {
  const { default: ItemScreens } = await loadJsx("src/pos/ItemScreens.jsx");
  const view = render({ type: ItemScreens, props: { route: "NewItem", params: {}, onBack() {}, onNavigate() {} } });
  const field = () => nodes(view.tree).find((node) => node.type === "input" && node.props.inputMode === "decimal");
  assertSignOnLeft("new item", view.tree, field());
  await checkField("new item", field, () => view.rerender());
});

test("19 How much each time?: the capped notice is live under the field, not in the box, and goes once changed", async () => {
  const view = await show19();
  const field = () => nodes(view.tree).find((node) => node.type === "input" && node.props["aria-label"] === "How much each time?");
  const notice = () => nodes(view.tree).find((node) => node.props["data-installment-capped"] !== undefined);
  assert.equal(notice(), undefined, "fresh: no notice");
  field().props.onChange({ target: { value: "99" } });
  view.rerender();
  assert.equal(field().props.value, "8.00", "capped at the most that can be owed");
  assert.equal(textOf(notice()), "The installment was capped at the maximum allowed amount.");
  const label = nodes(view.tree).find((node) => node.type === "label" && [...walk(node)].includes(field()));
  assert.ok([...walk(label)].includes(notice()), "under the field");
  assert.equal(nodes(view.tree).filter((node) => node.props.role === "alert" && /capped/.test(textOf(node))).length, 0, "not in the error box");
  field().props.onChange({ target: { value: "5" } });
  view.rerender();
  assert.equal(notice(), undefined, "a value within the maximum: gone");
});
