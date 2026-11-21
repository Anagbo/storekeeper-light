import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { loadUnpaidDebtPage } from "../src/pos/owed.js";
import { needsReminderCheck, REMINDER_REPEAT_WINDOW_MS, reminderAgainText } from "../src/pos/reminderLabel.js";
import { flushEffects, loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// rules_global.reminders "check" and wiring 22/32/29/43: one shared 7-day check for every reminder
// button. Within 7 days of the person's last reminder, "Send another reminder?" opens first: Send
// again (strong) opens WhatsApp and records; Not now (outlined), Back and Escape close it, record
// nothing and stay on the screen. After 7 days or with none, WhatsApp opens directly.

const PHONE = "+233241234567";
const DAY = 24 * 60 * 60 * 1000;
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const dayOffset = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const freshTap = () => ({ prevented: false, preventDefault() { this.prevented = true; } });
const backHandlers = () => globalThis.__posBrowserBack?.handlers ?? [];

after(async () => {
  db.close();
  await db.delete();
});
beforeEach(async () => {
  setLiveQuery(null);
  backHandlers().length = 0;
  await Promise.all(["debts", "customers", "reminders"].map((name) => db.table(name).clear()));
});

// The phone (navigator) and the window the shared opener writes the whatsapp:// link to.
// `opened` collects every link opened (window.location.href on a phone, window.open on a desktop).
const opened = [];
function withNavigator(value, run) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  opened.length = 0;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value });
  const win = originalWindow?.value ?? {};
  const saved = { location: Object.getOwnPropertyDescriptor(win, "location"), open: win.open };
  Object.defineProperty(win, "location", { configurable: true, value: { set href(link) { opened.push(link); } } });
  win.open = (link) => { opened.push(link); };
  if (!originalWindow) globalThis.window = win;
  return Promise.resolve(run()).finally(() => {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete globalThis.navigator;
    if (saved.location) Object.defineProperty(win, "location", saved.location);
    else delete win.location;
    if (saved.open) win.open = saved.open;
    else delete win.open;
    if (!originalWindow) delete globalThis.window;
  });
}

// ---- every reminder button: 22, 32, 29, 43 (with and without a phone on 29/43) -------------------------

const navigation = [];
const props = { onBack() { navigation.push("back"); }, onNavigate(...args) { navigation.push(args); }, onCollect() { navigation.push("collect"); }, shopName: "My shop" };

async function detailScreen({ late, phone, lastReminderAt }) {
  const { DebtorDetail } = await loadJsx("src/pos/DebtCollection.jsx");
  const debt = { id: "d1", customerId: "c1", customerName: "Ama", amountPesewas: 8000, status: "unpaid", isInstallmentPlan: false, dueDate: dayOffset(late ? -3 : 7) };
  const data = { name: "Ama", customerId: "c1", phone, ghanaCardNumber: "", balancePesewas: 8000, debt, unpaidDebts: [debt], unpaidDebtCount: 1, lastReminderAt, history: [] };
  setLiveQuery(([debtId]) => (debtId === "d1" ? data : undefined));
  const view = render({ type: DebtorDetail, props: { params: { debtId: "d1", customerName: "Ama" }, ...props } });
  const find = () => [...walk(view.tree)].find((node) => (node.type === "a" || node.type === "button") && (late ? textOf(node).includes("Send reminder on WhatsApp") : node.props["aria-label"] === "WhatsApp reminder for Ama"));
  return { view, find };
}

async function manualDebtSaved({ phone, lastReminderAt }) {
  const { ManualDebtSaved } = await loadJsx("src/pos/ManualDebtScreens.jsx");
  setLiveQuery(([key, customerId]) => (key === "manualDebtSavedReminder" && customerId === "c1" ? lastReminderAt : undefined));
  const params = {
    customer: { id: "c1", name: "Ama", phone },
    amountPesewas: 2000,
    manualDebtResult: { customer: { id: "c1" }, debt: { id: "d1", amountPesewas: 8000 } }
  };
  const view = render({ type: ManualDebtSaved, props: { params, onDone() { navigation.push("done"); }, ...props } });
  return { view, find: () => [...walk(view.tree)].find((node) => (node.type === "a" || node.type === "button") && textOf(node) === "WhatsApp Ama") };
}

