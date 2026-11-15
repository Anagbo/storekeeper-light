import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { loadUnpaidDebtPage } from "../src/pos/owed.js";
import { flushEffects, loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// rules_global.reminders (record it): a tap on any WhatsApp reminder button (Home Collect first 22,
// Owed rows 32, debtor detail 29/43) that hands over to WhatsApp records a reminder for that person,
// offline too. A closed share sheet records nothing. Receipts never record one.

const PHONE = "+233241234567";
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const dayOffset = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const freshTap = () => ({ prevented: false, preventDefault() { this.prevented = true; } });

after(async () => {
  setLiveQuery(null);
  db.close();
  await db.delete();
});
beforeEach(async () => {
  await Promise.all(["debts", "customers", "reminders"].map((name) => db.table(name).clear()));
});

function withNavigator(value, run) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value });
  return Promise.resolve(run()).finally(() => {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete globalThis.navigator;
  });
}

async function detail({ late = false, phone = PHONE, env = {} } = {}) {
  const { DebtorDetail } = await loadJsx("src/pos/DebtCollection.jsx", env);
  const debt = { id: "d1", customerId: "c1", customerName: "Ama", amountPesewas: 8000, status: "unpaid", isInstallmentPlan: false, dueDate: dayOffset(late ? -3 : 7) };
  const payment = { id: "collection-c1", type: "payment", timestamp: Date.now() - 3_600_000, amountPesewas: 3000, collectionParts: [{ method: "Cash", amountPesewas: 3000 }] }; // 29/43 receipts cover the latest payment (15 Nov 2026)
  const data = { name: "Ama", customerId: "c1", phone, ghanaCardNumber: "", balancePesewas: 8000, debt, unpaidDebts: [debt], unpaidDebtCount: 1, history: [payment] };
  setLiveQuery(([debtId]) => (debtId === "d1" ? data : undefined));
  try {
    return render({ type: DebtorDetail, props: { params: { debtId: "d1", customerName: "Ama" }, onBack() {}, onNavigate() {}, onCollect() {}, shopName: "My shop" } });
  } finally {
    setLiveQuery(null);
  }
}
const control = (view, test) => [...walk(view.tree)].find((node) => (node.type === "a" || node.type === "button") && test(node));
const detailReminder = (view, late) => control(view, (node) => late ? textOf(node).includes("Send reminder on WhatsApp") : node.props["aria-label"] === "WhatsApp reminder for Ama");

async function homeView() {
  const { default: Home } = await loadJsx("src/pos/Home.jsx");
  const urgentDebt = { customerName: "Ama", phone: PHONE, amountPesewas: 8000, dueDate: dayOffset(-3), debtId: "d1" };
  setLiveQuery(() => ({
    totals: { cashLeft: 0, moneyIn: 0, moneySpent: 0 }, debtPesewas: 8000, urgentDebt,
    urgentPerson: { customerId: "c1", name: "Ama" }, urgentLastReminderAt: 0,
    owed: { people: 1, late: 1 }, uncounted: { sales: 0, other: 0 }
  }));
  try {
    return render({ type: Home, props: { onNavigate() {} } });
  } finally {
    setLiveQuery(null);
  }
}

async function owedView(reminderEvents = []) {
  await db.debts.add({ id: "d1", customerId: "c1", customerName: "Ama", phone: PHONE, status: "unpaid", amountPesewas: 8000, total_owed: 8000, dueDate: dayOffset(-3), isInstallmentPlan: false });
  const { default: PeopleWhoOweYou } = await loadJsx("src/pos/OwedScreens.jsx");
  const firstPage = { status: "ready", ...(await loadUnpaidDebtPage()) };
  const customerResult = { status: "ready", customers: [{ id: "c1", name: "Ama", nameLower: "ama", phone: PHONE }], reminderEvents };
  setLiveQuery((_deps, query) => (String(query).includes("load outstanding debts") ? firstPage : String(query).includes("search outstanding") ? null : customerResult));
  const view = render({ type: PeopleWhoOweYou, props: { onBack() {}, onNavigate() {}, onCollect() {}, shopName: "My shop" } });
  flushEffects(view);
  view.rerender();
  setLiveQuery(null);
  return view;
}

