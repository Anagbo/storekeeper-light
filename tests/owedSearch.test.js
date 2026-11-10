import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { loadUnpaidDebtPage } from "../src/pos/owed.js";
import { posText } from "../src/pos/i18n.js";
import { localDateString } from "../src/utils/installments.js";
import { findButton, flushEffects, loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// 32 (People who owe you): a "Search name or phone" field above the list, the same field as on 17.
// It filters the loaded list as the merchant types (ignoring case and spaces), works with All, Late
// and Due soon, clearing shows the list again, and it needs no network.
after(async () => {
  db.close();
  await db.delete();
});
beforeEach(async () => {
  await Promise.all([db.debts, db.customers].map((table) => table.clear()));
});

const day = (offset) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return localDateString(date);
};
const settle = async () => { for (let index = 0; index < 20; index += 1) await new Promise((resolve) => setTimeout(resolve, 3)); };
const EMPTY_ALL = "No one owes you right now.";

// 28 people: the 25 who owe the most are the first page; the last three need "Show more".
async function seed() {
  const people = [
    ["Ama Mensah", "0241234567", 90000, day(-3)],
    ["Kofi Boateng", "0551112222", 80000, day(3)],
    ["Yaw Owusu", "0201234567", 70000, day(20)],
    ...Array.from({ length: 22 }, (_unused, index) => [`Filler ${String(index + 1).padStart(2, "0")}`, `030000${String(index).padStart(4, "0")}`, 50000 - index * 100, ""]),
    ["Abena Tetteh", "0277654321", 2000, day(-1)],
    ["Esi Soon", "0261111111", 1900, day(2)],
    ["Efua Far", "0262222222", 1800, day(30)]
  ];
  await db.debts.bulkAdd(people.map(([customerName, phone, amountPesewas, dueDate], index) => ({
    id: `debt-${String(index).padStart(2, "0")}`, customerName, phone, status: "unpaid", amountPesewas, total_owed: amountPesewas, dueDate, isInstallmentPlan: false
  })));
}

async function openOwed() {
  await seed();
  const { default: PeopleWhoOweYou } = await loadJsx("src/pos/OwedScreens.jsx");
  const firstPage = { status: "ready", ...(await loadUnpaidDebtPage()) };
  const customerResult = { status: "ready", customers: await db.customers.toArray() };
  setLiveQuery((_deps, query) => (String(query).includes("outstanding debts") ? firstPage : customerResult));
  const view = render({ type: PeopleWhoOweYou, props: { onBack() {}, onNavigate() {}, onCollect() {}, shopName: "My shop" } });
  flushEffects(view);
  view.rerender();
  return view;
}
const searchField = (view) => [...walk(view.tree)].find((node) => node.type === "input" && node.props.placeholder === posText("credit.search"));
const type = (view, value) => { searchField(view).props.onChange({ target: { value } }); view.rerender(); };
const names = (view) => [...walk(view.tree)].filter((node) => node.type === "article").map((node) => textOf([...walk(node)].find((child) => child.type === "strong")));
const tab = (view, label) => [...walk(view.tree)].find((node) => node.props?.role === "tab" && textOf(node) === label);
const pick = (view, label) => { tab(view, label).props.onClick(); view.rerender(); };
const showMore = async (view) => { await findButton(view.tree, "Show more").props.onClick(); await settle(); view.rerender(); };
const rowCount = (view) => names(view).length;

// ---- the field -----------------------------------------------------------------------------------------------------

test("32 has the Search name or phone field above the list, always visible, with no search button", async () => {
  const view = await openOwed();
  assert.ok(searchField(view), "the field is there");
  assert.equal(rowCount(view), 25, "the first page of the list");
  const order = [...walk(view.tree)].filter((node) => node === searchField(view) || node.props?.role === "listitem" || node.props?.role === "tablist");
  assert.equal(order[0].props?.role, "tablist", "after the filters");
  assert.equal(order[1], searchField(view), "above the list");
  assert.equal([...walk(view.tree)].filter((node) => node.type === "button" && /^Search$/i.test(textOf(node))).length, 0, "no search button");
  setLiveQuery(null);
});

test("32 reuses the one search field component of 17, with the same wording", () => {
  const owed = readFileSync(new URL("../src/pos/OwedScreens.jsx", import.meta.url), "utf8");
  const credit = readFileSync(new URL("../src/pos/CreditScreens.jsx", import.meta.url), "utf8");
  const field = readFileSync(new URL("../src/pos/SearchField.jsx", import.meta.url), "utf8");
  assert.match(owed, /import SearchField from "\.\/SearchField\.jsx"/);
  assert.match(credit, /import SearchField from "\.\/SearchField\.jsx"/);
  assert.match(owed, /<SearchField /);
  assert.match(credit, /<SearchField /);
  assert.match(field, /t\("credit\.search"\)/);
  assert.doesNotMatch(credit, /placeholder=\{t\("credit\.search"\)\}/, "17 no longer carries its own copy");
  assert.equal(posText("credit.search"), "Search name or phone");
});

// ---- filtering as the merchant types -------------------------------------------------------------------------------

