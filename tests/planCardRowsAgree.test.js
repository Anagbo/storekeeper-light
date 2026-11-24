import assert from "node:assert/strict";
import { test } from "node:test";
import { getPlanPeriodFigures, localDateString } from "../src/utils/installments.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Wiring 29/43/54 "Plan card rows" (21 Nov 2026), chunk H item 4h (d): the plan card, the 53 Existing payment
// terms card and the 25 Collect sheet agree, from one shared function (getPlanPeriodFigures, payments left from
// getInstallmentsLeft). The owner's example: GH₵20.00 weekly, GH₵50.00 owed, GH₵10.00 paid toward the payment
// now due: Paid GH₵10.00, Still needed GH₵10.00, Payments left 3.

const inDays = (days) => { const date = new Date(); date.setDate(date.getDate() + days); return localDateString(date); };
const debt = {
  id: "d1", customerId: "c1", customerName: "Ama", status: "unpaid", amountPesewas: 5000, isInstallmentPlan: true,
  installmentAmount: 2000, frequency: "weekly", nextDueDate: inDays(5), installmentPaymentCarryPesewas: 1000,
  installmentsRemaining: 3, totalInstallments: 4
};
const rows = (tree, names) => Object.fromEntries([...walk(tree)]
  .filter((node) => names.includes(node.props?.["data-event-detail"]))
  .map((node) => [node.props["data-event-detail"], textOf(node)]));

test("getPlanPeriodFigures: the owner's example, and money only", () => {
  assert.deepEqual(getPlanPeriodFigures(debt), { paidPesewas: 1000, stillNeededPesewas: 1000, paymentsLeft: 3 });
  assert.deepEqual(getPlanPeriodFigures({ ...debt, installmentPaymentCarryPesewas: undefined }), { paidPesewas: 0, stillNeededPesewas: 2000, paymentsLeft: 3 });
  // Payments left never reads the stored counters.
  assert.equal(getPlanPeriodFigures({ ...debt, installmentsRemaining: 40, totalInstallments: 44 }).paymentsLeft, 3);
  // No usable plan: null (the card is not shown).
  assert.equal(getPlanPeriodFigures({ ...debt, isInstallmentPlan: false }), null);
  assert.equal(getPlanPeriodFigures({ ...debt, installmentAmount: 0 }), null);
  assert.equal(getPlanPeriodFigures(null), null);
});

test("53 (Existing payment terms, nothing typed yet) shows the same Paid, Still needed and Payments left", async () => {
  const { ManualDebtAmount } = await loadJsx("src/pos/ManualDebtScreens.jsx");
  const customer = { id: "c1", name: "Ama", totalDebtPesewas: 5000, debt };
  const view = render({ type: ManualDebtAmount, props: { params: { manualDebt: true, customer }, onBack() {}, onNavigate() {}, onSaveManualDebt: async () => {} } });
  const shown = rows(view.tree, ["paid", "still-needed", "payments-left"]);
  assert.deepEqual(shown, { paid: "PaidGH₵10.00", "still-needed": "Still neededGH₵10.00", "payments-left": "Payments left3" });
});

test("29 plan card and the 25 Collect sheet agree on payments left (3 now, 2 after Due now)", async () => {
  const { CollectPayment, DebtorDetail } = await loadJsx("src/pos/DebtCollection.jsx");
  const data = { name: "Ama", customerId: "c1", phone: "", ghanaCardNumber: "", balancePesewas: 5000, debt, unpaidDebts: [debt], unpaidDebtCount: 1, history: [], planPaidPesewas: 1000 };
  setLiveQuery(([debtId]) => (debtId === "d1" ? data : undefined));
  const card = rows(render({ type: DebtorDetail, props: { params: { debtId: "d1", customerName: "Ama" }, onBack() {}, onNavigate() {}, onCollect() {}, shopName: "My shop" } }).tree, ["paid", "still-needed", "payments-left"]);
  assert.deepEqual(card, { paid: "PaidGH₵10.00", "still-needed": "Still neededGH₵10.00", "payments-left": "Payments left3" });
  setLiveQuery(() => debt);
  const sheet = textOf(render({ type: CollectPayment, props: { params: { debtId: "d1" }, onClose() {}, onNavigate() {}, onRecordCollection() {} } }).tree);
  setLiveQuery(null);
  assert.match(sheet, /2 payments left after this/, "25 Due now: one fewer than the card's 3");
  assert.doesNotMatch(sheet, /(?<![.\d₵,])\d+ of \d+/, "25: no count of installments");
});