const stored = () => db.reminders.toArray();

for (const late of [false, true]) {
  test(`${late ? 43 : 29}: tapping the WhatsApp reminder link records one reminder for the person and opens WhatsApp`, async () => {
    const view = await detail({ late });
    const link = detailReminder(view, late);
    assert.equal(link.type, "a");
    const event = freshTap();
    await link.props.onClick(event);
    assert.equal(event.prevented, false, "the link itself opens WhatsApp");
    const events = await stored();
    assert.equal(events.length, 1);
    assert.equal(events[0].customerId, "c1");
    assert.equal(events[0].nameLower, "ama");
    assert.equal(events[0].channel, "whatsapp");
  });
}

test("29/43 with no phone: a finished share records a reminder, a closed share sheet records nothing", async () => {
  await withNavigator({ userAgent: "Android", share: async () => {} }, async () => {
    for (const late of [false, true]) await detailReminder(await detail({ late, phone: "" }), late).props.onClick(freshTap());
  });
  assert.equal((await stored()).length, 2);
  await db.reminders.clear();
  await withNavigator({ userAgent: "Android", share: async () => { const error = new Error("closed"); error.name = "AbortError"; throw error; } }, async () => {
    for (const late of [false, true]) await detailReminder(await detail({ late, phone: "" }), late).props.onClick(freshTap());
  });
  assert.equal((await stored()).length, 0);
});

test("recording works offline (it is written only on this phone)", async () => {
  await withNavigator({ userAgent: "Android", onLine: false }, async () => {
    await detailReminder(await detail(), false).props.onClick(freshTap());
  });
  assert.equal((await stored()).length, 1);
});

test("22: the Collect first WhatsApp button records a reminder for that person", async () => {
  const view = await homeView();
  const link = control(view, (node) => node.props["aria-label"] === "WhatsApp Ama");
  assert.ok(link, "the WhatsApp button on the tile");
  await link.props.onClick(freshTap());
  const [event] = await stored();
  assert.equal(event.customerId, "c1");
  assert.equal(event.customerName, "Ama");
});

test("22 and 32 show no Last reminder text", async () => {
  assert.doesNotMatch(textOf((await homeView()).tree), /reminder/i);
  assert.doesNotMatch(textOf((await owedView([{ id: "r", customerId: "c1", nameLower: "ama", channel: "whatsapp", createdAt: Date.now() - 1000 }])).tree), /Last reminder|No reminder/);
});

test("32: an Owed row's WhatsApp button records a reminder for that row's person", async () => {
  const view = await owedView();
  const link = control(view, (node) => node.props["aria-label"] === "WhatsApp Ama");
  assert.ok(link);
  await link.props.onClick(freshTap());
  const [event] = await stored();
  assert.equal(event.customerId, "c1");
});

test("receipts never record a reminder: only the shared reminder path writes reminder events", () => {
  const files = (dir) => readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true }).flatMap((entry) => (
    entry.isDirectory() ? files(`${dir}/${entry.name}`) : /\.(jsx?|ts)$/.test(entry.name) ? [`${dir}/${entry.name}`] : []
  ));
  const writers = files("src").filter((path) => /recordReminderSent|reminders\.(add|put|bulkAdd|bulkPut|update)\(/.test(read(path)));
  assert.deepEqual(writers.sort(), ["src/db/reminders.js", "src/pos/ReminderCheck.jsx"]);
  for (const receipt of ["src/pos/ReceiptActions.jsx", "src/pos/receiptShare.js", "src/pos/receiptTemplates.js", "src/pos/saleReceipt.js", "src/pos/collectionReceipt.js"]) {
    assert.doesNotMatch(read(receipt), /ReminderCheck|db\/reminders/, `${receipt} does not touch reminders`);
  }
});

test("29 with receipts on: the payment Receipt button is not a reminder button", async () => {
  const view = await detail({ env: { VITE_ENABLE_POS_RECEIPTS: "true" } });
  const receipt = control(view, (node) => /^Receipt for .* payment$/.test(textOf(node).trim()));
  assert.ok(receipt, "the payment receipt button");
  assert.doesNotMatch(String(receipt.props.onClick), /onReminder/);
});