import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { POS_LINKS, POS_ROUTES } from "../src/pos/routes.js";
import { localDateString } from "../src/utils/installments.js";
import wiring from "../src/pos/wiring.json" with { type: "json" };
import { findButton, findComponent, loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

after(async () => {
  setLiveQuery(null);
  db.close();
  await db.delete();
});
beforeEach(async () => {
  setLiveQuery(null);
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.products].map((table) => table.clear()));
});

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const settle = () => new Promise((resolve) => setImmediate(resolve));
const daysAgo = (days, from = new Date()) => {
  const date = new Date(from);
  date.setDate(date.getDate() - days);
  return date;
};
const findByLabel = (tree, label) => [...walk(tree)].find((node) => node.props?.["aria-label"] === label);

// ---- 37 Save price goes to 20 ----
test("37: Save price returns to 20 with the item in the sale, not to 38", async () => {
  const { HowMuchIsItem } = await loadJsx("src/pos/SetupScreens.jsx");
  const productId = await db.products.add({ name: "Sugar", default_price: "", active: true, createdAt: Date.now(), updatedAt: Date.now() });
  const calls = [];
  const view = render({ type: HowMuchIsItem, props: {
    params: { product: { id: productId, name: "Sugar" }, saleItems: [] },
    onBack() {},
    onNavigate: (...args) => calls.push(["navigate", ...args]),
    onReturnTo: (...args) => calls.push(["returnTo", ...args])
  } });
  // Batch 15: the price is typed on the number pad (4 5 0 = 450 pesewas), not into a text field.
  for (const digit of ["4", "5", "0"]) {
    [...walk(view.tree)].find((node) => node.type === "button" && textOf(node) === digit).props.onClick();
    view.rerender();
  }
  findButton(view.tree, "Save price").props.onClick();
  for (let index = 0; index < 20 && !calls.length; index += 1) await settle();
  assert.equal(calls.length, 1, "one navigation");
  const [kind, route, params] = calls[0];
  assert.equal(kind, "returnTo");
  assert.equal(route, wiring.screens["20"].component);
  assert.deepEqual(params.saleItems, [{ productId, name: "Sugar", quantity: 1, unitPricePesewas: 450 }]);
  assert.equal(params.amountPesewas, 450);
});

// ---- 38 "Add {quantity}" ----
test("38: the button reads Add {quantity}", async () => {
  const { HowManyItem } = await loadJsx("src/pos/SetupScreens.jsx");
  const view = render({ type: HowManyItem, props: { params: { product: { id: 1, name: "Bread", default_price: "2.00" }, quantity: 12 }, onBack() {}, onReturnTo() {} } });
  assert.ok(findButton(view.tree, "Add 12"), "Add 12");
  assert.doesNotMatch(textOf(view.tree), /Add to sale/);
  assert.match(wiring.screens["38"].rules[0], /Add \{quantity\}/);
});

// ---- 53 Taken on ----
test("53: Taken on: Today is shown, can be changed to an older date, and goes with the debt", async () => {
  const { ManualDebtAmount } = await loadJsx("src/pos/ManualDebtScreens.jsx");
  const calls = [];
  const view = render({ type: ManualDebtAmount, props: {
    params: { manualDebt: true, customer: { id: "c1", name: "Ama", totalDebtPesewas: 0 } },
    onBack() {},
    onNavigate: (...args) => calls.push(args),
    onSaveManualDebt: async () => {}
  } });
  const takenOn = findButton(view.tree, "Taken on: Today");
  assert.ok(takenOn, "Taken on: Today");
  takenOn.props.onClick();
  view.rerender();
  const dateInput = findByLabel(view.tree, "Taken on");
  assert.ok(dateInput, "a date field opens");
  assert.equal(dateInput.props.type, "date");
  assert.equal(dateInput.props.max, localDateString(), "no future dates");
  const older = localDateString(daysAgo(8));
  dateInput.props.onChange({ target: { value: older } });
  view.rerender();
  const [year, month, day] = older.split("-");
  assert.ok(findButton(view.tree, `Taken on: ${day}/${month}/${year}`), "shows the chosen date");
  for (const key of ["5", "0", "0"]) findButton(view.tree, key).props.onClick();
  view.rerender();
  findButton(view.tree, "Next").props.onClick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "WhenWillTheyPay");
  assert.equal(calls[0][1].takenOn, older);
});

test("53: Taken on defaults to today's date when it is not changed", async () => {
  const { ManualDebtAmount } = await loadJsx("src/pos/ManualDebtScreens.jsx");
  const calls = [];
  const view = render({ type: ManualDebtAmount, props: { params: { manualDebt: true, customer: { id: "c1", name: "Ama" } }, onBack() {}, onNavigate: (...args) => calls.push(args), onSaveManualDebt: async () => {} } });
  findButton(view.tree, "5").props.onClick();
  view.rerender();
  findButton(view.tree, "Next").props.onClick();
  assert.equal(calls[0][1].takenOn, localDateString());
});

