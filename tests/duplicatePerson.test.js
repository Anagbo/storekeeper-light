import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { findDuplicatePerson, personNameKey } from "../src/pos/duplicatePerson.js";
import { findButton, flushEffects, loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// rules_global.duplicate_person (25 Nov 2026): a new customer or supplier is checked by name (trimmed,
// any case) and phone against everyone known, people who owe 0 included. A match asks inline:
// "Use this person" (primary) or "Save as a new person". Never a silent duplicate.

globalThis.HTMLElement ??= class {};
after(async () => { setLiveQuery(null); db.close(); await db.delete(); });
beforeEach(async () => {
  setLiveQuery(null);
  await Promise.all([db.debts, db.customers, db.transactions, db.payments].map((table) => table.clear()));
});

const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 3)); };
const inputs = (tree) => [...walk(tree)].filter((node) => node.type === "input");
const question = (tree) => [...walk(tree)].find((node) => node.props?.["data-duplicate-person"] !== undefined);
const submit = (view) => [...walk(view.tree)].find((node) => node.type === "form").props.onSubmit({ preventDefault() {} });

async function type(view, input, value) {
  input.props.onChange({ target: { value } });
  view.rerender();
  flushEffects(view);
  await settle();
  view.rerender();
}

// Kofi owed GH₵20.00 and paid it all: he owes 0 and is not on the lists, but he exists.
async function seedKofiPaidOff() {
  await recordCreditSale({ name: "Kofi Mensah", phone: "0244123456", amountPesewas: 2000, initialPaymentPesewas: 2000, paymentMethod: "cash", note: "Sale", saleItems: [] });
}

async function newPerson(navigated) {
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx");
  return render({ type: CreditScreens, props: { route: "NewPerson", params: { manualDebt: true }, onBack() {}, onNavigate: (...args) => navigated.push(args), onUpdateParams() {} } });
}

test("the match rule: name trimmed and any case, phone in any Ghana form, name first, nothing else", () => {
  const people = [{ id: "a", name: "Kofi Mensah", phone: "0244123456" }, { id: "b", name: "Ama", phone: "" }];
  assert.equal(personNameKey("  kofi   MENSAH "), "kofi mensah");
  assert.deepEqual(findDuplicatePerson(people, { name: " kofi mensah " }), { person: people[0], by: "name" });
  assert.deepEqual(findDuplicatePerson(people, { name: "Esi", phone: "+233 24 412 3456" }), { person: people[0], by: "phone" });
  assert.deepEqual(findDuplicatePerson(people, { name: "AMA", phone: "0244123456" }), { person: people[1], by: "name" });
  assert.equal(findDuplicatePerson(people, { name: "Esi", phone: "024" }), null, "a part number is not a match");
  assert.equal(findDuplicatePerson(people, { name: "Esi", phone: "0201112222" }), null);
  assert.equal(findDuplicatePerson(people, {}), null);
});

test("New person: an existing name that owes 0 asks the question; Next waits; Use this person goes on with that person", async () => {
  await seedKofiPaidOff();
  const navigated = [];
  const view = await newPerson(navigated);
  await type(view, inputs(view.tree)[0], "Kofi Mensah");
  const q = question(view.tree);
  assert.ok(q, "the question is shown");
  assert.equal(q.props["data-duplicate-person"], "name");
  assert.match(textOf(q), /^Kofi Mensah already exists \(owes GH₵0\.00\)\. Use this person\?/);
  assert.equal(findButton(view.tree, "Use this person").props["data-look"], "main", "Use this person is the primary");
  assert.equal(findButton(view.tree, "Save as a new person").props["data-look"], "other");
  submit(view);
  assert.equal(navigated.length, 0, "Next does not save a silent duplicate");
  findButton(view.tree, "Use this person").props.onClick();
  assert.equal(navigated.length, 1);
  assert.equal(navigated[0][0], "ManualDebtAmount");
  assert.equal(navigated[0][1].customer.name, "Kofi Mensah");
  assert.equal(navigated[0][1].customer.totalDebtPesewas, 0);
  assert.equal(navigated[0][1].isNewCustomer, undefined);
});

