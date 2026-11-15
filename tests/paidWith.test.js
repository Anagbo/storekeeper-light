import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordExpense, recordSupplierPayment } from "../src/db/suppliers.js";
import { importDatabaseFromJson } from "../src/utils/backup.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Wiring 44/45/46 "Paid with": Cash or MoMo (default Cash) under Paid all now? on 44 and stored with
// the expense; on 45 when Paid now is above zero; at Pay on 46. Stored as paidWith; older records have
// none and are not migrated.

after(async () => {
  setLiveQuery(null);
  db.close();
  await db.delete();
});
beforeEach(async () => {
  setLiveQuery(null);
  await Promise.all(["transactions", "suppliers"].map((name) => db.table(name).clear()));
});

const nodes = (view) => [...walk(view.tree)];
const paidWithButtons = (view) => nodes(view).filter((node) => node.type === "button" && node.props["aria-pressed"] !== undefined && /^(Cash|MoMo)$/.test(textOf(node).trim()));
const pressed = (view) => paidWithButtons(view).find((node) => node.props["aria-pressed"] === true);
const tapMethod = (view, label) => { paidWithButtons(view).find((node) => textOf(node).trim() === label).props.onClick(); view.rerender(); };
const button = (view, label) => nodes(view).filter((node) => node.type === "button" && textOf(node).trim() === label).at(-1);

// ---- the data ----------------------------------------------------------------------------------------------

test("an expense paid now stores paidWith (Cash or MoMo)", async () => {
  const cash = await recordExpense({ amountPesewas: 500, paidAmountPesewas: 500, category: "transport", paidWith: "cash" });
  const momo = await recordExpense({ amountPesewas: 700, paidAmountPesewas: 700, category: "rent", paidWith: "momo" });
  assert.equal((await db.transactions.get(cash.id)).paidWith, "cash");
  assert.equal((await db.transactions.get(momo.id)).paidWith, "momo");
});

test("stock bought fully on credit (nothing paid now) stores no method; part paid now stores it", async () => {
  await db.suppliers.add({ id: "s1", name: "Kofi", nameLower: "kofi", phone: "" });
  const owed = await recordExpense({ amountPesewas: 1000, paidAmountPesewas: 0, category: "stock", supplierId: "s1", paidWith: "momo" });
  assert.equal("paidWith" in (await db.transactions.get(owed.id)), false);
  const part = await recordExpense({ amountPesewas: 1000, paidAmountPesewas: 400, category: "stock", supplierId: "s1", paidWith: "momo" });
  assert.equal((await db.transactions.get(part.id)).paidWith, "momo");
});

test("a supplier payment stores paidWith", async () => {
  await db.suppliers.add({ id: "s1", name: "Kofi", nameLower: "kofi", phone: "" });
  await recordExpense({ amountPesewas: 1000, paidAmountPesewas: 0, category: "stock", supplierId: "s1" });
  const payment = await recordSupplierPayment({ supplierId: "s1", amountPesewas: 600, paidWith: "momo" });
  assert.equal((await db.transactions.get(payment.id)).paidWith, "momo");
});

test("an unknown method is refused and writes nothing", async () => {
  await assert.rejects(recordExpense({ amountPesewas: 500, paidAmountPesewas: 500, category: "other", paidWith: "bank" }), /Cash or MoMo/);
  await db.suppliers.add({ id: "s1", name: "Kofi", nameLower: "kofi", phone: "" });
  await assert.rejects(recordSupplierPayment({ supplierId: "s1", amountPesewas: 100, paidWith: "card" }), /Cash or MoMo/);
  assert.equal(await db.transactions.count(), 0);
});

test("old records: an expense or supplier payment saved without a method keeps none (no migration)", async () => {
  await db.transactions.add({ id: "old-1", type: "expense", category: "rent", amountPesewas: 900, total_amount: 900, paidAmountPesewas: 900, owedAmountPesewas: 0, payment_method: "cash", createdAt: 1, timestamp: 1, updatedAt: 1 });
  await recordExpense({ amountPesewas: 500, paidAmountPesewas: 500, category: "transport", paidWith: "momo" });
  const old = await db.transactions.get("old-1");
  assert.equal(old.paidWith, undefined, "never filled in from payment_method");
  assert.equal(old.payment_method, "cash", "left exactly as it was");
});

test("backup: paidWith is restored, an old backup without it restores, an unknown value is refused", async () => {
  const backup = (transactions) => ({ text: async () => JSON.stringify({ app: "StoreKeeper Light", formatVersion: 1, exportedAt: "", data: { transactions, customers: [], debts: [], products: [], payments: [], suppliers: [] } }) });
  const row = (id, extra = {}) => ({ id, type: "expense", category: "rent", amountPesewas: 100, total_amount: 100, paidAmountPesewas: 100, payment_method: "cash", createdAt: 5, timestamp: 5, updatedAt: 5, ...extra });
  await importDatabaseFromJson(backup([row("e1", { paidWith: "momo" }), row("e2")]));
  assert.equal((await db.transactions.get("e1")).paidWith, "momo");
  assert.equal((await db.transactions.get("e2")).paidWith, undefined);
  await assert.rejects(importDatabaseFromJson(backup([row("e3", { paidWith: "bank" })])), /unknown payment method/);
});

// ---- 44 Spent money ---------------------------------------------------------------------------------------