const SCREENS = {
  "22 Home Collect first": async ({ lastReminderAt }) => {
    const { default: Home } = await loadJsx("src/pos/Home.jsx");
    setLiveQuery(() => ({
      totals: { cashLeft: 0, moneyIn: 0, moneySpent: 0 }, debtPesewas: 8000,
      urgentDebt: { customerName: "Ama", phone: PHONE, amountPesewas: 8000, dueDate: dayOffset(-3), debtId: "d1" },
      urgentPerson: { customerId: "c1", name: "Ama" }, urgentLastReminderAt: lastReminderAt,
      owed: { people: 1, late: 1 }, uncounted: { sales: 0, other: 0 }
    }));
    const view = render({ type: Home, props });
    return { view, find: () => [...walk(view.tree)].find((node) => node.type === "button" && node.props["aria-label"] === "WhatsApp Ama") };
  },
  "32 Owed row": async ({ lastReminderAt }) => {
    await db.debts.put({ id: "d1", customerId: "c1", customerName: "Ama", phone: PHONE, status: "unpaid", amountPesewas: 8000, total_owed: 8000, dueDate: dayOffset(-3), isInstallmentPlan: false });
    const { default: PeopleWhoOweYou } = await loadJsx("src/pos/OwedScreens.jsx");
    const firstPage = { status: "ready", ...(await loadUnpaidDebtPage()) };
    const reminderEvents = lastReminderAt ? [{ id: "r0", customerId: "c1", nameLower: "ama", channel: "whatsapp", createdAt: lastReminderAt }] : [];
    const customerResult = { status: "ready", customers: [{ id: "c1", name: "Ama", nameLower: "ama", phone: PHONE }], reminderEvents };
    setLiveQuery((_deps, query) => (String(query).includes("load outstanding debts") ? firstPage : String(query).includes("search outstanding") ? null : customerResult));
    const view = render({ type: PeopleWhoOweYou, props });
    flushEffects(view);
    view.rerender();
    return { view, find: () => [...walk(view.tree)].find((node) => node.type === "button" && node.props["aria-label"] === "WhatsApp Ama") };
  },
  "ManualDebtSaved (debt added)": (state) => manualDebtSaved({ ...state, phone: PHONE }),
  "ManualDebtSaved (debt added), no phone (share sheet)": (state) => manualDebtSaved({ ...state, phone: "" }),
  "29 debtor detail": (state) => detailScreen({ ...state, late: false, phone: PHONE }),
  "43 debtor detail": (state) => detailScreen({ ...state, late: true, phone: PHONE }),
  "29 debtor detail, no phone (share sheet)": (state) => detailScreen({ ...state, late: false, phone: "" }),
  "43 debtor detail, no phone (share sheet)": (state) => detailScreen({ ...state, late: true, phone: "" })
};

const sheetOf = (view) => [...walk(view.tree)].find((node) => node.props?.["data-reminder-again"] !== undefined);
const inSheet = (view, label) => [...walk(sheetOf(view))].find((node) => (node.type === "a" || node.type === "button") && textOf(node) === label);
const sharing = { userAgent: "Android", share: async () => {} };

for (const [name, open] of Object.entries(SCREENS)) {
  test(`${name}: a reminder 6 days ago opens Send another reminder? and records nothing yet`, async () => {
    await withNavigator(sharing, async () => {
      navigation.length = 0;
      const { view, find } = await open({ lastReminderAt: Date.now() - 6 * DAY });
      const tap = freshTap();
      await find().props.onClick(tap);
      view.rerender();
      assert.equal(tap.prevented, true, "WhatsApp does not open yet");
      const sheet = sheetOf(view);
      assert.ok(sheet, "the sheet is open");
      assert.match(textOf(sheet), /Send another reminder\?/);
      assert.match(textOf(sheet), /You sent Ama a reminder on \d\d\/\d\d\/\d{4} at \d\d:\d\d\. Sending too many can annoy a customer\./);
      assert.equal((await db.reminders.toArray()).length, 0);
    });
  });

  test(`${name}: Not now closes the sheet, records nothing and stays on the screen`, async () => {
    await withNavigator(sharing, async () => {
      navigation.length = 0;
      const { view, find } = await open({ lastReminderAt: Date.now() - 2 * DAY });
      await find().props.onClick(freshTap());
      view.rerender();
      inSheet(view, "Not now").props.onClick();
      view.rerender();
      assert.equal(sheetOf(view), undefined, "closed");
      assert.ok(find(), "still on the same screen");
      assert.deepEqual(navigation, [], "no navigation");
      assert.equal((await db.reminders.toArray()).length, 0);
    });
  });

  test(`${name}: Send again opens WhatsApp and records a new reminder`, async () => {
    await withNavigator(sharing, async () => {
      const { view, find } = await open({ lastReminderAt: Date.now() - DAY });
      await find().props.onClick(freshTap());
      view.rerender();
      const again = inSheet(view, "Send again");
      assert.equal(again.type, "button", "a button that calls the shared opener, not a wa.me link");
      assert.equal(find().type, "button");
      await again.props.onClick(freshTap());
      view.rerender();
      assert.equal(sheetOf(view), undefined);
      assert.deepEqual(opened.map((link) => link.split("&")[0]), name.includes("no phone") ? [] : ["whatsapp://send?phone=233241234567"], "the person's chat in the app");
      const events = await db.reminders.toArray();
      assert.equal(events.length, 1);
      assert.equal(events[0].nameLower, "ama");
    });
  });

  test(`${name}: a reminder 8 days ago, or none, opens WhatsApp directly and records`, async () => {
    await withNavigator(sharing, async () => {
      for (const lastReminderAt of [Date.now() - 8 * DAY, 0]) {
        await db.reminders.clear();
        const { view, find } = await open({ lastReminderAt });
        const tap = freshTap();
        await find().props.onClick(tap);
        view.rerender();
        assert.equal(tap.prevented, false);
        assert.equal(sheetOf(view), undefined, "no sheet");
        assert.equal((await db.reminders.toArray()).length, 1);
      }
      // With a saved number the chat opens in the installed app (never wa.me on a phone); without one
      // the share sheet opens and no link is written.
      const links = opened.splice(0);
      if (name.includes("no phone")) assert.deepEqual(links, []);
      else for (const link of links) assert.match(link, /^whatsapp:\/\/send\?phone=233241234567&text=Hello%20\*Ama\*/);
    });
  });
}