test("New person: the same name in another case matches; Save as a new person asks for a name that tells them apart", async () => {
  await seedKofiPaidOff();
  const navigated = [];
  const view = await newPerson(navigated);
  await type(view, inputs(view.tree)[0], "  kofi MENSAH ");
  assert.equal(question(view.tree)?.props["data-duplicate-person"], "name");
  findButton(view.tree, "Save as a new person").props.onClick();
  view.rerender();
  assert.ok([...walk(view.tree)].some((node) => node.props?.["data-duplicate-rename"] !== undefined), "the rename helper is shown");
  submit(view);
  assert.equal(navigated.length, 0, "the same name is not saved again");
  await type(view, inputs(view.tree)[0], "Kofi Mensah Tema");
  assert.equal(question(view.tree), undefined);
  submit(view);
  assert.equal(navigated.length, 1);
  assert.equal(navigated[0][1].customer.name, "Kofi Mensah Tema");
  assert.equal(navigated[0][1].isNewCustomer, true);
});

test("New person: the same phone with another name asks under the phone; Save as a new person then saves the new person", async () => {
  await seedKofiPaidOff();
  const navigated = [];
  const view = await newPerson(navigated);
  await type(view, inputs(view.tree)[0], "Esi");
  await type(view, inputs(view.tree)[1], "+233 24 412 3456");
  const q = question(view.tree);
  assert.equal(q?.props["data-duplicate-person"], "phone");
  assert.match(textOf(q), /Kofi Mensah already exists/);
  submit(view);
  assert.equal(navigated.length, 0);
  findButton(view.tree, "Save as a new person").props.onClick();
  view.rerender();
  assert.equal(question(view.tree), undefined, "answered: the question goes");
  submit(view);
  assert.equal(navigated.length, 1);
  assert.equal(navigated[0][1].customer.name, "Esi");
  assert.equal(navigated[0][1].isNewCustomer, true);
});

test("New person: no match, no question, Next goes on", async () => {
  await seedKofiPaidOff();
  const navigated = [];
  const view = await newPerson(navigated);
  await type(view, inputs(view.tree)[0], "Esi");
  await type(view, inputs(view.tree)[1], "0201112222");
  assert.equal(question(view.tree), undefined);
  submit(view);
  assert.equal(navigated.length, 1);
});

test("New supplier on Stock on credit: a known supplier owed 0 matches by name or phone; Use this person picks it", async () => {
  const { StockOnCredit } = await loadJsx("src/pos/SupplierScreens.jsx");
  setLiveQuery(() => [{ id: "s1", name: "Kofi Wholesale", nameLower: "kofi wholesale", phone: "0244123456", balancePesewas: 0 }]);
  const saved = [];
  const view = render({ type: StockOnCredit, props: { params: { amountPesewas: 8000, category: "stock", stockNewSupplier: true }, onBack() {}, onUpdateParams() {}, onSaveExpense: async (details) => { saved.push(details); } } });
  const fields = () => inputs([...walk(view.tree)].find((node) => node.props?.["data-new-supplier-fields"] !== undefined));
  fields()[0].props.onChange({ target: { value: "kofi wholesale " } });
  view.rerender();
  assert.equal(question(view.tree)?.props["data-duplicate-person"], "name");
  assert.match(textOf(question(view.tree)), /Kofi Wholesale already exists \(you owe GH₵0\.00\)\. Use this person\?/);
  await [...walk(view.tree)].find((node) => node.type === "button" && textOf(node).trim() === "Save").props.onClick();
  assert.equal(saved.length, 0, "Save waits for the answer");
  fields()[0].props.onChange({ target: { value: "Ama Stores" } });
  fields()[1].props.onChange({ target: { value: "024 412 3456" } });
  view.rerender();
  assert.equal(question(view.tree)?.props["data-duplicate-person"], "phone");
  findButton(view.tree, "Use this person").props.onClick();
  view.rerender();
  assert.equal([...walk(view.tree)].find((node) => node.type === "button" && node.props?.["data-supplier-id"] === "s1")?.props["aria-checked"], true, "the known supplier is chosen");
  assert.equal(question(view.tree), undefined);
});
