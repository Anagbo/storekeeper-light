import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { loadUnpaidDebtPage } from "../src/pos/owed.js";
import { flushEffects, loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Phone review item 6 (25 Nov 2026), Owed list 32: with Late or Due soon on, the tile above the list
// shows only those people's total, so it reads "Late · GH₵X" or "Due soon · GH₵X", never "Total owed to
// you" with a filtered number. All keeps "Total owed to you".

globalThis.HTMLElement ??= class {};
after(async () => { setLiveQuery(null); db.close(); await db.delete(); });
beforeEach(async () => { setLiveQuery(null); await db.debts.clear(); });

const dayOffset = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const tile = (tree) => textOf([...walk(tree)].find((node) => node.props?.["data-owed-summary"] !== undefined)).replace(/\s+/g, " ").trim();
const filterButton = (tree, label) => [...walk(tree)].find((node) => node.type === "button" && textOf(node).trim() === label);

async function owedList() {
  const debt = (id, name, amountPesewas, days) => ({ id, customerId: `c-${id}`, customerName: name, status: "unpaid", amountPesewas, total_owed: amountPesewas, dueDate: dayOffset(days), isInstallmentPlan: false });
  await db.debts.bulkPut([debt("d1", "Ama", 8000, -3), debt("d2", "Kofi", 3000, 1), debt("d3", "Esi", 5000, 20)]);
  const { default: PeopleWhoOweYou } = await loadJsx("src/pos/OwedScreens.jsx");
  const firstPage = { status: "ready", ...(await loadUnpaidDebtPage()) };
  const customerResult = { status: "ready", customers: [], reminderEvents: [] };
  setLiveQuery((_deps, query) => (String(query).includes("load outstanding debts") ? firstPage : String(query).includes("search outstanding") ? null : customerResult));
  const view = render({ type: PeopleWhoOweYou, props: { onBack() {}, onNavigate() {}, onCollect() {}, shopName: "Shop" } });
  flushEffects(view);
  view.rerender();
  return view;
}

test("All: Total owed to you with everyone's total", async () => {
  const view = await owedList();
  assert.match(tile(view.tree), /^Total owed to you ?GH₵160\.00$/);
});

test("Late and Due soon: the tile names the filter with its total; All brings Total owed to you back", async () => {
  const view = await owedList();
  filterButton(view.tree, "Late").props.onClick();
  view.rerender();
  assert.equal(tile(view.tree), "Late · GH₵80.00");
  assert.doesNotMatch(tile(view.tree), /Total owed to you/);
  filterButton(view.tree, "Due soon").props.onClick();
  view.rerender();
  assert.equal(tile(view.tree), "Due soon · GH₵30.00");
  filterButton(view.tree, "All").props.onClick();
  view.rerender();
  assert.match(tile(view.tree), /^Total owed to you ?GH₵160\.00$/);
});