test("Back and Escape act as Not now", async () => {
  const { view, find } = await SCREENS["29 debtor detail"]({ lastReminderAt: Date.now() - DAY });
  await find().props.onClick(freshTap());
  view.rerender();
  flushEffects(view);
  assert.equal(backHandlers().length, 1, "the sheet takes the phone's Back");
  backHandlers().at(-1).close();
  view.rerender();
  assert.equal(sheetOf(view), undefined, "Back closed it");

  await find().props.onClick(freshTap());
  view.rerender();
  const dialog = [...walk(sheetOf(view))].find((node) => node.props?.role === "dialog");
  dialog.props.onKeyDown({ key: "Escape", preventDefault() {}, stopPropagation() {} });
  view.rerender();
  assert.equal(sheetOf(view), undefined, "Escape closed it");
  assert.equal((await db.reminders.toArray()).length, 0);
});

test("Send again is the strong primary button; Not now is the grey leave look", async () => {
  const { view, find } = await SCREENS["29 debtor detail"]({ lastReminderAt: Date.now() - DAY });
  await find().props.onClick(freshTap());
  view.rerender();
  assert.match(inSheet(view, "Send again").props.className, /bg-emerald-900/);
  assert.match(inSheet(view, "Send again").props.className, /text-white/);
  assert.match(inSheet(view, "Not now").props.className, /bg-white/);
  // rules_global.button_system.leave (17 Nov 2026): the shared LeaveButton, as tall as Send again.
  assert.equal(inSheet(view, "Not now").props["data-look"], "leave");
  assert.match(inSheet(view, "Not now").props.className, /border-\[#64748B\]/);
  assert.match(inSheet(view, "Not now").props.className, /min-h-\[60px\]!/);
  const order = [...walk(sheetOf(view))];
  assert.ok(order.indexOf(inSheet(view, "Send again")) < order.indexOf(inSheet(view, "Not now")));
});

// ---- the shared check itself ---------------------------------------------------------------------------

test("the 7-day window: day 6 asks, day 8 does not, none does not", () => {
  const now = new Date(2026, 10, 15, 12).getTime();
  assert.equal(needsReminderCheck(now - 6 * DAY, now), true);
  assert.equal(needsReminderCheck(now - 7 * DAY + 60_000, now), true, "just under 7 days");
  assert.equal(needsReminderCheck(now - 7 * DAY, now), false, "7 full days");
  assert.equal(needsReminderCheck(now - 8 * DAY, now), false);
  assert.equal(needsReminderCheck(0, now), false);
  assert.equal(needsReminderCheck(undefined, now), false);
  assert.equal(REMINDER_REPEAT_WINDOW_MS, 7 * DAY);
});

test("sheet wording: today, yesterday and a date, with the name in Title Case", () => {
  const now = new Date(2026, 10, 15, 16, 0);
  assert.equal(reminderAgainText("ama", new Date(2026, 10, 15, 9, 5).getTime(), now), "You sent Ama a reminder today at 09:05. Sending too many can annoy a customer.");
  assert.equal(reminderAgainText("AMA", new Date(2026, 10, 14, 14, 5).getTime(), now), "You sent Ama a reminder yesterday at 14:05. Sending too many can annoy a customer.");
  assert.equal(reminderAgainText("Ama", new Date(2026, 10, 10, 8, 0).getTime(), now), "You sent Ama a reminder on 10/11/2026 at 08:00. Sending too many can annoy a customer.");
});

test("every reminder button on 22, 32, 29 and 43 goes through the one shared check", () => {
  for (const file of ["src/pos/Home.jsx", "src/pos/OwedScreens.jsx", "src/pos/DebtCollection.jsx", "src/pos/ManualDebtScreens.jsx"]) {
    const source = read(file);
    assert.match(source, /useReminderCheck\(\)/, `${file} uses the shared check`);
    assert.match(source, /\{reminders\.sheet\}/, `${file} renders the shared sheet`);
    assert.doesNotMatch(source, /needsReminderCheck|REMINDER_REPEAT_WINDOW_MS|reminders\.add\(/, `${file} has no copy of the check or the record`);
    // Every WhatsApp reminder is a button whose share opens the shared opener; no <a href> link is left.
    assert.doesNotMatch(source, /<a href=\{(whatsappUrl|reminderLink|whatsappLink)\}/, `${file} has no WhatsApp link left`);
    assert.match(source, /share: (shareReminder|\(\) => openWhatsApp\()/, `${file}: the reminder opens WhatsApp through the shared opener`);
    // rules_global.person_row (chunk C): 22 and 32 draw PersonRow, which hands the tap to the check.
    if (file === "src/pos/Home.jsx") assert.match(source, /onWhatsApp=\{onWhatsApp\}/, "22: the row's WhatsApp (in PersonRow) gets the check");
    if (file === "src/pos/OwedScreens.jsx") assert.match(source, /onWhatsApp=\{\(event\) => onWhatsApp\(event, customer, reminderText\)\}/, "32: the row's WhatsApp (in PersonRow) gets the check");
  }
  assert.match(read("src/pos/PartyCard.jsx"), /<button type="button" onClick=\{whatsapp\.onClick\}/, "22's PartyCard WhatsApp is a button that passes the tap on");
  assert.match(read("src/pos/PartyCard.jsx"), /whatsapp=\{saved \? \{ onClick: onWhatsApp,/, "PersonRow passes the tap to the row's WhatsApp");
  assert.match(read("src/pos/DebtCollection.jsx"), /reminders\.onReminder\(event, \{ person: reminderPerson, lastReminderAt, share: shareReminder \}\)/, "the share-sheet button too");
});

test("a receipt never triggers the check", async () => {
  // The payment receipt on 29 (receipts on) uses the receipt actions, not the reminder path.
  const { DebtorDetail } = await loadJsx("src/pos/DebtCollection.jsx", { VITE_ENABLE_POS_RECEIPTS: "true" });
  const debt = { id: "d1", customerId: "c1", customerName: "Ama", amountPesewas: 8000, status: "unpaid", isInstallmentPlan: false, dueDate: dayOffset(7) };
  setLiveQuery(([debtId]) => (debtId === "d1" ? { name: "Ama", customerId: "c1", phone: "", ghanaCardNumber: "", balancePesewas: 8000, debt, unpaidDebts: [debt], unpaidDebtCount: 1, lastReminderAt: Date.now() - DAY, history: [{ id: "collection-c1", type: "payment", timestamp: Date.now() - 3_600_000, amountPesewas: 3000, collectionParts: [{ method: "Cash", amountPesewas: 3000 }] }] } : undefined));
  const view = render({ type: DebtorDetail, props: { params: { debtId: "d1", customerName: "Ama" }, ...props } });
  const receipt = [...walk(view.tree)].find((node) => node.type === "button" && /^Receipt for .* payment$/.test(textOf(node).trim()));
  assert.ok(receipt);
  await withNavigator(sharing, async () => {
    await receipt.props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  view.rerender();
  assert.equal(sheetOf(view), undefined, "no Send another reminder? for a receipt");
  assert.equal((await db.reminders.toArray()).length, 0, "and no reminder recorded");
  for (const file of ["src/pos/ReceiptActions.jsx", "src/pos/receiptShare.js", "src/pos/SaleRecorded.jsx", "src/pos/CreditScreens.jsx"]) {
    assert.doesNotMatch(read(file), /ReminderCheck|onReminder/, `${file} has no reminder check`);
  }
});