test("53: recordManualDebt stores Taken on on the credit event and the new debt, and keeps the record time", async () => {
  const { recordManualDebt } = await import("../src/db/debtLedger.js");
  const now = Date.now();
  const takenOn = localDateString(daysAgo(10));
  const { debt } = await recordManualDebt({ name: "Ama", amountPesewas: 5000, takenOn, now });
  const event = (await db.transactions.toArray()).find((row) => row.type === "manual_debt");
  assert.equal(event.takenOn, takenOn);
  assert.equal(event.createdAt, now, "the record time is when it was entered");
  assert.equal(debt.takenOn, takenOn);
  assert.equal(debt.createdAt, now);
  await assert.rejects(recordManualDebt({ name: "Ama", amountPesewas: 100, takenOn: localDateString(daysAgo(-2)), now }), /Taken on/);
  await assert.rejects(recordManualDebt({ name: "Ama", amountPesewas: 100, takenOn: "2026-02-30", now }), /Taken on/);
});

test("53: a backdated debt orders by its Taken on date in history and shows a date with no time", async () => {
  const { recordManualDebt } = await import("../src/db/debtLedger.js");
  const { loadCustomerHistory } = await import("../src/utils/loadCustomerDebtHistory.js");
  const first = await recordManualDebt({ name: "Ama", amountPesewas: 5000, now: daysAgo(4).getTime() });
  await db.payments.add({ id: "p1", customerId: first.customer.id, debtId: first.debt.id, amountPesewas: 1000, paymentMethod: "cash", createdAt: daysAgo(3).getTime() });
  const takenOn = localDateString(daysAgo(6));
  await recordManualDebt({ name: "Ama", customerId: first.customer.id, amountPesewas: 2000, takenOn, now: Date.now() });
  const { events } = await loadCustomerHistory(first.customer.id, "Ama");
  const order = events.map((event) => `${event.type}:${event.amountPesewas}`);
  assert.deepEqual(order, ["payment:1000", "manual_debt:5000", "manual_debt:2000"], "newest first, the backdated debt last");
  const backdated = events.find((event) => event.amountPesewas === 2000);
  assert.equal(backdated.dateOnly, true);
  assert.equal(localDateString(new Date(backdated.timestamp)), takenOn);
  assert.equal(events.find((event) => event.amountPesewas === 5000).dateOnly, undefined, "a debt taken on the day it is entered keeps its time");
  assert.match(read("src/pos/DebtCollection.jsx"), /event\.dateOnly \?/);
});

test("53: PosApp passes Taken on to recordManualDebt and no longer backdates the record time", () => {
  const app = read("src/pos/PosApp.jsx");
  assert.match(app, /takenOn: details\.takenOn \?\? ""/);
  assert.doesNotMatch(app, /takenOnTimestamp/);
});

// ---- 43 late state ----
function lateDebtorData(overrides = {}) {
  const debt = { id: "d1", customerId: "c1", customerName: "Ama", amountPesewas: 3000, status: "unpaid", isInstallmentPlan: false, dueDate: localDateString(daysAgo(3)), ...overrides };
  return { name: "Ama", customerId: "c1", phone: "+233241234567", ghanaCardNumber: "", balancePesewas: 3000, debt, unpaidDebts: [debt], unpaidDebtCount: 1, history: [] };
}

test("43: late state shows a full-width Send reminder on WhatsApp and Last reminder from lastReminderAt", async () => {
  const { DebtorDetail } = await loadJsx("src/pos/DebtCollection.jsx");
  const data = lateDebtorData({ lastReminderAt: daysAgo(2).getTime() });
  setLiveQuery(([debtId]) => (debtId === "d1" ? data : undefined));
  const view = render({ type: DebtorDetail, props: { params: { debtId: "d1", customerName: "Ama" }, onBack() {}, onNavigate() {}, onCollect() {}, shopName: "My shop" } });
  const send = [...walk(view.tree)].find((node) => node.type === "a" && textOf(node).includes("Send reminder on WhatsApp"));
  assert.ok(send, "Send reminder on WhatsApp");
  assert.match(send.props.className, /w-full/);
  assert.match(textOf(view.tree), /Last reminder: 2 days ago/);
});

test("43: no Last reminder line before any reminder, and the on-time state (29) keeps its WhatsApp button", async () => {
  const { DebtorDetail } = await loadJsx("src/pos/DebtCollection.jsx");
  setLiveQuery(([debtId]) => (debtId === "d1" ? lateDebtorData() : undefined));
  let view = render({ type: DebtorDetail, props: { params: { debtId: "d1", customerName: "Ama" }, onBack() {}, onNavigate() {}, onCollect() {}, shopName: "My shop" } });
  assert.match(textOf(view.tree), /Send reminder on WhatsApp/);
  assert.doesNotMatch(textOf(view.tree), /Last reminder/);
  setLiveQuery(([debtId]) => (debtId === "d1" ? lateDebtorData({ dueDate: localDateString(daysAgo(-5)) }) : undefined));
  view = render({ type: DebtorDetail, props: { params: { debtId: "d1", customerName: "Ama" }, onBack() {}, onNavigate() {}, onCollect() {}, shopName: "My shop" } });
  assert.doesNotMatch(textOf(view.tree), /Send reminder on WhatsApp/);
});

