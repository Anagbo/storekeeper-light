import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../src/db/db.js";
import { localDateString } from "../src/utils/installments.js";
import { flushEffects, loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// rules_global.person_row (chunk C, item 1f, 21 Nov 2026): Home 22 "Collect first" is the reference; the
// Owed list 32 draws the same PersonRow. The top row (name, tag, amount and the space between) opens the
// detail, named "Open {Name}’s details" with a pressed tint; Collect, WhatsApp, Call and Add contact sit
// outside it. Any saved number shows WhatsApp and Call; "+ Add contact" only without one.

after(async () => {
  db.close();
  await db.delete();
});

const all = (tree, match) => [...walk(tree)].filter((node) => node.props && match(node));
// Host elements only (the AddButton component node carries the same label as the <button> it draws).
const byLabel = (tree, label) => all(tree, (n) => typeof n.type === "string" && n.props["aria-label"] === label)[0];
const cls = (node) => String(node?.props?.className ?? "");
const inside = (outer, node) => [...walk(outer)].includes(node);
const realDay = (offset) => {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return localDateString(date);
};

async function renderHome(urgentDebt) {
  const { default: Home } = await loadJsx("src/pos/Home.jsx");
  setLiveQuery(() => ({ hideAmounts: false, totals: { cashLeft: 0, moneyIn: 0, moneySpent: 0 }, debtPesewas: urgentDebt.amountPesewas, urgentDebt, owed: { people: 1, late: 1 } }));
  const navigated = [];
  try {
    return { tree: render({ type: Home, props: { onNavigate: (...args) => navigated.push(args), shopName: "My shop" } }).tree, navigated };
  } finally {
    setLiveQuery(null);
  }
}

async function renderOwed(people) {
  const { loadUnpaidDebtPage } = await import("../src/pos/owed.js");
  await db.debts.clear();
  for (const [index, person] of people.entries()) {
    for (const [debtIndex, amount] of (person.debts ?? [person.amountPesewas]).entries()) {
      await db.debts.put({ id: `d${index}-${debtIndex}`, customerId: `c${index}`, customerName: person.name, phone: person.phone, status: "unpaid", amountPesewas: amount, total_owed: amount, dueDate: person.dueDate ?? "", isInstallmentPlan: false, createdAt: 1000 + index * 10 + debtIndex });
    }
  }
  const { default: PeopleWhoOweYou } = await loadJsx("src/pos/OwedScreens.jsx");
  const firstPage = { status: "ready", ...(await loadUnpaidDebtPage()) };
  const customerResult = { status: "ready", customers: people.map((person, index) => ({ id: `c${index}`, name: person.name, nameLower: person.name.toLowerCase(), phone: person.phone })), reminderEvents: [] };
  setLiveQuery((_deps, query) => (String(query).includes("load outstanding debts") ? firstPage : String(query).includes("search outstanding") ? null : customerResult));
  const navigated = [];
  const collected = [];
  const view = render({ type: PeopleWhoOweYou, props: { onBack() {}, onNavigate: (...args) => navigated.push(args), onCollect: (debt) => collected.push(debt), shopName: "My shop" } });
  flushEffects(view);
  view.rerender();
  setLiveQuery(null);
  return { tree: view.tree, navigated, collected };
}

test("22 and 32: the top row is one button named Open {Name}’s details, with a pressed tint and nothing at rest", async () => {
  const home = await renderHome({ debtId: "d1", customerName: "sera", amountPesewas: 2000, dueDate: realDay(-1), phone: "0244123456" });
  const owed = await renderOwed([{ name: "sera", amountPesewas: 2000, dueDate: realDay(-1), phone: "0244123456" }]);
  for (const [screen, tree] of [["22", home.tree], ["32", owed.tree]]) {
    const open = all(tree, (n) => n.props["data-person-open"] !== undefined);
    assert.equal(open.length, 1, `${screen}: one open button`);
    assert.equal(open[0].type, "button", `${screen}: a button, not a text link`);
    assert.equal(open[0].props["aria-label"], "Open Sera’s details", screen);
    assert.match(cls(open[0]), /(^|\s)active:bg-slate-100(\s|$)/, `${screen}: visible pressed state`);
    assert.doesNotMatch(cls(open[0]).replace(/active:\S+|focus-visible:\S+/g, ""), /\bbg-|underline/, `${screen}: no fill or underline at rest`);
    // Name, tag and amount are all inside the one open button.
    const text = textOf(open[0]);
    for (const want of ["Sera", "Late 1 day", "GH₵20.00"]) assert.ok(text.includes(want), `${screen}: ${want} opens the detail`);
    // Collect, WhatsApp and Call never sit inside it.
    for (const label of [screen === "22" ? "Collect payment from Sera" : "Collect from Sera", "WhatsApp Sera", "Call Sera"]) {
      const control = byLabel(tree, label);
      assert.ok(control, `${screen}: ${label}`);
      assert.ok(!inside(open[0], control), `${screen}: ${label} is outside the open button`);
    }
  }
});

test("22: Home's buttons are unchanged (Collect, icon-only WhatsApp and Call, or + Add contact)", async () => {
  // The class strings and order as built before chunk C (PartyCard, 11-17 Nov 2026).
  const COLLECT = "flex h-[52px] min-w-0 flex-1 items-center justify-center gap-2 rounded-[14px] border-2 border-emerald-950 bg-emerald-900 px-4 text-lg font-extrabold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800";
  const SQUARE = "grid h-[52px] w-[52px] shrink-0 place-items-center rounded-[14px] border-2 bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800";
  const withPhone = await renderHome({ debtId: "d1", customerName: "sera", amountPesewas: 2000, dueDate: realDay(-1), phone: "0244123456" });
  const row = all(withPhone.tree, (n) => n.props["data-urgent-debtor"] !== undefined && n.type === "div")[0];
  const controls = all(row, (n) => (n.type === "button" || n.type === "a") && n.props["data-person-open"] === undefined);
  assert.deepEqual(controls.map((n) => n.props["aria-label"]), ["Collect payment from Sera", "WhatsApp Sera", "Call Sera"]);
  assert.equal(textOf(controls[0]), "Collect");
  assert.equal(cls(controls[0]), COLLECT);
  assert.equal(cls(controls[1]), `${SQUARE} border-emerald-900 text-emerald-900`);
  assert.equal(textOf(controls[1]), "", "WhatsApp is icon only");
  assert.equal(controls[2].type, "a");
  assert.equal(controls[2].props.href, "tel:0244123456");
  assert.equal(cls(controls[2]), `${SQUARE} border-[#0F172A] text-[#0F172A]`);
  assert.equal(textOf(controls[2]), "", "Call is icon only");
  controls[0].props.onClick();
  assert.equal(withPhone.navigated.at(-1)[0], "CollectPayment");

  const noPhone = await renderHome({ debtId: "d1", customerName: "sera", amountPesewas: 2000, dueDate: realDay(-1), phone: "" });
  const noPhoneRow = all(noPhone.tree, (n) => n.props["data-urgent-debtor"] !== undefined && n.type === "div")[0];
  const noPhoneControls = all(noPhoneRow, (n) => n.type === "button" && n.props["data-person-open"] === undefined);
  assert.deepEqual(noPhoneControls.map((n) => n.props["aria-label"]), ["Collect payment from Sera", "Add phone or WhatsApp contact for Sera"]);
  assert.equal(noPhoneControls[1].props["data-look"], "add");
  assert.match(cls(noPhoneControls[1]), /w-auto! shrink-0 px-3!/);
  assert.equal(textOf(noPhoneControls[1]).replace(/\s+/g, " ").trim(), "+ Add contact");
  noPhoneControls[1].props.onClick();
  assert.deepEqual(noPhone.navigated.at(-1), ["DebtorDetail", { debtId: "d1", customerName: "sera", editContact: true }]);
});

test("22: the open button opens the detail with the debt (43 late / 29 otherwise is DebtorDetail's choice)", async () => {
  const debt = { debtId: "d1", customerName: "sera", amountPesewas: 2000, dueDate: realDay(-1), phone: "" };
  const { tree, navigated } = await renderHome(debt);
  all(tree, (n) => n.props["data-person-open"] !== undefined)[0].props.onClick();
  assert.deepEqual(navigated.at(-1), ["DebtorDetail", debt]);
});

test("32: same row as Home; Collect keeps the several-debts rule; Add contact opens the contact editor and returns to 32", async () => {
  const { tree, navigated, collected } = await renderOwed([
    { name: "ama", amountPesewas: 2000, dueDate: realDay(-2), phone: "0244123456" },
    { name: "kofi", debts: [1000, 1500], dueDate: realDay(5), phone: "" }
  ]);
  const rows = all(tree, (n) => n.type === "article");
  assert.equal(rows.length, 2);
  for (const row of rows) {
    const person = all(row, (n) => n.props["data-person-open"] !== undefined)[0];
    assert.ok(person, "PersonRow's open button");
    const amount = all(row, (n) => n.props["data-party-amount"] !== undefined)[0];
    assert.ok(inside(person, amount), "the amount sits on the name's line (in the top row), not under the name");
    assert.equal(all(row, (n) => /UserRoundPen|lucide-user-round-pen/.test(String(n.type?.displayName ?? n.props.className ?? ""))).length, 0, "no person-with-pen icon");
  }
  // Ama: one debt, Collect opens 25 for that debt.
  byLabel(tree, "Collect from Ama").props.onClick();
  assert.equal(collected.at(-1).customerName, "ama");
  assert.equal(textOf(byLabel(tree, "Collect from Ama")), "Collect", "labelled Collect, not icon only");
  // Kofi: two debts, Collect opens the detail to choose the debt.
  byLabel(tree, "Collect from Kofi").props.onClick();
  assert.equal(navigated.at(-1)[0], "DebtorDetail");
  assert.equal(collected.length, 1);
  // Kofi has no number: + Add contact, no WhatsApp or Call.
  assert.equal(byLabel(tree, "WhatsApp Kofi"), undefined);
  assert.equal(byLabel(tree, "Call Kofi"), undefined);
  const add = byLabel(tree, "Add phone or WhatsApp contact for Kofi");
  assert.equal(add.props["data-look"], "add");
  add.props.onClick();
  assert.deepEqual(navigated.at(-1), ["DebtorDetail", { customerId: "c1", customerName: "kofi", debtId: navigated.at(-1)[1].debtId, editContact: true, returnToOwed: true }]);
  // The open button opens the detail without the contact editor.
  byLabel(tree, "Open Ama’s details").props.onClick();
  assert.equal(navigated.at(-1)[0], "DebtorDetail");
  assert.equal(navigated.at(-1)[1].customerName, "ama");
  assert.equal(navigated.at(-1)[1].editContact, undefined);
});

// Item 5 (chunk C): no " · " joins two facts in the text of 22 and 32. Named exception: Home's Owed card
// count line ("5 people · 1 late", wiring 22 Owed card redesign), above the person row, which Home 22
// keeps exactly as built.
test("scan: no ' · ' joins two facts on 22 and 32", async () => {
  const home = await renderHome({ debtId: "d1", customerName: "sera", amountPesewas: 2000, dueDate: realDay(-1), phone: "0244123456" });
  const owed = await renderOwed([
    { name: "ama", amountPesewas: 2000, dueDate: realDay(-2), phone: "0244123456" },
    { name: "kofi", debts: [1000, 1500], dueDate: realDay(5), phone: "" },
    { name: "yaw", amountPesewas: 1200, dueDate: realDay(0), phone: "12345" }
  ]);
  for (const [screen, tree] of [["22", home.tree], ["32", owed.tree]]) {
    const texts = [...walk(tree)].filter((node) => typeof node === "string" || typeof node === "number").map(String);
    const labels = all(tree, (n) => typeof n.props["aria-label"] === "string").map((n) => n.props["aria-label"]);
    const shown = [...texts, ...labels, textOf(tree)].join("\n").replace(/\d+ (person|people) · \d+ late/, "");
    assert.doesNotMatch(shown, / · /, `${screen}: no facts joined with " · "`);
  }
});
