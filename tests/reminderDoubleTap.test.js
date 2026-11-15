import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { loadUnpaidDebtPage } from "../src/pos/owed.js";
import { flushEffects, loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// A6: while a reminder tap is being handled, further taps on any reminder button are ignored, so two
// quick taps record one reminder.

const PHONE = "+233241234567";
const DAY = 24 * 60 * 60 * 1000;
const dayOffset = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const freshTap = () => ({ prevented: false, preventDefault() { this.prevented = true; } });
const props = { onBack() {}, onNavigate() {}, onCollect() {}, shopName: "My shop" };

after(async () => {
  setLiveQuery(null);
  db.close();
  await db.delete();
});
beforeEach(async () => {
  setLiveQuery(null);
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

async function detail({ phone = PHONE, lastReminderAt = 0 } = {}) {
  const { DebtorDetail } = await loadJsx("src/pos/DebtCollection.jsx");
  const debt = { id: "d1", customerId: "c1", customerName: "Ama", amountPesewas: 8000, status: "unpaid", isInstallmentPlan: false, dueDate: dayOffset(7) };
  const data = { name: "Ama", customerId: "c1", phone, ghanaCardNumber: "", balancePesewas: 8000, debt, unpaidDebts: [debt], unpaidDebtCount: 1, lastReminderAt, history: [] };
  setLiveQuery(([debtId]) => (debtId === "d1" ? data : undefined));
  const view = render({ type: DebtorDetail, props: { params: { debtId: "d1", customerName: "Ama" }, ...props } });
  return { view, button: () => [...walk(view.tree)].find((node) => node.props?.["aria-label"] === "WhatsApp reminder for Ama") };
}
const sheetOf = (view) => [...walk(view.tree)].find((node) => node.props?.["data-reminder-again"] !== undefined);
const inSheet = (view, label) => [...walk(sheetOf(view))].find((node) => (node.type === "a" || node.type === "button") && textOf(node) === label);

test("two quick taps on a WhatsApp link record one reminder; the second does not open WhatsApp", async () => {
  const { button } = await detail();
  const first = freshTap();
  const second = freshTap();
  const handling = [button().props.onClick(first), button().props.onClick(second)];
  await Promise.all(handling);
  assert.equal(first.prevented, false, "the first tap opens WhatsApp");
  assert.equal(second.prevented, true, "the second tap is ignored");
  assert.equal((await db.reminders.toArray()).length, 1);
});

test("with no phone: taps while the share sheet is open are ignored; the share opens once", async () => {
  let shares = 0;
  let finish;
  await withNavigator({ userAgent: "Android", share: () => { shares += 1; return new Promise((resolve) => { finish = resolve; }); } }, async () => {
    const { button } = await detail({ phone: "" });
    const first = button().props.onClick(freshTap());
    await button().props.onClick(freshTap());
    await button().props.onClick(freshTap());
    finish();
    await first;
  });
  assert.equal(shares, 1);
  assert.equal((await db.reminders.toArray()).length, 1);
});

test("a tap right after a recorded reminder asks Send another reminder? instead of recording again", async () => {
  const { view, button } = await detail();
  await button().props.onClick(freshTap());
  // The screen's own query has not re-read the log yet (lastReminderAt is still 0 in its data).
  const again = freshTap();
  await button().props.onClick(again);
  view.rerender();
  assert.equal(again.prevented, true);
  assert.ok(sheetOf(view), "the sheet opens");
  assert.match(textOf(sheetOf(view)), /You sent Ama a reminder today at/);
  assert.equal((await db.reminders.toArray()).length, 1);
});

test("two quick taps on Send again record one reminder", async () => {
  const { view, button } = await detail({ lastReminderAt: Date.now() - DAY });
  await button().props.onClick(freshTap());
  view.rerender();
  const sendAgain = inSheet(view, "Send again");
  const second = freshTap();
  await Promise.all([sendAgain.props.onClick(freshTap()), sendAgain.props.onClick(second)]);
  assert.equal(second.prevented, true);
  assert.equal((await db.reminders.toArray()).length, 1);
});

test("32: a quick tap on another row's WhatsApp while the first is handled is ignored too", async () => {
  await db.debts.bulkAdd([
    { id: "d1", customerId: "c1", customerName: "Ama", phone: PHONE, status: "unpaid", amountPesewas: 8000, total_owed: 8000, dueDate: dayOffset(-3), isInstallmentPlan: false },
    { id: "d2", customerId: "c2", customerName: "Kofi", phone: "+233241234568", status: "unpaid", amountPesewas: 5000, total_owed: 5000, dueDate: dayOffset(-2), isInstallmentPlan: false }
  ]);
  const { default: PeopleWhoOweYou } = await loadJsx("src/pos/OwedScreens.jsx");
  const firstPage = { status: "ready", ...(await loadUnpaidDebtPage()) };
  const customerResult = { status: "ready", customers: [], reminderEvents: [] };
  setLiveQuery((_deps, query) => (String(query).includes("load outstanding debts") ? firstPage : String(query).includes("search outstanding") ? null : customerResult));
  const view = render({ type: PeopleWhoOweYou, props });
  flushEffects(view);
  view.rerender();
  const link = (name) => [...walk(view.tree)].find((node) => node.type === "a" && node.props["aria-label"] === `WhatsApp ${name}`);
  const kofi = freshTap();
  await Promise.all([link("Ama").props.onClick(freshTap()), link("Kofi").props.onClick(kofi)]);
  assert.equal(kofi.prevented, true);
  const events = await db.reminders.toArray();
  assert.deepEqual(events.map((event) => event.customerId), ["c1"]);
  // Once the first is done, Kofi's button works again.
  await link("Kofi").props.onClick(freshTap());
  assert.equal((await db.reminders.toArray()).length, 2);
});
