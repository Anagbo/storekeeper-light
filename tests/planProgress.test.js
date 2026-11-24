import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale, recordDebtCollection } from "../src/db/debts.js";
import { correctDebtBalance, recordManualDebt } from "../src/db/debtLedger.js";
import { getPlanProgress, localDateString, prepareInstallmentPlan } from "../src/utils/installments.js";
import { calculateLedgerEventBalance, getCustomerLedgerRecords, getPlanPaidPesewas } from "../src/utils/debtLedgerMath.js";
import { checkLedgerConsistency } from "../src/utils/consistency.js";
import { findButton, loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";
import { replayAmos } from "./helpers/amosReplay.js";

// Owner rule (wiring 25, 11 Nov 2026): plan counts come from money only.
// left = balance ÷ installment rounded up, paid = money paid ÷ installment rounded down,
// total = paid + left, progress = money paid ÷ (money paid + balance).
after(async () => {
  db.close();
  await db.delete();
});
beforeEach(async () => {
  await Promise.all([db.debts, db.customers, db.transactions, db.payments].map((table) => table.clear()));
});

// ---- getPlanProgress ------------------------------------------------------------------------------------------------

test("getPlanProgress: amos GH₵21.00 paid, GH₵834.00 balance, GH₵20.00 each gives 1 / 42 / 43", () => {
  const progress = getPlanProgress({ balancePesewas: 83400, installmentAmountPesewas: 2000, paidPesewas: 2100 });
  assert.equal(progress.paid, 1);
  assert.equal(progress.left, 42);
  assert.equal(progress.total, 43);
  assert.ok(Math.abs(progress.progress - 2100 / 85500) < 1e-12);
  assert.ok(progress.progress > 0.024 && progress.progress < 0.025, "about 2.5%");
});

test("getPlanProgress: nothing paid", () => {
  assert.deepEqual(getPlanProgress({ balancePesewas: 3000, installmentAmountPesewas: 1000, paidPesewas: 0 }),
    { paid: 0, left: 3, total: 3, progress: 0 });
});

test("getPlanProgress: exact multiples", () => {
  assert.deepEqual(getPlanProgress({ balancePesewas: 3000, installmentAmountPesewas: 1000, paidPesewas: 2000 }),
    { paid: 2, left: 3, total: 5, progress: 0.4 });
});

test("getPlanProgress: part installments round paid down and left up", () => {
  assert.deepEqual(getPlanProgress({ balancePesewas: 2500, installmentAmountPesewas: 1000, paidPesewas: 500 }),
    { paid: 0, left: 3, total: 3, progress: 500 / 3000 });
  assert.deepEqual(getPlanProgress({ balancePesewas: 1500, installmentAmountPesewas: 1000, paidPesewas: 1500 }),
    { paid: 1, left: 2, total: 3, progress: 0.5 });
});

test("getPlanProgress: balance 0", () => {
  assert.deepEqual(getPlanProgress({ balancePesewas: 0, installmentAmountPesewas: 1000, paidPesewas: 3000 }),
    { paid: 3, left: 0, total: 3, progress: 1 });
  assert.deepEqual(getPlanProgress({ balancePesewas: 0, installmentAmountPesewas: 1000, paidPesewas: 0 }),
    { paid: 0, left: 0, total: 0, progress: 0 });
});

test("getPlanProgress: invalid installment gives zeros", () => {
  assert.deepEqual(getPlanProgress({ balancePesewas: 3000, installmentAmountPesewas: 0, paidPesewas: 500 }),
    { paid: 0, left: 0, total: 0, progress: 0 });
});

// ---- the ledger's paid total -------------------------------------------------------------------------------------

test("calculateLedgerEventBalance returns the payment total next to the balance", () => {
  const credit = { id: "t1", type: "credit_sale", customerId: "c1", amountPesewas: 5000, creditExtendedPesewas: 5000 };
  const income = { id: "t2", type: "income", customerId: "c1", amountPesewas: 2000 };
  const payment = { id: "p1", customerId: "c1", debtId: "d1", transactionId: "t2", amountPesewas: 2000 };
  assert.deepEqual(calculateLedgerEventBalance([credit, income], [payment]), { balancePesewas: 3000, paidPesewas: 2000 });
});

test("amos replay: GH₵21.00 paid against the plan (the GH₵5.00 paid at the sale is not a debt payment)", async () => {
  const { stored } = await replayAmos();
  const paid = await planPaid(stored);
  assert.equal(paid, 2100);
  const progress = getPlanProgress({ balancePesewas: stored.amountPesewas, installmentAmountPesewas: stored.installmentAmount, paidPesewas: paid });
  assert.deepEqual([progress.paid, progress.left, progress.total], [1, 42, 43]);
});

// ---- regression: writers keep paid + left equal to the money -------------------------------------------------------

const inDays = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localDateString(date);
};
const plan = (balance, installment) => ({
  isInstallmentPlan: true, installmentAmount: installment, frequency: "weekly", nextDueDate: inDays(7),
  installmentsRemaining: Math.ceil(balance / installment), totalInstallments: Math.ceil(balance / installment),
  installmentPaymentCarryPesewas: 0
});
const collect = (debtId, amountPesewas) => recordDebtCollection({ debtId, parts: [{ paymentMethod: "cash", amountPesewas }] });