test("43: Last reminder wording for today, one day and several days", async () => {
  const { formatLastReminder } = await import("../src/pos/reminderLabel.js");
  const now = new Date(2026, 10, 9, 15);
  assert.equal(formatLastReminder(new Date(2026, 10, 9, 8).getTime(), now), "Last reminder: today");
  assert.equal(formatLastReminder(new Date(2026, 10, 8, 23).getTime(), now), "Last reminder: 1 day ago");
  assert.equal(formatLastReminder(new Date(2026, 10, 7, 9).getTime(), now), "Last reminder: 2 days ago");
  assert.equal(formatLastReminder(undefined, now), "");
});

// The old per-debt lastReminderAt record (written on return from WhatsApp) was replaced by the
// reminder event log (rules_global.reminders, 15 Nov 2026): see tests/reminderRecord.test.js.

// ---- wording on 52, 36, 23, 32 ----
test("52: items are grouped by category with Show all {n}, named Show all {category}, which expands the group", async () => {
  const { default: ItemScreens } = await loadJsx("src/pos/ItemScreens.jsx");
  setLiveQuery(() => ({ products: [], error: "" }));
  const view = render({ type: ItemScreens, props: { route: "YourStarterListGrouped", params: { setupFlow: true, starterCategories: ["provisions", "food"] }, onBack() {}, onCompleteSetup: async () => {} } });
  for (const [label, count] of [["Show all Provisions shop", 14], ["Show all Food and drinks", 13]]) {
    const button = findByLabel(view.tree, label);
    assert.ok(button, label);
    assert.match(textOf(button), new RegExp(`Show all ${count}`));
  }
  assert.doesNotMatch(textOf(view.tree), /Show more/);
  const before = [...walk(view.tree)].filter((node) => node.props?.["aria-pressed"] !== undefined).length;
  assert.equal(before, 6, "three items shown per group");
  findByLabel(view.tree, "Show all Provisions shop").props.onClick();
  view.rerender();
  const afterExpand = [...walk(view.tree)].filter((node) => node.props?.["aria-pressed"] !== undefined).length;
  assert.equal(afterExpand, 14 + 3);
  assert.ok(findButton(view.tree, "Continue · 27 items"));
});

test("36: from My items the button reads Continue · N items, and Show more gives the count", async () => {
  const { default: ItemScreens } = await loadJsx("src/pos/ItemScreens.jsx");
  setLiveQuery(() => ({ products: [], error: "" }));
  const view = render({ type: ItemScreens, props: { route: "YourStarterList", params: {}, onBack() {}, onCompleteSetup: async () => {} } });
  const first = [...walk(view.tree)].find((node) => node.props?.["aria-pressed"] === false);
  first.props.onClick();
  view.rerender();
  assert.ok(findButton(view.tree, "Continue · 1 items"), "Continue · N items");
  assert.doesNotMatch(textOf(view.tree), /Add 1 item/);
  const setup = render({ type: ItemScreens, props: { route: "YourStarterList", params: { setupFlow: true, starterCategories: ["provisions"] }, onBack() {}, onCompleteSetup: async () => {} } });
  assert.ok(findButton(setup.tree, "Show more (63)"), "Show more ({count})");
});

test("23: the close button is named Close menu", async () => {
  const { default: MenuDrawer } = await loadJsx("src/pos/MenuDrawer.jsx");
  const view = render({ type: MenuDrawer, props: { current: "Home", shopName: "Shop", onClose() {}, onChoose() {} } });
  assert.ok(findByLabel(view.tree, "Close menu"));
});

test("32: each WhatsApp button is named WhatsApp {name}", () => {
  const source = read("src/pos/OwedScreens.jsx");
  assert.match(source, /aria-label=\{`WhatsApp \$\{displayName\(customer\.customerName\)\}`\}/);
  assert.doesNotMatch(source, /WhatsApp reminder for/);
});

// ---- dead AddDebt screen ----
test("the dead AddDebt screen, its route and its POS_LINKS entries are gone", () => {
  assert.equal(POS_ROUTES.AddDebt, undefined);
  assert.equal(POS_LINKS.some((link) => link.from === "AddDebt" || link.to === "AddDebt"), false);
  assert.equal(existsSync(new URL("../src/pos/AddDebt.jsx", import.meta.url)), false);
  assert.doesNotMatch(read("src/pos/PosApp.jsx"), /AddDebt\b/);
  assert.doesNotMatch(read("src/pos/i18n.js"), /planned\.titles\.AddDebt/);
});