import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { orderSuppliersByRecentUse } from "../src/utils/suppliers.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// 45 "Stock on credit": the supplier picker that replaces the native dropdown (wiring rules for 45).

const all = (tree, match) => [...walk(tree)].filter((node) => node.props && match(node));
const cls = (node) => String(node.props.className ?? "");
const supplier = (id, name) => ({ id, name, nameLower: name.toLowerCase(), phone: "" });

async function mount(suppliers, onSaveExpense = async () => {}) {
  const { StockOnCredit } = await loadJsx("src/pos/SupplierScreens.jsx");
  setLiveQuery(() => suppliers);
  const view = render({ type: StockOnCredit, props: { params: { amountPesewas: 8000, category: "stock" }, onBack() {}, onSaveExpense } });
  return view;
}
const radios = (tree) => all(tree, (n) => n.type === "button" && n.props.role === "radio");
const radio = (tree, id) => radios(tree).find((n) => n.props["data-supplier-id"] === id);
const newFields = (tree) => all(tree, (n) => n.props["data-new-supplier-fields"] !== undefined)[0];

test("45 picker: one card headed \"Who do you owe?\", radio rows 60px, names in bold and wrapping, + New supplier last and dashed", async () => {
  const long = "nana Akosua Frimpomaa-Boateng Wholesale Distributors and Sons";
  const view = await mount([supplier("s1", "kofi wholesale"), supplier("s2", long)]);
  const card = all(view.tree, (n) => n.props["data-card"] === "supplier")[0];
  assert.ok(card);
  assert.equal(textOf(all(card, (n) => n.type === "h2")[0]), "Who do you owe?");
  const group = all(card, (n) => n.props.role === "radiogroup")[0];
  assert.ok(group, "radiogroup");
  const rows = radios(group);
  assert.deepEqual(rows.map((n) => n.props["data-supplier-id"]), ["s1", "s2", "new"]);
  for (const row of rows) {
    assert.match(cls(row), /min-h-\[60px\]/);
    assert.match(cls(row), /\bw-full\b/);
  }
  const name = all(rows[1], (n) => n.type === "b")[0];
  assert.equal(textOf(name), "Nana Akosua Frimpomaa-Boateng Wholesale Distributors and Sons");
  assert.match(cls(name), /\[overflow-wrap:anywhere\]/);
  assert.match(cls(name), /min-w-0/);
  assert.equal(textOf(rows[0]), "Kofi Wholesale");
  assert.match(cls(rows[2]), /border-dashed/);
  assert.match(cls(rows[2]), /text-emerald-900/);
  // rules_global.button_system.add_variants (17 Nov 2026): the AddButton radio variant, "+" then the word.
  assert.equal(textOf(rows[2]), "+ New supplier");
  assert.equal(rows[2].props["data-look"], "add");
  assert.equal(rows[2].props.role, "radio");
});

test("45 picker: choosing a supplier checks only that row (green border, light green, filled circle) and Save sends it", async () => {
  const saved = [];
  const view = await mount([supplier("s1", "Kofi"), supplier("s2", "Ama")], async (input) => { saved.push(input); });
  assert.ok(radios(view.tree).every((n) => n.props["aria-checked"] === false), "nothing chosen at first");
  radio(view.tree, "s2").props.onClick();
  view.rerender();
  const chosen = radio(view.tree, "s2");
  assert.equal(chosen.props["aria-checked"], true);
  assert.equal(radio(view.tree, "s1").props["aria-checked"], false);
  assert.equal(radio(view.tree, "new").props["aria-checked"], false);
  assert.match(cls(chosen), /border-emerald-900/);
  assert.match(cls(chosen), /bg-emerald-50/);
  assert.equal(all(chosen, (n) => n.props["data-dot"] !== undefined).length, 1, "filled circle");
  assert.equal(all(radio(view.tree, "s1"), (n) => n.props["data-dot"] !== undefined).length, 0);
  all(view.tree, (n) => n.type === "button" && textOf(n) === "Save").at(-1).props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].supplierId, "s2");
  assert.equal(saved[0].newSupplier, undefined);
});

test("45 picker: + New supplier shows the name and phone fields in the same card; choosing a supplier hides them and keeps what was typed", async () => {
  const saved = [];
  const view = await mount([supplier("s1", "Kofi")], async (input) => { saved.push(input); });
  assert.equal(newFields(view.tree), undefined);
  radio(view.tree, "new").props.onClick();
  view.rerender();
  const newRow = radio(view.tree, "new");
  assert.equal(newRow.props["aria-checked"], true);
  assert.match(cls(newRow), /border-solid/);
  assert.match(cls(newRow), /bg-emerald-50/);
  const card = all(view.tree, (n) => n.props["data-card"] === "supplier")[0];
  const fields = newFields(card);
  assert.ok(fields, "fields inside the supplier card");
  assert.ok(textOf(fields).includes("Supplier name"));
  assert.ok(textOf(fields).includes("Phone (optional)"));
  const [nameInput, phoneInput] = all(fields, (n) => n.type === "input");
  nameInput.props.onChange({ target: { value: "Madam Esi" } });
  phoneInput.props.onChange({ target: { value: "0241234567" } });
  view.rerender();
  radio(view.tree, "s1").props.onClick();
  view.rerender();
  assert.equal(newFields(view.tree), undefined, "fields hidden after choosing a supplier");
  radio(view.tree, "new").props.onClick();
  view.rerender();
  const again = all(newFields(view.tree), (n) => n.type === "input");
  assert.equal(again[0].props.value, "Madam Esi", "typed name kept");
  assert.equal(again[1].props.value, "0241234567", "typed phone kept");
  all(view.tree, (n) => n.type === "button" && textOf(n) === "Save").at(-1).props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(saved[0].newSupplier, { name: "Madam Esi", phone: "0241234567" });
  assert.equal(saved[0].supplierId, undefined);
});