async function ledgerFor(debt) {
  return getCustomerLedgerRecords({
    customerId: debt.customerId, customerName: debt.customerName ?? debt.customer_name ?? "",
    debts: await db.debts.toArray(), transactions: await db.transactions.toArray(), payments: await db.payments.toArray()
  });
}
async function planPaid(debt) {
  return getPlanPaidPesewas(await ledgerFor(debt), debt.id);
}
// paid + left must match the money: paid installments cover the money paid (rounded down),
// left installments cover the balance (rounded up), and money paid + balance is everything owed.
async function assertMoney(debtId, step, { paidPesewas, owedPesewas }) {
  const debt = await db.debts.get(debtId);
  const paid = await planPaid(debt);
  assert.equal(paid, paidPesewas, `${step}: money paid`);
  assert.equal(paid + debt.amountPesewas, owedPesewas, `${step}: money paid + balance = everything owed`);
  const progress = getPlanProgress({ balancePesewas: debt.amountPesewas, installmentAmountPesewas: debt.installmentAmount, paidPesewas: paid });
  assert.equal(progress.paid, Math.floor(paidPesewas / debt.installmentAmount), `${step}: paid`);
  assert.equal(progress.left, Math.ceil(debt.amountPesewas / debt.installmentAmount), `${step}: left`);
  assert.equal(progress.total, progress.paid + progress.left, `${step}: total`);
  const { issues } = await checkLedgerConsistency(db);
  assert.deepEqual(issues.filter((issue) => issue.code === "installment_schedule_mismatch"), [], `${step}: consistency`);
}

test("start today on an existing plan after a part payment", async () => {
  const { debtId } = await recordCreditSale({ name: "Ama", amountPesewas: 3000, installmentPlan: plan(3000, 1000) });
  await collect(debtId, 500);
  const prepared = prepareInstallmentPlan({
    amountPesewas: 3500, installmentAmountPesewas: 1000, frequency: "weekly",
    nextDueDate: inDays(0), startToday: true, initialPaymentLimitPesewas: 1000
  });
  await recordCreditSale({
    name: "Ama", amountPesewas: 1000, installmentPlan: { ...prepared.plan, nextDueDate: inDays(7) },
    initialPaymentPesewas: 1000, initialPaymentParts: [{ paymentMethod: "cash", amountPesewas: 1000 }]
  });
  // GH₵10.00 today pays the GH₵10.00 sale, which never becomes debt; only the GH₵5.00
  // collection is a debt payment.
  await assertMoney(debtId, "after the start-today sale", { paidPesewas: 500, owedPesewas: 3000 });
  await collect(debtId, 1000);
  await assertMoney(debtId, "after collecting 1000", { paidPesewas: 1500, owedPesewas: 3000 });
});

test("start today on an existing plan after a part payment, paying more than the sale", async () => {
  const { debtId } = await recordCreditSale({ name: "Ama", amountPesewas: 3000, installmentPlan: plan(3000, 1000) });
  await collect(debtId, 500);
  const prepared = prepareInstallmentPlan({
    amountPesewas: 2700, installmentAmountPesewas: 1000, frequency: "weekly",
    nextDueDate: inDays(0), startToday: true, initialPaymentLimitPesewas: 1000
  });
  await recordCreditSale({
    name: "Ama", amountPesewas: 200, installmentPlan: { ...prepared.plan, nextDueDate: inDays(7) },
    initialPaymentPesewas: 1000, initialPaymentParts: [{ paymentMethod: "cash", amountPesewas: 1000 }]
  });
  // GH₵2.00 pays the sale, GH₵8.00 pays the old debt: GH₵13.00 paid, GH₵17.00 left.
  await assertMoney(debtId, "after the start-today sale", { paidPesewas: 1300, owedPesewas: 3000 });
});

