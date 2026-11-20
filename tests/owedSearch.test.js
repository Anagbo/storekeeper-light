import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { loadAllUnpaidDebts, loadUnpaidDebtPage } from "../src/pos/owed.js";
import { posText } from "../src/pos/i18n.js";
import { localDateString } from "../src/utils/installments.js";
import { findButton, flushEffects, loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// 32 (People who owe you): a "Search by name or phone" field above the list, the same field as on 17.
// With text in it the screen searches EVERY open debt (not only the rows loaded so far), ignoring
// case and spaces, together with All, Late and Due soon, and pages the results. Clearing it returns
// to the normal list. 17 uses the same matching rule. No network.
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
const NO_MATCH = "No one matches that search.";

// 28 people: the 25 who owe the most are the first page; the last three need "Show more".
const PEOPLE = [
  ["Ama Mensah", "0241234567", 90000, day(-3)],
  ["Kofi Boateng", "0551112222", 80000, day(3)],
  ["Yaw Owusu", "0201234567", 70000, day(20)],
  ...Array.from({ length: 22 }, (_unused, index) => [`Filler ${String(index + 1).padStart(2, "0")}`, `030000${String(index).padStart(4, "0")}`, 50000 - index * 100, ""]),
  ["Abena Tetteh", "0277654321", 2000, day(-1)],
  ["Esi Soon", "0261111111", 1900, day(2)],
  ["Efua Far", "0262222222", 1800, day(30)]
];
async function seed() {
  await db.debts.bulkAdd(PEOPLE.map(([customerName, phone, amountPesewas, dueDate], index) => ({
    id: `debt-${String(index).padStart(2, "0")}`, customerName, phone, status: "unpaid", amountPesewas, total_owed: amountPesewas, dueDate, isInstallmentPlan: false
  })));
}

async function openOwed() {
  await seed();
  const { default: PeopleWhoOweYou } = await loadJsx("src/pos/OwedScreens.jsx");
  const firstPage = { status: "ready", ...(await loadUnpaidDebtPage()) };
  const customerResult = { status: "ready", customers: await db.customers.toArray() };
  const everyDebt = { status: "ready", debts: await loadAllUnpaidDebts() };
  setLiveQuery((_deps, query) => {
    const source = String(query);
    if (source.includes("search outstanding debts")) return everyDebt;
    return source.includes("load outstanding debts") ? firstPage : customerResult;
  });
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
const personNames = PEOPLE.map(([name]) => name);

// ---- the field -----------------------------------------------------------------------------------------------------

test("32 has the Search by name or phone field above the list, always visible, with no search button", async () => {
  const view = await openOwed();
  assert.ok(searchField(view), "the field is there");
  assert.equal(searchField(view).props["aria-label"], "Search by name or phone", "the accessible name from the contract");
  assert.equal(rowCount(view), 25, "the first page of the list");
  const order = [...walk(view.tree)].filter((node) => node === searchField(view) || node.props?.role === "listitem" || node.props?.role === "tablist");
  assert.equal(order[0].props?.role, "tablist", "after the filters");
  assert.equal(order[1], searchField(view), "above the list");
  assert.equal([...walk(view.tree)].filter((node) => node.type === "button" && /^Search$/i.test(textOf(node))).length, 0, "no search button");
  setLiveQuery(null);
});

test("17 and 32 share the one search field component, and the accessible name is Search by name or phone", () => {
  const owed = readFileSync(new URL("../src/pos/OwedScreens.jsx", import.meta.url), "utf8");
  const credit = readFileSync(new URL("../src/pos/CreditScreens.jsx", import.meta.url), "utf8");
  const field = readFileSync(new URL("../src/pos/SearchField.jsx", import.meta.url), "utf8");
  assert.match(owed, /import SearchField from "\.\/SearchField\.jsx"/);
  assert.match(credit, /import SearchField from "\.\/SearchField\.jsx"/);
  assert.match(owed, /<SearchField /);
  assert.match(credit, /<SearchField /);
  assert.match(field, /aria-label=\{t\("credit\.searchLabel"\)\}/);
  assert.equal(posText("credit.searchLabel"), "Search by name or phone");
  assert.equal(posText("credit.search"), "Search name or phone", "the visible hint is unchanged");
});

// ---- filtering as the merchant types: every open debt -----------------------------------------------------------------

test("by name, ignoring case and spaces", async () => {
  const view = await openOwed();
  for (const typed of ["kofi", "KOFI", "KoFi", "  kofi  ", "kofi b", "ko fi bo", "Kofi    Boateng", "kofiboateng", "oate"]) {
    type(view, typed);
    assert.deepEqual(names(view), ["Kofi Boateng"], JSON.stringify(typed));
  }
  type(view, "fill");
  assert.equal(rowCount(view), 22, "every Filler");
  setLiveQuery(null);
});

test("by phone: full number, a part of it, with spaces", async () => {
  const view = await openOwed();
  for (const typed of ["0201234567", "020 123 4567", "0 2 0 1 2 3", "201234"]) {
    type(view, typed);
    assert.deepEqual(names(view), ["Yaw Owusu"], JSON.stringify(typed));
  }
  setLiveQuery(null);
});

test("someone on a later page is found without tapping Show more", async () => {
  const view = await openOwed();
  assert.ok(!names(view).includes("Abena Tetteh"), "not in the loaded first page");
  type(view, "abena");
  assert.deepEqual(names(view), ["Abena Tetteh"]);
  type(view, "0262222222");
  assert.deepEqual(names(view), ["Efua Far"]);
  type(view, "es i");
  assert.deepEqual(names(view), ["Esi Soon"]);
  setLiveQuery(null);
});

test("many results are paged 25 at a time, with Show more, and clearing returns to the normal list", async () => {
  const view = await openOwed();
  const expected = personNames.filter((name) => name.toLowerCase().includes("e"));
  assert.ok(expected.length > 25, "the fixture has more than one page of matches");
  type(view, "e");
  assert.equal(rowCount(view), 25, "the first page of results");
  assert.ok(findButton(view.tree, "Show more"));
  await showMore(view);
  assert.equal(rowCount(view), expected.length, "every match after Show more, including page 2 people");
  assert.equal(findButton(view.tree, "Show more"), null);
  type(view, "");
  assert.equal(rowCount(view), 25, "the normal list again");
  assert.ok(findButton(view.tree, "Show more"), "with its own Show more for the rest of the debts");
  assert.ok(!names(view).includes("Abena Tetteh"));
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

// ---- with each filter ---------------------------------------------------------------------------------------------------

test("with All, Late and Due soon: the search covers every debt and narrows the filtered list", async () => {
  const view = await openOwed();
  pick(view, "Late");
  assert.deepEqual(names(view), ["Ama Mensah"], "Late alone shows the loaded page");
  type(view, "abena");
  assert.deepEqual(names(view), ["Abena Tetteh"], "a late person from page 2");
  type(view, "ama");
  assert.deepEqual(names(view), ["Ama Mensah"]);
  type(view, "kofi");
  assert.deepEqual(names(view), [], "Kofi is not late");
  pick(view, "Due soon");
  assert.deepEqual(names(view), ["Kofi Boateng"], "the search stays when the filter changes");
  type(view, "esi");
  assert.deepEqual(names(view), ["Esi Soon"], "a due soon person from page 2");
  type(view, "ama");
  assert.deepEqual(names(view), [], "Ama is not due soon");
  pick(view, "All");
  assert.deepEqual(names(view), ["Ama Mensah"]);
  setLiveQuery(null);
});

// ---- clearing -------------------------------------------------------------------------------------------------------------

test("clearing the search shows the normal list again, in every filter", async () => {
  const view = await openOwed();
  type(view, "kofi");
  type(view, "");
  assert.equal(rowCount(view), 25);
  pick(view, "Late");
  const lateOnly = names(view);
  type(view, "zzz");
  assert.deepEqual(names(view), []);
  type(view, "");
  assert.deepEqual(names(view), lateOnly, "the Late list is back");
  pick(view, "Due soon");
  type(view, "kofi");
  type(view, "   ");
  assert.deepEqual(names(view), ["Kofi Boateng"], "spaces only is the same as empty");
  setLiveQuery(null);
});

// ---- nobody matches ---------------------------------------------------------------------------------------------------------

test("no match under All, Late and Due soon says No one matches that search.", async () => {
  const view = await openOwed();
  for (const label of ["All", "Late", "Due soon"]) {
    pick(view, label);
    type(view, "zzz");
    assert.equal(rowCount(view), 0, label);
    const text = textOf(view.tree);
    assert.ok(text.includes(NO_MATCH), label);
    assert.ok(!text.includes(EMPTY_ALL), `${label}: not the no-search text`);
    assert.ok(!text.includes("Record a credit sale"), label);
    assert.ok(!text.includes("right now"), label);
    assert.equal(findButton(view.tree, "Show more"), null, `${label}: everything was searched`);
    assert.equal(searchField(view).props.value, "zzz", "the field stays");
    type(view, "");
  }
  // A person who exists but not under this filter is also "no match" under it.
  pick(view, "Late");
  type(view, "kofi");
  assert.ok(textOf(view.tree).includes(NO_MATCH));
  setLiveQuery(null);
});

test("with no search the existing empty texts stay", async () => {
  const { default: PeopleWhoOweYou } = await loadJsx("src/pos/OwedScreens.jsx");
  const firstPage = { status: "ready", ...(await loadUnpaidDebtPage()) };
  setLiveQuery((_deps, query) => (String(query).includes("search outstanding debts") ? { status: "ready", debts: [] } : String(query).includes("load outstanding debts") ? firstPage : { status: "ready", customers: [] }));
  const view = render({ type: PeopleWhoOweYou, props: { onBack() {}, onNavigate() {}, onCollect() {}, shopName: "My shop" } });
  flushEffects(view);
  view.rerender();
  assert.ok(textOf(view.tree).includes(EMPTY_ALL));
  assert.ok(textOf(view.tree).includes("Record a credit sale to see an outstanding balance here."));
  pick(view, "Late");
  assert.ok(textOf(view.tree).includes("No late debts right now."));
  pick(view, "Due soon");
  assert.ok(textOf(view.tree).includes("No due soon debts right now."));
  assert.ok(!textOf(view.tree).includes(NO_MATCH));
  setLiveQuery(null);
});

// ---- Show more of the normal list still works with a filter ---------------------------------------------------------------------

test("without a search, Show more still loads the next page with a filter active", async () => {
  const view = await openOwed();
  pick(view, "Late");
  assert.deepEqual(names(view), ["Ama Mensah"]);
  await showMore(view);
  assert.deepEqual(names(view), ["Ama Mensah", "Abena Tetteh"]);
  pick(view, "Due soon");
  assert.deepEqual(names(view), ["Kofi Boateng", "Esi Soon"]);
  setLiveQuery(null);
});

// ---- 17 uses the same matching rule ------------------------------------------------------------------------------------------------

test("17 matches like 32: case and spaces ignored, by name or phone", async () => {
  await seed();
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx");
  const view = render({ type: CreditScreens, props: { route: "WhoOwesYou", params: { amountPesewas: 1000 }, onBack() {}, onNavigate() {} } });
  flushEffects(view);
  await settle();
  view.rerender();
  const choices = () => [...walk(view.tree)].filter((node) => typeof node.type === "function" && node.type.name === "CustomerChoice").map((node) => node.props.customer.name);
  const field = () => [...walk(view.tree)].find((node) => node.type === "input" && node.props.placeholder === posText("credit.search"));
  assert.equal(field().props["aria-label"], "Search by name or phone");
  assert.equal(choices().length, 5, "no search: the top five");
  for (const typed of ["kofi", "KOFI", "ko fi", "kofi b", "  kofiboateng ", "Kofi   Boateng", "055 111 2222", "0551112222", "5111"]) {
    field().props.onChange({ target: { value: typed } });
    view.rerender();
    assert.deepEqual(choices(), ["Kofi Boateng"], JSON.stringify(typed));
  }
  field().props.onChange({ target: { value: "zzz" } });
  view.rerender();
  assert.deepEqual(choices(), []);
  field().props.onChange({ target: { value: "   " } });
  view.rerender();
  assert.equal(choices().length, 5, "spaces only is no search");
});
// ---- phone search with a leading 0 (rules_global.phone_search, 4b) --------------------------------------------------------

test("32: 024, 24 and +233 24 find the same person, and 0 or + alone hide nobody", async () => {
  const view = await openOwed();
  for (const typed of ["024", "24", "024 123", "+233 24 123 4567", "233241234567", "00233 24 123 4567"]) {
    type(view, typed);
    assert.deepEqual(names(view), ["Ama Mensah"], JSON.stringify(typed));
  }
  for (const typed of ["0", "+", "233", " "]) {
    type(view, typed);
    assert.equal(rowCount(view), 25, `${JSON.stringify(typed)} leaves the list as it is`);
  }
  setLiveQuery(null);
});