test("45 picker: with 6 suppliers it shows 4 and \"Show all 6 suppliers\", which shows the whole list", async () => {
  const six = ["A", "B", "C", "D", "E", "F"].map((letter, index) => supplier(`s${index + 1}`, `Supplier ${letter}`));
  const view = await mount(six);
  assert.deepEqual(radios(view.tree).map((n) => n.props["data-supplier-id"]), ["s1", "s2", "s3", "s4", "new"]);
  const showAll = all(view.tree, (n) => n.type === "button" && n.props["data-show-all"] !== undefined)[0];
  assert.ok(showAll);
  assert.equal(textOf(showAll), "Show all 6 suppliers");
  showAll.props.onClick();
  view.rerender();
  assert.deepEqual(radios(view.tree).map((n) => n.props["data-supplier-id"]), ["s1", "s2", "s3", "s4", "s5", "s6", "new"]);
  assert.equal(all(view.tree, (n) => n.props["data-show-all"] !== undefined).length, 0);
  // Exactly 4: no Show all row.
  const four = await mount(six.slice(0, 4));
  assert.equal(all(four.tree, (n) => n.props["data-show-all"] !== undefined).length, 0);
});

test("45 picker: the 4 shown are the most recently used (newest linked transaction, then when added)", () => {
  const records = [
    { id: "a", name: "A", createdAt: 1 }, { id: "b", name: "B", createdAt: 2 }, { id: "c", name: "C", createdAt: 3 },
    { id: "d", name: "D", createdAt: 4 }, { id: "e", name: "E", createdAt: 5 }, { id: "f", name: "F", createdAt: 6 }
  ];
  const transactions = [
    { supplierId: "a", createdAt: 900 }, { supplierId: "c", createdAt: 500 }, { supplierId: "a", createdAt: 100 },
    { supplierId: "b", createdAt: 700 }, { customerId: "x", createdAt: 999 }
  ];
  assert.deepEqual(orderSuppliersByRecentUse(records, transactions).map((s) => s.id), ["a", "b", "c", "f", "e", "d"]);
  assert.deepEqual(records.map((s) => s.id), ["a", "b", "c", "d", "e", "f"], "input not reordered");
});

test("45 picker: with no suppliers only + New supplier is shown, already selected, with its fields open", async () => {
  const saved = [];
  const view = await mount([], async (input) => { saved.push(input); });
  const rows = radios(view.tree);
  assert.deepEqual(rows.map((n) => n.props["data-supplier-id"]), ["new"]);
  assert.equal(rows[0].props["aria-checked"], true);
  assert.ok(newFields(view.tree), "fields open");
  all(newFields(view.tree), (n) => n.type === "input")[0].props.onChange({ target: { value: "Kofi" } });
  view.rerender();
  all(view.tree, (n) => n.type === "button" && textOf(n) === "Save").at(-1).props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(saved[0].newSupplier, { name: "Kofi", phone: "" });
});

test("45: no <select> is rendered, and none is left in the POS for choosing a supplier or customer", async () => {
  for (const list of [[], [supplier("s1", "Kofi")], ["A", "B", "C", "D", "E"].map((x) => supplier(x, x))]) {
    const view = await mount(list);
    assert.equal(all(view.tree, (n) => n.type === "select" || n.type === "option").length, 0);
  }
  assert.doesNotMatch(readFileSync(new URL("../src/pos/SupplierScreens.jsx", import.meta.url), "utf8"), /<select|<option/);
});

test("45 layout order: totals card (Still owed dark red), Paid now card, supplier card, Pay by card with the date picker, Save last", async () => {
  const view = await mount([supplier("s1", "Kofi")]);
  const order = all(view.tree, (n) => n.props["data-card"] !== undefined).map((n) => n.props["data-card"]);
  assert.deepEqual(order, ["totals", "paid-now", "supplier", "pay-by"]);
  const totals = all(view.tree, (n) => n.props["data-card"] === "totals")[0];
  assert.ok(textOf(totals).includes("Stock total") && textOf(totals).includes("Still owed"));
  assert.match(cls(all(totals, (n) => n.props["data-still-owed"] !== undefined)[0]), /text-rose-800/);
  const paid = all(view.tree, (n) => n.props["data-card"] === "paid-now")[0];
  assert.ok(textOf(paid).includes("Paid now"));
  assert.match(cls(all(paid, (n) => n.type === "input")[0]), /text-right/);
  const payBy = all(view.tree, (n) => n.props["data-card"] === "pay-by")[0];
  assert.ok(textOf(payBy).includes("Pay by (optional)"));
  assert.equal(all(payBy, (n) => n.type === "input")[0].props.type, "date");
  const nodes = [...walk(view.tree)];
  const save = nodes.filter((n) => n.type === "button" && textOf(n) === "Save").at(-1);
  assert.ok(nodes.indexOf(save) > nodes.indexOf(payBy), "Save is at the end");
  assert.match(cls(save), /bg-emerald-900/);
});
