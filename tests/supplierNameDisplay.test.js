import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { displayName } from "../src/lib/displayName.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Supplier names are shown with a capital first letter everywhere (45, 46, the Pay sheet),
// through one shared helper. The stored name is never changed.

const all = (tree, match) => [...walk(tree)].filter((node) => node.props && match(node));

test("displayName: capital first letter, the rest as stored", () => {
  assert.equal(displayName("kofi wholesale"), "Kofi wholesale");
  assert.equal(displayName("Kofi Wholesale"), "Kofi Wholesale");
  assert.equal(displayName("  ama"), "Ama");
  assert.equal(displayName(""), "");
  assert.equal(displayName(undefined), "");
  assert.equal(displayName("ésther"), "Ésther");
});

test("stored \"kofi wholesale\" shows as \"Kofi wholesale\" on 45 (picker row)", async () => {
  const { StockOnCredit } = await loadJsx("src/pos/SupplierScreens.jsx");
  const stored = { id: "s1", name: "kofi wholesale", nameLower: "kofi wholesale" };
  setLiveQuery(() => [stored]);
  const view = render({ type: StockOnCredit, props: { params: { amountPesewas: 8000 }, onBack() {}, onSaveExpense: async () => {} } });
  const row = all(view.tree, (n) => n.props.role === "radio" && n.props["data-supplier-id"] === "s1")[0];
  assert.equal(textOf(row), "Kofi wholesale");
  assert.equal(stored.name, "kofi wholesale");
});

test("stored \"kofi wholesale\" shows as \"Kofi wholesale\" on 46 (card, Pay, Call) and in the Pay sheet", async () => {
  const { YouOweSuppliers } = await loadJsx("src/pos/SupplierScreens.jsx");
  const stored = { id: "s1", name: "kofi wholesale", phone: "0241234567", balancePesewas: 5000, nextDueDate: "" };
  setLiveQuery(() => [stored]);
  const view = render({ type: YouOweSuppliers, props: { onBack() {}, onPay() {} } });
  assert.equal(textOf(all(view.tree, (n) => n.type === "h2")[0]), "Kofi wholesale");
  assert.equal(all(view.tree, (n) => n.props["aria-label"] === "Call Kofi wholesale").length, 1);
  const pay = all(view.tree, (n) => n.props["aria-label"] === "Pay Kofi wholesale")[0];
  pay.props.onClick();
  const sheet = all(view.rerender().tree, (n) => n.props.role === "dialog")[0];
  assert.equal(textOf(all(sheet, (n) => n.type === "h2")[0]), "Pay Kofi wholesale");
  assert.equal(stored.name, "kofi wholesale");
});

test("one shared helper: SupplierScreens has no copy of its own and shows no raw supplier name", () => {
  const source = readFileSync(new URL("../src/pos/SupplierScreens.jsx", import.meta.url), "utf8");
  assert.match(source, /import \{ displayName \} from "\.\.\/lib\/displayName\.js";/);
  assert.doesNotMatch(source, /function displayName/);
  assert.doesNotMatch(source, /toUpperCase\(\)/);
  assert.doesNotMatch(source, />\{(selectedS|s)upplier\.name\}</, "no raw name as visible text");
  assert.doesNotMatch(source, /name: (selectedS|s)upplier\.name \}/);
});