test("add-on (53) after a part payment", async () => {
  const { debt: first, customer } = await recordManualDebt({ name: "Ama", amountPesewas: 3000, installmentPlan: plan(3000, 1000) });
  await collect(first.id, 500);
  const debt = await db.debts.get(first.id);
  await recordManualDebt({ name: "Ama", customerId: customer.id, debtId: first.id, amountPesewas: 1000, installmentPlan: {
    isInstallmentPlan: true, installmentAmount: 1000, frequency: "weekly", nextDueDate: debt.nextDueDate,
    installmentsRemaining: Math.ceil(3500 / 1000), totalInstallments: debt.totalInstallments
  } });
  await assertMoney(first.id, "after adding 1000", { paidPesewas: 500, owedPesewas: 4000 });
  await collect(first.id, 700);
  await assertMoney(first.id, "after collecting 700", { paidPesewas: 1200, owedPesewas: 4000 });
});

test("balance correction after a part payment", async () => {
  const { debt: first } = await recordManualDebt({ name: "Ama", amountPesewas: 3000, installmentPlan: plan(3000, 1000) });
  await collect(first.id, 500);
  const before = await db.debts.get(first.id);
  await correctDebtBalance({ debtId: first.id, expectedUpdatedAt: before.updatedAt, newBalancePesewas: 1800, reasonCode: "wrong_amount" });
  // A correction is not a payment: the paid money stays GH₵5.00, the total owed drops.
  await assertMoney(first.id, "after correcting to 1800", { paidPesewas: 500, owedPesewas: 2300 });
});

test("plan change after a part payment", async () => {
  const { debt: first, customer } = await recordManualDebt({ name: "Ama", amountPesewas: 3000, installmentPlan: plan(3000, 1000) });
  await collect(first.id, 500);
  await recordManualDebt({ name: "Ama", customerId: customer.id, debtId: first.id, amountPesewas: 1000, installmentPlan: plan(3500, 700) });
  await assertMoney(first.id, "after changing to GH₵7.00 each", { paidPesewas: 500, owedPesewas: 4000 });
  await collect(first.id, 900);
  await assertMoney(first.id, "after collecting 900", { paidPesewas: 1400, owedPesewas: 4000 });
});

// ---- collect sheet (25) ------------------------------------------------------------------------------------------

const planDebt = (overrides = {}) => ({
  id: "d1", customerId: "c1", customerName: "amos", status: "unpaid", isInstallmentPlan: true,
  installmentAmount: 2000, frequency: "weekly", nextDueDate: inDays(7), amountPesewas: 83400,
  installmentsRemaining: 42, totalInstallments: 44, ...overrides
});
async function sheet(debt) {
  const { CollectPayment } = await loadJsx("src/pos/DebtCollection.jsx");
  setLiveQuery(() => debt);
  const view = render({ type: CollectPayment, props: { params: { debtId: debt.id }, onClose() {}, onNavigate() {}, onRecordCollection() {} } });
  return view;
}
const sheetText = (view) => textOf(view.tree);

test("25 Due now: '{left−1} left after this', never 'Payment x of y'", async () => {
  const view = await sheet(planDebt());
  assert.match(sheetText(view), /41 payments left after this/);
  assert.doesNotMatch(sheetText(view), /Payment \d+ of \d+|This is the last payment/);
  setLiveQuery(null);
});

test("25 Pay all: no installment line", async () => {
  const view = await sheet(planDebt());
  findButton(view.tree, "Pay all").props.onClick();
  view.rerender();
  assert.doesNotMatch(sheetText(view), /left after this|This is the last payment|Payment \d+ of/);
  setLiveQuery(null);
});

test("25 Pay part: opens its own screen; the sheet shows no line for it", async () => {
  const navigations = [];
  const { CollectPayment } = await loadJsx("src/pos/DebtCollection.jsx");
  setLiveQuery(() => planDebt());
  const view = render({ type: CollectPayment, props: { params: { debtId: "d1" }, onClose() {}, onNavigate(...args) { navigations.push(args); }, onRecordCollection() {} } });
  findButton(view.tree, "Pay part").props.onClick();
  assert.deepEqual(navigations, [["CollectPayPart", { debtId: "d1" }]]);
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../src/pos/DebtCollection.jsx", import.meta.url), "utf8");
  const payPart = source.slice(source.indexOf("export function CollectPayPart"), source.indexOf("export function CollectSplitPayment"));
  assert.doesNotMatch(payPart, /leftAfterThis|lastPayment|installmentProgress/);
  setLiveQuery(null);
});

test("25 the last installment: 'This is the last payment.'", async () => {
  for (const amountPesewas of [2000, 1500]) {
    const view = await sheet(planDebt({ amountPesewas, installmentsRemaining: 1 }));
    assert.match(sheetText(view), /This is the last payment\./, `balance ${amountPesewas}`);
    assert.doesNotMatch(sheetText(view), /left after this/);
  }
  const twoLeft = await sheet(planDebt({ amountPesewas: 2100 }));
  assert.match(sheetText(twoLeft), /1 payment left after this/);
  assert.doesNotMatch(sheetText(twoLeft), /1 payments/);
  setLiveQuery(null);
});

