import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordReminderSent } from "../src/db/reminders.js";
import { formatLastReminder } from "../src/pos/reminderLabel.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Wiring 29/43 "Last reminder line": under the action buttons and above Correct balance,
// "Last reminder: today 14:05", "yesterday 14:05" or "dd/mm/yyyy HH:mm" (24-hour), "No reminder sent
// yet" when none. Per person. Never says delivered.

after(async () => {
  setLiveQuery(null);
  db.close();
  await db.delete();
});

const dayOffset = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

test("wording: today, yesterday, an older date, and none", () => {
  const now = new Date(2026, 10, 15, 16, 0);
  assert.equal(formatLastReminder(new Date(2026, 10, 15, 14, 5).getTime(), now), "Last reminder: today 14:05");
  assert.equal(formatLastReminder(new Date(2026, 10, 14, 23, 59).getTime(), now), "Last reminder: yesterday 23:59");
  assert.equal(formatLastReminder(new Date(2026, 10, 13, 9, 3).getTime(), now), "Last reminder: 13/11/2026 09:03");
  assert.equal(formatLastReminder(new Date(2026, 0, 2, 0, 0).getTime(), now), "Last reminder: 02/01/2026 00:00");
  assert.equal(formatLastReminder(0, now), "No reminder sent yet");
  assert.equal(formatLastReminder(undefined, now), "No reminder sent yet");
  assert.equal(formatLastReminder("14:05", now), "No reminder sent yet");
});

test("the wording never says delivered, sent to the customer or read", () => {
  const now = new Date(2026, 10, 15, 16, 0);
  for (const at of [0, new Date(2026, 10, 15, 1).getTime(), new Date(2026, 10, 14, 1).getTime(), new Date(2026, 9, 1).getTime()]) {
    assert.doesNotMatch(formatLastReminder(at, now), /deliver|received|read|seen/i);
  }
});

function detailData({ late, lastReminderAt }) {
  const debt = { id: "d1", customerId: "c1", customerName: "Ama", amountPesewas: 8000, status: "unpaid", isInstallmentPlan: false, dueDate: dayOffset(late ? -3 : 7) };
  return { name: "Ama", customerId: "c1", phone: "+233241234567", ghanaCardNumber: "", balancePesewas: 8000, debt, unpaidDebts: [debt], unpaidDebtCount: 1, lastReminderAt, history: [] };
}
async function detail(data, env = {}) {
  const { DebtorDetail } = await loadJsx("src/pos/DebtCollection.jsx", env);
  setLiveQuery(([debtId]) => (debtId === "d1" ? data : undefined));
  try {
    return render({ type: DebtorDetail, props: { params: { debtId: "d1", customerName: "Ama" }, onBack() {}, onNavigate() {}, onCollect() {}, shopName: "My shop" } });
  } finally {
    setLiveQuery(null);
  }
}

for (const late of [false, true]) {
  for (const env of [{}, { VITE_ENABLE_POS_RECEIPTS: "true" }]) {
    test(`${late ? 43 : 29}${env.VITE_ENABLE_POS_RECEIPTS ? " (receipts on)" : ""}: the line sits under the action buttons and above Correct balance`, async () => {
      const at = Date.now() - 60_000;
      const view = await detail(detailData({ late, lastReminderAt: at }), env);
      const nodes = [...walk(view.tree)];
      const line = nodes.find((node) => node.props?.["data-last-reminder"] !== undefined);
      const actions = nodes.find((node) => node.props?.["data-row"] === "debtor-actions");
      const correct = nodes.find((node) => node.type === "button" && textOf(node).includes("Correct balance"));
      assert.ok(line && actions && correct);
      assert.equal(textOf(line), formatLastReminder(at));
      assert.ok(nodes.indexOf(actions) < nodes.indexOf(line), "under the action buttons");
      assert.ok(nodes.indexOf(line) < nodes.indexOf(correct), "above Correct balance");
      assert.equal(nodes.filter((node) => /Last reminder|No reminder/.test(typeof node.props?.children === "string" ? node.props.children : "")).length, 1, "shown once");
    });
  }
  test(`${late ? 43 : 29}: No reminder sent yet when none was recorded`, async () => {
    const view = await detail(detailData({ late, lastReminderAt: 0 }));
    const line = [...walk(view.tree)].find((node) => node.props?.["data-last-reminder"] !== undefined);
    assert.equal(textOf(line), "No reminder sent yet");
  });
}

test("the detail reads the latest reminder for this person from the reminder log (real query)", async () => {
  await db.customers.add({ id: "c1", name: "Ama", nameLower: "ama", phone: "" });
  await db.customers.add({ id: "c2", name: "Kofi", nameLower: "kofi", phone: "" });
  await db.debts.add({ id: "d1", customerId: "c1", customerName: "Ama", status: "unpaid", amountPesewas: 8000, total_owed: 8000 });
  await recordReminderSent({ customerId: "c1", customerName: "Ama", now: 1_000 });
  await recordReminderSent({ customerId: "c1", customerName: "Ama", now: 2_000 });
  await recordReminderSent({ customerId: "c2", customerName: "Kofi", now: 9_000 });
  const { DebtorDetail } = await loadJsx("src/pos/DebtCollection.jsx");
  let query = null;
  setLiveQuery((deps, run) => { if (deps[0] === "d1") query = run; return undefined; });
  render({ type: DebtorDetail, props: { params: { debtId: "d1", customerName: "Ama" }, onBack() {}, onNavigate() {}, onCollect() {}, shopName: "My shop" } });
  setLiveQuery(null);
  const data = await query();
  assert.equal(data.lastReminderAt, 2_000, "Ama's latest, not Kofi's");
});
