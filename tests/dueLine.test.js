import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDate } from "../src/lib/formatDate.js";
import { posText } from "../src/pos/i18n.js";
import { localDateString } from "../src/utils/installments.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// 29 (Debtor detail, on-time state) and 43 (late state) are the one DebtorDetail screen. Under the
// balance, one line about when it is due. Fixed due date and no plan: "Due dd/mm/yyyy · {status}"
// with the existing wording for the status (In N days, Late N days, Due today), the date through
// the shared formatter. An installment plan keeps its own line (the plan card). No date and no
// plan: nothing.
const dayOffset = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
};
const dateOffset = (days) => localDateString(dayOffset(days));

function debtorData(debtOverrides = {}) {
  const debt = { id: "d1", customerId: "c1", customerName: "Ama", amountPesewas: 3000, status: "unpaid", isInstallmentPlan: false, ...debtOverrides };
  return { name: "Ama", customerId: "c1", phone: "+233241234567", ghanaCardNumber: "", balancePesewas: 3000, debt, unpaidDebts: [debt], unpaidDebtCount: 1, history: [] };
}

async function detail(debtOverrides) {
  const { DebtorDetail } = await loadJsx("src/pos/DebtCollection.jsx");
  const data = debtorData(debtOverrides);
  setLiveQuery(([debtId]) => (debtId === "d1" ? data : undefined));
  const view = render({ type: DebtorDetail, props: { params: { debtId: "d1", customerName: "Ama" }, onBack() {}, onNavigate() {}, onCollect() {}, shopName: "My shop" } });
  setLiveQuery(null);
  return view;
}
const balanceSection = (tree) => [...walk(tree)].find((node) => node.type === "section" && textOf(node).startsWith("Ama owes") && textOf(node).includes("GH₵30.00"));
const dueLines = (tree) => [...walk(tree)].filter((node) => node.type === "p" && /^Due /.test(textOf(node))).map(textOf);
const hasReminder = (tree) => /Send reminder on WhatsApp/.test(textOf(tree));

// ---- 29: on time and due today --------------------------------------------------------------------------------

test("29 on time: 'Due dd/mm/yyyy · In N days' under the balance", async () => {
  for (const [days, status] of [[5, "In 5 days"], [1, "In 1 day"], [30, "In 30 days"]]) {
    const view = await detail({ dueDate: dateOffset(days) });
    const expected = `Due ${formatDate(dateOffset(days))} · ${status}`;
    assert.deepEqual(dueLines(view.tree), [expected], status);
    assert.match(textOf(balanceSection(view.tree)), new RegExp(`GH₵30\\.00${expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "inside the balance block, right under the amount");
    assert.equal(hasReminder(view.tree), false, "29 has no late reminder button");
  }
});

test("29 due today: 'Due today' for the status", async () => {
  const view = await detail({ dueDate: dateOffset(0) });
  assert.deepEqual(dueLines(view.tree), [`Due ${formatDate(dateOffset(0))} · Due today`]);
  assert.equal(hasReminder(view.tree), false, "due today is not late");
});

// ---- 43: late -------------------------------------------------------------------------------------------------------

test("43 late: 'Due dd/mm/yyyy · Late N days', once, with the reminder button", async () => {
  for (const [days, status] of [[3, "Late 3 days"], [1, "Late 1 day"], [7, "Late 7 days"]]) {
    const view = await detail({ dueDate: dateOffset(-days) });
    const expected = `Due ${formatDate(dateOffset(-days))} · ${status}`;
    assert.deepEqual(dueLines(view.tree), [expected], status);
    const text = textOf(view.tree);
    assert.equal(text.split(status).length - 1, 1, "the late wording appears once, not again under the balance");
    assert.equal(hasReminder(view.tree), true, "43 keeps Send reminder on WhatsApp");
  }
});

// ---- no date, and a plan --------------------------------------------------------------------------------------------

test("29 and 43 with no date and no plan: nothing about a due date", async () => {
  for (const dueDate of [undefined, ""]) {
    const view = await detail({ dueDate });
    assert.deepEqual(dueLines(view.tree), []);
    assert.doesNotMatch(textOf(view.tree), /Due date not set|In \d+ days?|Late \d+ days?/);
    assert.equal(hasReminder(view.tree), false);
  }
});

test("an installment plan keeps its own line and gets no fixed-date line (on time and late)", async () => {
  const plan = { isInstallmentPlan: true, installmentAmount: 1000, frequency: "weekly", installmentsRemaining: 3, totalInstallments: 3 };
  const onTime = await detail({ ...plan, nextDueDate: dateOffset(5), dueDate: "" });
  assert.deepEqual(dueLines(onTime.tree), []);
  assert.match(textOf(onTime.tree), /GH₵10\.00 every week/);
  assert.match(textOf(onTime.tree), new RegExp(`Next payment ${formatDate(dateOffset(5)).replaceAll("/", "\\/")}`));
  assert.match(textOf(onTime.tree), /In 5 days/);

  const late = await detail({ ...plan, nextDueDate: dateOffset(-3), dueDate: "" });
  assert.deepEqual(dueLines(late.tree), []);
  assert.match(textOf(late.tree), /Late 3 days/, "the plan's late wording is unchanged");
  assert.equal(hasReminder(late.tree), true);
});

test("a plan with an old fixed date still shows only the plan line (the plan wins)", async () => {
  const view = await detail({ isInstallmentPlan: true, installmentAmount: 1000, frequency: "weekly", installmentsRemaining: 3, totalInstallments: 3, nextDueDate: dateOffset(5), dueDate: dateOffset(-9) });
  assert.deepEqual(dueLines(view.tree), []);
  assert.doesNotMatch(textOf(view.tree), /Late 9 days/);
});

// ---- the wording ---------------------------------------------------------------------------------------------------

test("the line is built from existing wording and the shared date formatter", () => {
  assert.equal(posText("debt.dueLine", { date: "20/11/2026", status: posText("debt.inDays", { days: 5, plural: "s" }) }), "Due 20/11/2026 · In 5 days");
  assert.equal(posText("debt.inDays", { days: 1, plural: "" }), "In 1 day");
  assert.equal(posText("debt.lateDays", { days: 7, plural: "s" }), "Late 7 days");
  assert.equal(posText("debt.dueToday"), "Due today");
});