// Owner's decision (21 Nov 2026): on the 25 Collect sheet, Due now equals Still needed when the payment now due is
// partly paid. Missed payments are never added together (kept as before: one payment at nextDueDate).
async function sheetOf(debtRecord, mode) {
  const { CollectPayment } = await loadJsx("src/pos/DebtCollection.jsx");
  setLiveQuery(() => debtRecord);
  const view = render({ type: CollectPayment, props: { params: { debtId: "d1", ...(mode ? { collectMode: mode } : {}) }, onClose() {}, onNavigate() {}, onRecordCollection() {} } });
  setLiveQuery(null);
  const amount = [...walk(view.tree)].find((node) => node.type === "span" && String(node.props?.className ?? "").includes("amount-fit "));
  return { amount: textOf(amount), text: textOf(view.tree) };
}

test("25 Due now equals Still needed: GH₵20.00 weekly, GH₵10.00 paid, GH₵50.00 owed is GH₵10.00, 2 payments left after this", async () => {
  const { amount, text } = await sheetOf(debt);
  assert.equal(amount, "GH₵10.00", "Due now");
  assert.equal(amount.replace("GH₵", ""), (getPlanPeriodFigures(debt).stillNeededPesewas / 100).toFixed(2), "the plan card's Still needed");
  assert.match(text, /2 payments left after this/);
  // Pay all is unchanged: the whole balance.
  assert.equal((await sheetOf(debt, "all")).amount, "GH₵50.00", "Pay all");
});

test("25 Due now with nothing paid toward the payment is still the full payment", async () => {
  const { amount, text } = await sheetOf({ ...debt, installmentPaymentCarryPesewas: 0 });
  assert.equal(amount, "GH₵20.00");
  assert.match(text, /2 payments left after this/);
});

test("25 'left after this' comes from the balance after Due now, so a partly paid payment cannot make it wrong", async () => {
  // GH₵50.00 owed, GH₵15.00 already paid toward this GH₵20.00 payment: Due now GH₵5.00 leaves GH₵45.00, which is
  // still 3 payments (rounded up), not 3 - 1.
  const { amount, text } = await sheetOf({ ...debt, installmentPaymentCarryPesewas: 1500 });
  assert.equal(amount, "GH₵5.00");
  assert.match(text, /3 payments left after this/);
  // The last payment, partly paid: GH₵8.00 owed, GH₵12.00 paid toward GH₵20.00: Due now is the GH₵8.00 balance.
  const last = await sheetOf({ ...debt, amountPesewas: 800, installmentPaymentCarryPesewas: 1200 });
  assert.equal(last.amount, "GH₵8.00");
  assert.match(last.text, /This is the last payment\./);
});

test("25 several payments overdue: Due now stays one payment (missed payments are not added together)", async () => {
  // Three weeks late, nothing paid toward the payment due then: Due now GH₵20.00, as before.
  const late = { ...debt, nextDueDate: inDays(-21), installmentPaymentCarryPesewas: 0 };
  assert.equal((await sheetOf(late)).amount, "GH₵20.00");
  // Three weeks late with GH₵10.00 paid toward that oldest payment: what is left of it, GH₵10.00.
  assert.equal((await sheetOf({ ...late, installmentPaymentCarryPesewas: 1000 })).amount, "GH₵10.00");
});
