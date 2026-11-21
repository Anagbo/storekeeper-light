import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { summarizeOwedPeople } from "../src/pos/money.js";
import { localDateString } from "../src/utils/installments.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Item 8 (11 Nov 2026): one shared PartyCard with a DueTag on 22 and 46; 32 keeps its own row
// layout and uses the same DueTag (owner decision). Wiring rule for 22: the Owed card redesign.

after(async () => {
  db.close();
  await db.delete();
});
beforeEach(async () => {
  await Promise.all(["transactions", "debts"].map((name) => db.table(name).clear()));
});

const all = (tree, match) => [...walk(tree)].filter((node) => node.props && match(node));
const cls = (node) => String(node?.props?.className ?? "");
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const TODAY = "2026-03-15";
const day = (offset) => {
  const date = new Date(`${TODAY}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

// ---- due tag ---------------------------------------------------------------------------------------------------

test("due tag: today amber, 3 days amber, 4 days grey, late red (people wording)", async () => {
  const { dueTag } = await loadJsx("src/pos/PartyCard.jsx");
  assert.deepEqual(dueTag(day(0), { today: TODAY }), { tone: "amber", days: 0, label: "Due today" });
  assert.deepEqual(dueTag(day(3), { today: TODAY }), { tone: "amber", days: 3, label: "In 3 days" });
  assert.deepEqual(dueTag(day(1), { today: TODAY }), { tone: "amber", days: 1, label: "In 1 day" });
  assert.deepEqual(dueTag(day(4), { today: TODAY }), { tone: "neutral", days: 4, label: "In 4 days" });
  assert.deepEqual(dueTag(day(-1), { today: TODAY }), { tone: "red", days: -1, label: "Late 1 day" });
  assert.deepEqual(dueTag(day(-5), { today: TODAY }), { tone: "red", days: -5, label: "Late 5 days" });
  assert.equal(dueTag("", { today: TODAY }), null);
  assert.equal(dueTag(undefined, { today: TODAY }), null);
});

test("due tag: suppliers read \"Due in n days\" with the same colours", async () => {
  const { dueTag } = await loadJsx("src/pos/PartyCard.jsx");
  const supplier = (offset) => dueTag(day(offset), { today: TODAY, wording: "supplier" });
  assert.deepEqual([supplier(0).tone, supplier(0).label], ["amber", "Due today"]);
  assert.deepEqual([supplier(3).tone, supplier(3).label], ["amber", "Due in 3 days"]);
  assert.deepEqual([supplier(4).tone, supplier(4).label], ["neutral", "Due in 4 days"]);
  assert.deepEqual([supplier(-2).tone, supplier(-2).label], ["red", "Late 2 days"]);
});

test("due tag colours render as grey, amber and red tags", async () => {
  const { DueTag } = await loadJsx("src/pos/PartyCard.jsx");
  const tagClass = (offset) => {
    const view = render({ type: DueTag, props: { dueDate: day(offset), today: TODAY } });
    return cls(all(view.tree, (n) => n.type === "span")[0]);
  };
  assert.match(tagClass(0), /bg-amber-100/);
  assert.match(tagClass(3), /bg-amber-100/);
  assert.match(tagClass(4), /bg-slate-100/);
  assert.match(tagClass(-1), /bg-rose-100/);
});

// ---- Call by phone number ---------------------------------------------------------------------------------------

test("PartyCard: Call only with a valid phone number, never a greyed disabled Call", async () => {
  const { PartyCard } = await loadJsx("src/pos/PartyCard.jsx");
  const card = (phone) => render({ type: PartyCard, props: {
    name: "ama", amountPesewas: 2000, dueDate: day(-1), today: TODAY, phone, callLabel: "Call Ama",
    action: { label: "Collect", ariaLabel: "Collect payment from Ama", onClick() {} }
  } }).tree;
  const calls = (tree) => all(tree, (n) => n.props["aria-label"] === "Call Ama");
  const valid = calls(card("024 123 4567"));
  assert.equal(valid.length, 1);
  assert.equal(valid[0].type, "a");
  assert.equal(valid[0].props.href, "tel:0241234567");
  assert.match(cls(valid[0]), /h-\[52px\]/);
  assert.match(cls(valid[0]), /border-\[#0F172A\]/);
  for (const phone of ["", "12", undefined, "not a number"]) {
    const tree = card(phone);
    assert.equal(calls(tree).length, 0, `no Call for ${JSON.stringify(phone)}`);
    assert.equal(all(tree, (n) => n.props["aria-disabled"] !== undefined || /opacity-40|pointer-events-none/.test(cls(n))).length, 0, "nothing greyed out");
  }
  assert.equal(textOf(all(card(""), (n) => n.props["data-party-name"] !== undefined || n.type === "h2")[0]), "Ama", "capital first letter");
});

// ---- 22 Home: the Owed card ------------------------------------------------------------------------------------

async function renderHome(data) {
  const { default: Home } = await loadJsx("src/pos/Home.jsx");
  setLiveQuery(() => ({ hideAmounts: false, totals: { cashLeft: 0, moneyIn: 0, moneySpent: 0 }, debtPesewas: 282281, urgentDebt: null, ...data }));
  const navigated = [];
  try {
    const view = render({ type: Home, props: { onNavigate: (...args) => navigated.push(args) } });
    return { tree: view.tree, navigated };
  } finally {
    setLiveQuery(null);
  }
}
// Home reads the real today, so its dates are relative to the real local day.
const realDay = (offset) => {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return localDateString(date);
};
const urgent = (extra = {}) => ({ debtId: "d1", customerName: "sera", amountPesewas: 2000, dueDate: realDay(-1), phone: "0244123456", ...extra });

test("22 Owed card: white card with a red left edge; the top part opens 32; total bold and dark; people and late", async () => {
  const { tree, navigated } = await renderHome({ urgentDebt: urgent(), owed: { people: 5, late: 1 } });
  const card = all(tree, (n) => n.props["data-owed-card"] !== undefined)[0];
  assert.ok(card);
  for (const want of ["bg-white", "border-2", "border-l-8", "border-slate-300", "border-l-rose-700"]) assert.ok(cls(card).split(/\s+/).includes(want), want);
  assert.ok(!/bg-rose-200|bg-pink/.test(cls(card)), "not a pink block");
  const top = all(card, (n) => n.type === "button" && n.props["aria-label"] === "Owed to you, see all")[0];
  assert.ok(top);
  assert.ok(textOf(top).includes("Owed to you"));
  assert.ok(textOf(top).includes("See all"));
  const total = all(top, (n) => n.props["data-owed-total"] !== undefined)[0];
  assert.equal(textOf(total), "GH₵2,822.81");
  assert.match(cls(total), /text-\[30px\]/);
  assert.match(cls(total), /text-\[#0F172A\]/);
  assert.doesNotMatch(cls(total), /rose|red|pink/);
  assert.equal(textOf(all(top, (n) => n.props["data-owed-count"] !== undefined)[0]), "5 people · 1 late");
  top.props.onClick();
  assert.deepEqual(navigated.at(-1), ["PeopleWhoOweYou"]);
  assert.ok(textOf(card).includes("Collect first"));
  // 360px: the 30px total never shrinks; "See all" moves under it when both do not fit.
  assert.match(cls(total), /whitespace-nowrap/);
  assert.ok(cls(top).split(/\s+/).includes("flex-wrap"));
});

test("22 Owed card: \"1 person\" and no \"· late\" when nobody is late", async () => {
  const { tree } = await renderHome({ urgentDebt: urgent({ dueDate: realDay(10) }), owed: { people: 1, late: 0 } });
  assert.equal(textOf(all(tree, (n) => n.props["data-owed-count"] !== undefined)[0]), "1 person");
});

test("22 Collect first: capitalised name opens 43, Collect opens 25, tag colour follows the date", async () => {
  const { tree, navigated } = await renderHome({ urgentDebt: urgent(), owed: { people: 1, late: 1 } });
  const debtor = all(tree, (n) => n.props["data-urgent-debtor"] !== undefined && n.type === "div")[0];
  assert.ok(debtor);
  assert.ok(textOf(debtor).includes("Sera"));
  assert.ok(!textOf(debtor).includes("sera"));
  const collect = all(debtor, (n) => n.type === "button" && n.props["aria-label"] === "Collect payment from Sera")[0];
  assert.ok(collect);
  assert.equal(textOf(collect), "Collect");
  collect.props.onClick();
  assert.equal(navigated.at(-1)[0], "CollectPayment");
  const nameButton = all(debtor, (n) => n.type === "button" && textOf(n).includes("Sera") && textOf(n).includes("GH₵20.00"))[0];
  nameButton.props.onClick();
  assert.equal(navigated.at(-1)[0], "DebtorDetail");
  assert.match(cls(all(debtor, (n) => n.type === "span" && textOf(n) === "Late 1 day" && /rounded-lg/.test(cls(n)))[0]), /bg-rose-100/);
  const amount = all(debtor, (n) => n.props["data-party-amount"] !== undefined && n.type === "span")[0];
  assert.match(cls(amount), /text-\[22px\]/);
  assert.match(cls(amount), /whitespace-nowrap/);
});

// rules_global.person_row (decided 21 Nov 2026): any saved number shows WhatsApp and Call, even one that
// fails the WhatsApp check; "+ Add contact" only when no number is saved.
test("22 Collect first: WhatsApp and Call with any saved number, + Add contact only without one", async () => {
  const labels = async (phone) => all((await renderHome({ urgentDebt: urgent({ phone }), owed: { people: 1, late: 1 } })).tree,
    (n) => (n.type === "a" || n.type === "button") && n.props["aria-label"]).map((n) => n.props["aria-label"]);
  for (const phone of ["0244123456", "12"]) {
    const withPhone = await labels(phone);
    assert.ok(withPhone.includes("WhatsApp Sera"), phone);
    assert.ok(withPhone.includes("Call Sera"), phone);
    assert.ok(!withPhone.includes("Add phone or WhatsApp contact for Sera"), phone);
  }
  for (const phone of ["", "   "]) {
    const without = await labels(phone);
    assert.ok(!without.includes("Call Sera"), `no Call for ${JSON.stringify(phone)}`);
    assert.ok(!without.includes("WhatsApp Sera"));
    assert.ok(without.includes("Add phone or WhatsApp contact for Sera"));
  }
});

// ---- 22 quiet line: only for a skipped record in the period Home shows (today) ----------------------------------

test("22 quiet line: counted only for skipped records inside today's period", async () => {
  const { countUncountedInPeriod } = await loadJsx("src/pos/Home.jsx");
  const range = { start: Date.parse("2026-03-15T00:00:00"), end: Date.parse("2026-03-16T00:00:00") };
  const sale = (createdAt) => ({ type: "sale", createdAt });
  const reversal = (createdAt) => ({ type: "income_reversal", createdAt });
  assert.deepEqual(countUncountedInPeriod([sale(range.start + 1000)], range), { sales: 1, other: 0 });
  assert.deepEqual(countUncountedInPeriod([sale(range.start - 1000), reversal(range.start - 5)], range), { sales: 0, other: 0 });
  assert.deepEqual(countUncountedInPeriod([sale(range.start + 1), sale(range.end - 1), reversal(range.end)], range), { sales: 2, other: 0 });
  assert.deepEqual(countUncountedInPeriod([reversal(range.start + 1)], range), { sales: 0, other: 1 });
  // A skipped entry names the record by id only; the date comes from the record.
  assert.deepEqual(countUncountedInPeriod([{ id: "a", type: "sale" }, { id: "b", type: "sale" }], range, [{ id: "a", type: "sale", createdAt: range.start + 5 }, { id: "b", type: "sale", createdAt: range.start - 5 }]), { sales: 1, other: 0 });
});

test("22 quiet line: shown (singular and plural) when today has a skipped sale, hidden when not", async () => {
  const shown = (await renderHome({ uncounted: { sales: 1, other: 0 } })).tree;
  assert.ok(textOf(shown).includes("1 sale is not counted because its amounts do not match."));
  const plural = (await renderHome({ uncounted: { sales: 2, other: 0 } })).tree;
  assert.ok(textOf(plural).includes("2 sales are not counted because their amounts do not match."));
  const hidden = (await renderHome({ uncounted: { sales: 0, other: 0 } })).tree;
  assert.ok(!textOf(hidden).includes("not counted"));
  assert.equal(all(hidden, (n) => n.props["data-uncounted"] !== undefined).length, 0);
});

test("22 quiet line (real query): a bad sale today is counted, one from yesterday is not", async () => {
  const bad = (id, createdAt) => ({
    id, type: "sale", paymentType: "credit", payment_method: null, amountPesewas: 12000, total_amount: 12000,
    creditExtendedPesewas: 10000, note: "Debt added", createdAt, timestamp: createdAt, updatedAt: createdAt, items_json: "[]"
  });
  const { default: Home } = await loadJsx("src/pos/Home.jsx");
  const load = async () => {
    let query = null;
    setLiveQuery((_deps, run) => { query = run; return null; });
    render({ type: Home, props: { onNavigate() {} } });
    setLiveQuery(null);
    const original = console.warn;
    console.warn = () => {};
    try { return await query(); } finally { console.warn = original; }
  };
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  await db.transactions.put(bad("yesterday", startOfToday.getTime() - 3_600_000));
  assert.deepEqual((await load()).uncounted, { sales: 0, other: 0 });
  await db.transactions.put(bad("today", startOfToday.getTime() + 1000));
  assert.deepEqual((await load()).uncounted, { sales: 1, other: 0 });
});

test("people count: grouped by name, late = due before today", () => {
  const today = new Date("2026-03-15T12:00:00");
  const debts = [
    { id: 1, status: "unpaid", customerName: "Ama", amountPesewas: 100, dueDate: "2026-03-10" },
    { id: 2, status: "unpaid", customerName: "ama ", amountPesewas: 100, dueDate: "2026-03-20" },
    { id: 3, status: "unpaid", customerName: "Kofi", amountPesewas: 100, dueDate: "2026-03-15" },
    { id: 4, status: "unpaid", customerName: "Esi", amountPesewas: 100, isInstallmentPlan: true, nextDueDate: "2026-03-14" },
    { id: 5, status: "paid", customerName: "Yaw", amountPesewas: 100, dueDate: "2026-03-01" }
  ];
  assert.deepEqual(summarizeOwedPeople(debts, today), { people: 3, late: 2 });
});

// ---- one pattern, no third copy -----------------------------------------------------------------------------------

// rules_global.person_row (chunk C, 21 Nov 2026): 22 and 32 draw the one PersonRow (built on PartyCard);
// 46 uses PartyCard directly.
test("22 and 32 use PersonRow, 46 uses PartyCard; no copy of the card styles or the due rule", () => {
  const home = read("src/pos/Home.jsx");
  const suppliers = read("src/pos/SupplierScreens.jsx");
  const owed = read("src/pos/OwedScreens.jsx");
  assert.match(home, /<PersonRow/);
  assert.match(owed, /<PersonRow/);
  assert.match(suppliers, /<PartyCard/);
  for (const [name, source] of [["Home", home], ["SupplierScreens", suppliers], ["OwedScreens", owed]]) {
    assert.doesNotMatch(source, /w-\[52px\]/, `${name}: square buttons only in PartyCard`);
    assert.doesNotMatch(source, /function dueTag|getDebtDueLabel|PosStatusTag/, `${name}: due rule only in PartyCard`);
  }
  assert.doesNotMatch(owed, /getDebtDueLabel|PosStatusTag/);
});