test("by name: as the merchant types, ignoring case and spaces", async () => {
  const view = await openOwed();
  type(view, "kofi");
  assert.deepEqual(names(view), ["Kofi Boateng"]);
  for (const typed of ["KOFI", "KoFi", "  kofi  ", "kofi b", "ko fi bo", "Kofi    Boateng", "kofiboateng", "ate"]) {
    type(view, typed);
    assert.deepEqual(names(view), ["Kofi Boateng"], JSON.stringify(typed));
  }
  type(view, "mensah");
  assert.deepEqual(names(view), ["Ama Mensah"]);
  type(view, "fill");
  assert.equal(rowCount(view), 22, "every Filler");
  type(view, "o");
  assert.ok(names(view).every((name) => name.toLowerCase().includes("o")));
  setLiveQuery(null);
});

test("by phone: full number, a part of it, with spaces", async () => {
  const view = await openOwed();
  for (const typed of ["0201234567", "020 123 4567", "0 2 0 1 2 3", "201234"]) {
    type(view, typed);
    assert.deepEqual(names(view), ["Yaw Owusu"], JSON.stringify(typed));
  }
  type(view, "0551112222");
  assert.deepEqual(names(view), ["Kofi Boateng"]);
  setLiveQuery(null);
});

test("it needs no network and changes no data", async () => {
  const view = await openOwed();
  const before = JSON.stringify(await db.debts.toArray());
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => { calls += 1; throw new Error("offline"); };
  try {
    for (const typed of ["ama", "0241", "zzz", ""]) type(view, typed);
  } finally { globalThis.fetch = originalFetch; }
  assert.equal(calls, 0);
  assert.equal(JSON.stringify(await db.debts.toArray()), before);
  const source = readFileSync(new URL("../src/pos/OwedScreens.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bfetch\(|navigator\.onLine/);
  setLiveQuery(null);
});

// ---- with the filters ------------------------------------------------------------------------------------------------

test("with All, Late and Due soon: the search narrows the filtered list", async () => {
  const view = await openOwed();
  pick(view, "Late");
  assert.deepEqual(names(view), ["Ama Mensah"], "Late alone (page 1)");
  type(view, "ama");
  assert.deepEqual(names(view), ["Ama Mensah"]);
  type(view, "kofi");
  assert.deepEqual(names(view), [], "Kofi is not late");
  pick(view, "Due soon");
  assert.deepEqual(names(view), ["Kofi Boateng"], "the search stays when the filter changes");
  type(view, "ama");
  assert.deepEqual(names(view), [], "Ama is not due soon");
  type(view, "0551");
  assert.deepEqual(names(view), ["Kofi Boateng"]);
  pick(view, "All");
  assert.deepEqual(names(view), ["Kofi Boateng"], "All shows him too");
  setLiveQuery(null);
});

test("clearing the search shows the list again, in every filter", async () => {
  const view = await openOwed();
  type(view, "kofi");
  type(view, "");
  assert.equal(rowCount(view), 25);
  pick(view, "Late");
  const lateOnly = names(view);
  type(view, "zzz");
  assert.deepEqual(names(view), []);
  type(view, "");
  assert.deepEqual(names(view), lateOnly, "Late list is back");
  pick(view, "Due soon");
  type(view, "kofi");
  type(view, "   ");
  assert.deepEqual(names(view), ["Kofi Boateng"], "spaces only is the same as empty");
  setLiveQuery(null);
});

// ---- nobody matches: the existing empty-list wording (new wording waits for approval) ------------------------------------

test("no match shows today's empty list, unchanged, and no new wording", async () => {
  const view = await openOwed();
  type(view, "zzz");
  assert.equal(rowCount(view), 0);
  const text = textOf(view.tree);
  assert.ok(text.includes(EMPTY_ALL));
  assert.ok(text.includes("Record a credit sale to see an outstanding balance here."));
  pick(view, "Late");
  assert.ok(textOf(view.tree).includes("No late debts right now."));
  pick(view, "Due soon");
  assert.ok(textOf(view.tree).includes("No due soon debts right now."));
  const field = searchField(view);
  assert.ok(field, "the field stays so the merchant can change or clear it");
  assert.equal(field.props.value, "zzz");
  setLiveQuery(null);
});

// ---- Show more with a search or a filter active ----------------------------------------------------------------------

test("Show more still loads the next page with a filter active, and the search and filter apply to what it loads", async () => {
  const view = await openOwed();
  pick(view, "Late");
  assert.deepEqual(names(view), ["Ama Mensah"]);
  assert.ok(findButton(view.tree, "Show more"), "Show more is there with Late active");
  await showMore(view);
  assert.deepEqual(names(view), ["Ama Mensah", "Abena Tetteh"], "the late person on page 2 appears");
  assert.equal(findButton(view.tree, "Show more"), null, "no more pages");
  pick(view, "Due soon");
  assert.deepEqual(names(view), ["Kofi Boateng", "Esi Soon"]);
  type(view, "esi");
  assert.deepEqual(names(view), ["Esi Soon"]);
  setLiveQuery(null);
});

test("Show more works from the empty result of a search, and the person appears", async () => {
  const view = await openOwed();
  type(view, "abena");
  assert.equal(rowCount(view), 0, "page 2 is not loaded yet");
  assert.ok(findButton(view.tree, "Show more"), "Show more is in the empty list");
  await showMore(view);
  assert.deepEqual(names(view), ["Abena Tetteh"]);
  type(view, "0262222222");
  assert.deepEqual(names(view), ["Efua Far"]);
  type(view, "");
  assert.equal(rowCount(view), 28);
  setLiveQuery(null);
});