test("25 no plan: no installment line", async () => {
  const view = await sheet(planDebt({ isInstallmentPlan: false, installmentAmount: 0 }));
  assert.doesNotMatch(sheetText(view), /left after this|This is the last payment/);
  setLiveQuery(null);
});

// ---- plan card on the debtor details (43) -------------------------------------------------------------------------

async function detail(debt, planPaidPesewas) {
  const { DebtorDetail } = await loadJsx("src/pos/DebtCollection.jsx");
  const data = { name: "amos", customerId: "c1", phone: "", ghanaCardNumber: "", balancePesewas: debt.amountPesewas, debt, unpaidDebts: [debt], unpaidDebtCount: 1, history: [], planPaidPesewas };
  setLiveQuery(([debtId]) => (debtId === "d1" ? data : undefined));
  const view = render({ type: DebtorDetail, props: { params: { debtId: "d1", customerName: "amos" }, onBack() {}, onNavigate() {}, onCollect() {}, shopName: "My shop" } });
  setLiveQuery(null);
  return view;
}
const progressBar = (tree) => [...walk(tree)].find((node) => node.props?.role === "progressbar");

// Wiring 29/43/54 "Plan card rows" (21 Nov 2026, replaces "Paid so far" "1 of 3", which itself replaced
// "GH₵21.00 paid · 42 payments left"): Paid and Still needed for the current period, Payments left from the
// balance; the bar stays money paid ÷ plan total. Never a count of installments paid (the 11 Nov rule this
// file checked before chunk A, restored).
const planRows = (tree) => Object.fromEntries([...walk(tree)]
  .filter((node) => node.props?.["data-event-detail"] && ["payment", "paid", "still-needed", "payments-left", "next-payment", "was-due"].includes(node.props["data-event-detail"]))
  .map((node) => [node.props["data-event-detail"], textOf(node)]));
const NO_COUNT = /(?<![.\d₵,])\d+ (of|paid)\b|Paid so far/;

test("plan card: amos (GH₵1.00 toward this GH₵20.00 payment) shows Paid, Still needed, Payments left 42 and a bar of about 2.5%", async () => {
  const view = await detail(planDebt({ installmentPaymentCarryPesewas: 100 }), 2100);
  const rows = planRows(view.tree);
  assert.equal(rows.paid, "PaidGH₵1.00");
  assert.equal(rows["still-needed"], "Still neededGH₵19.00");
  assert.equal(rows["payments-left"], "Payments left42");
  assert.doesNotMatch(textOf(view.tree), / · /, "no facts joined with a dot");
  assert.doesNotMatch(textOf(view.tree), NO_COUNT, "no count of payments paid");
  const bar = progressBar(view.tree);
  const width = Number.parseFloat([...walk(bar)].find((node) => node.props?.style?.width)?.props.style.width);
  assert.ok(width > 2.4 && width < 2.5, `bar width ${width}%`);
});

test("plan card: nothing paid, exact multiples and one payment left, from money only", async () => {
  const none = planRows((await detail(planDebt({ amountPesewas: 3000, installmentAmount: 1000 }), 0)).tree);
  assert.deepEqual([none.paid, none["still-needed"], none["payments-left"]], ["PaidGH₵0.00", "Still neededGH₵10.00", "Payments left3"]);
  // Two whole payments made earlier: the carry is 0 again, so this period starts at GH₵0.00 paid.
  const exact = planRows((await detail(planDebt({ amountPesewas: 3000, installmentAmount: 1000, installmentPaymentCarryPesewas: 0 }), 2000)).tree);
  assert.deepEqual([exact.paid, exact["still-needed"], exact["payments-left"]], ["PaidGH₵0.00", "Still neededGH₵10.00", "Payments left3"]);
  // GH₵5.00 left on GH₵10.00 payments: one payment left (rounded up), GH₵5.00 already paid toward it.
  const one = planRows((await detail(planDebt({ amountPesewas: 500, installmentAmount: 1000, installmentPaymentCarryPesewas: 500 }), 2500)).tree);
  assert.deepEqual([one.paid, one["still-needed"], one["payments-left"]], ["PaidGH₵5.00", "Still neededGH₵5.00", "Payments left1"]);
  // A stored counter that drifted is never read.
  const drifted = planRows((await detail(planDebt({ amountPesewas: 3000, installmentAmount: 1000, installmentsRemaining: 40, totalInstallments: 44 }), 0)).tree);
  assert.equal(drifted["payments-left"], "Payments left3");
});