async function spentMoney(params = {}) {
  const { SpentMoney } = await loadJsx("src/pos/SupplierScreens.jsx");
  const saved = [];
  const navigated = [];
  const updates = [];
  const view = render({ type: SpentMoney, props: { params, onBack() {}, onNavigate: (...args) => navigated.push(args), onUpdateParams: (patch) => updates.push(patch), onSave: async (details) => { saved.push(details); } } });
  const typeAmount = (text) => { nodes(view).find((node) => node.type === "input" && node.props.inputMode === "decimal").props.onChange({ target: { value: text } }); view.rerender(); };
  return { view, saved, navigated, updates, typeAmount };
}

test("44: Paid with sits under Paid all now?, Cash selected by default, with icons", async () => {
  const { view } = await spentMoney();
  const all = nodes(view);
  const paidAll = all.find((node) => node.type === "legend" && textOf(node) === "Paid all now?");
  const paidWith = all.find((node) => node.type === "legend" && textOf(node) === "Paid with");
  assert.ok(paidAll && paidWith);
  assert.ok(all.indexOf(paidAll) < all.indexOf(paidWith), "under Paid all now?");
  assert.equal(textOf(pressed(view)).trim(), "Cash");
  for (const choice of paidWithButtons(view)) assert.ok([...walk(choice)].some((node) => typeof node.type === "function" || node.type === "svg"), `${textOf(choice)} has its icon`);
});

test("44: Save (paid all now) stores the chosen method: Cash by default, MoMo when chosen", async () => {
  let screen = await spentMoney();
  screen.typeAmount("12.50");
  await button(screen.view, "Save").props.onClick();
  assert.equal(screen.saved[0].paidWith, "cash");
  assert.equal(screen.saved[0].paidAmountPesewas, 1250);

  screen = await spentMoney();
  screen.typeAmount("8");
  tapMethod(screen.view, "MoMo");
  assert.equal(textOf(pressed(screen.view)).trim(), "MoMo");
  assert.deepEqual(screen.updates.at(-1), { expensePaidWith: "momo" }, "kept in the draft");
  await button(screen.view, "Save").props.onClick();
  assert.equal(screen.saved[0].paidWith, "momo");
});

test("44: No goes to 45 and saves nothing (the method is asked there or at Pay on 46)", async () => {
  const { view, saved, navigated, typeAmount } = await spentMoney();
  typeAmount("20");
  button(view, "No").props.onClick();
  assert.equal(saved.length, 0);
  assert.equal(navigated[0][0], "StockOnCredit");
  assert.equal("paidWith" in navigated[0][1], false);
});

// ---- 45 Stock on credit -----------------------------------------------------------------------------------

async function stockOnCredit(params) {
  const { StockOnCredit } = await loadJsx("src/pos/SupplierScreens.jsx");
  setLiveQuery(() => [{ id: "s1", name: "Kofi", nameLower: "kofi" }]);
  const saved = [];
  const view = render({ type: StockOnCredit, props: { params: { amountPesewas: 1000, category: "stock", stockSupplierId: "s1", ...params }, onBack() {}, onUpdateParams() {}, onSaveExpense: async (details) => { saved.push(details); } } });
  const paidNow = (text) => { nodes(view).find((node) => node.type === "input" && node.props.inputMode === "decimal").props.onChange({ target: { value: text } }); view.rerender(); };
  return { view, saved, paidNow };
}

test("45: nothing paid now: no Paid with, and no method saved", async () => {
  const { view, saved } = await stockOnCredit({});
  assert.equal(paidWithButtons(view).length, 0);
  await button(view, "Save").props.onClick();
  assert.equal(saved[0].paidAmountPesewas, 0);
  assert.equal("paidWith" in saved[0], false);
});

test("45: Paid now above zero asks Paid with (default Cash) and saves it", async () => {
  let screen = await stockOnCredit({});
  screen.paidNow("4.00");
  assert.equal(textOf(pressed(screen.view)).trim(), "Cash");
  await button(screen.view, "Save").props.onClick();
  assert.equal(screen.saved[0].paidAmountPesewas, 400);
  assert.equal(screen.saved[0].paidWith, "cash");

  screen = await stockOnCredit({});
  screen.paidNow("4.00");
  tapMethod(screen.view, "MoMo");
  await button(screen.view, "Save").props.onClick();
  assert.equal(screen.saved[0].paidWith, "momo");
});

// ---- 46 Pay ----------------------------------------------------------------------------------------------

test("46: the Pay sheet asks Paid with (default Cash) and records it", async () => {
  const { YouOweSuppliers } = await loadJsx("src/pos/SupplierScreens.jsx");
  setLiveQuery(() => [{ id: "s1", name: "Kofi", phone: "", balancePesewas: 1000, nextDueDate: "" }]);
  const paid = [];
  const view = render({ type: YouOweSuppliers, props: { onBack() {}, onPay: async (...args) => { paid.push(args); } } });
  nodes(view).find((node) => node.type === "button" && node.props["aria-label"] === "Pay Kofi").props.onClick();
  view.rerender();
  assert.equal(textOf(pressed(view)).trim(), "Cash");
  tapMethod(view, "MoMo");
  await button(view, "Record payment").props.onClick();
  assert.deepEqual(paid, [["s1", 1000, "momo"]]);
});
