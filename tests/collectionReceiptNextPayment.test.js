import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { buildLatestPaymentReceipt, buildPaymentReceipt, getCollectionReceiptText } from "../src/pos/receiptTemplates.js";
import { findButton, flushEffects, loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Collection receipt, Next payment line (15 Nov 2026): when the person has a payment plan, every
// collection receipt (28, 29/43, Copy receipt) keeps "Next payment: GH₵x on dd/mm/yyyy" between the
// balance and "Thank you!". Without a plan the line does not appear. With the receipts flag off
// nothing about receipts shows.

const ON = { VITE_ENABLE_POS_RECEIPTS: "true" };
const AT = new Date(2026, 10, 15, 9, 5).getTime(); // 15/11/2026 09:05 local time
const PLAN = { isInstallmentPlan: true, installmentAmount: 2000, nextDueDate: "2026-11-22" };

const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const realWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  setLiveQuery(null);
  Object.defineProperty(globalThis, "navigator", realNavigator);
  if (realWindow) Object.defineProperty(globalThis, "window", realWindow);
  else delete globalThis.window;
});
function setNavigator() {
  const calls = { share: [], copy: [] };
  Object.defineProperty(globalThis, "navigator", { value: { onLine: true, userAgent: "Mozilla/5.0 (Linux; Android 13) Mobile", share: async (data) => { calls.share.push(data); }, clipboard: { writeText: async (text) => { calls.copy.push(text); } } }, configurable: true });
  const win = new EventTarget();
  win.open = () => {};
  win.location = { set href(_value) {} };
  Object.defineProperty(globalThis, "window", { value: win, configurable: true });
  return calls;
}

const WITH_PLAN = "Receipt from Shop\n15/11/2026 09:05\nReceived from Ama: GH₵30.00 (Cash)\nBalance owed now: GH₵50.00\nNext payment: GH₵20.00 on 22/11/2026\nThank you!";
const NO_PLAN = "Receipt from Shop\n15/11/2026 09:05\nReceived from Ama: GH₵30.00 (Cash)\nBalance owed now: GH₵50.00\nThank you!";

// ---- the text ---------------------------------------------------------------------------------------------

test("the text: with a plan the Next payment line sits after the balance; without a plan it is not there", () => {
  const base = { shopName: "Shop", customerName: "Ama", timestamp: AT, cashPesewas: 3000, remainingPesewas: 5000 };
  assert.equal(buildPaymentReceipt({ ...base, plan: PLAN }), WITH_PLAN);
  assert.equal(buildPaymentReceipt(base), NO_PLAN);
  // Changed 21 Nov 2026 (wiring 28 "Collection receipt: next payment and due date"): a one-time debt
  // with a due date now gets "Due on dd/mm/yyyy"; without a date, still no line.
  assert.equal(buildPaymentReceipt({ ...base, plan: { isInstallmentPlan: false, dueDate: "2026-11-22" } }),
    NO_PLAN.replace("\nThank you!", "\nDue on 22/11/2026\nThank you!"));
  assert.equal(buildPaymentReceipt({ ...base, plan: { isInstallmentPlan: false, dueDate: "" } }), NO_PLAN);
});

test("the text: the next payment is never more than what is owed, and nothing owed gives no line", () => {
  const base = { shopName: "Shop", customerName: "Ama", timestamp: AT, cashPesewas: 3000, plan: PLAN };
  assert.match(buildPaymentReceipt({ ...base, remainingPesewas: 1250 }), /\nNext payment: GH₵12\.50 on 22\/11\/2026\n/);
  assert.doesNotMatch(buildPaymentReceipt({ ...base, remainingPesewas: 0 }), /Next payment/);
});

test("the text: a plan date that cannot be read gives no line, not a broken receipt", () => {
  const text = buildPaymentReceipt({ shopName: "Shop", customerName: "Ama", timestamp: AT, cashPesewas: 3000, remainingPesewas: 5000, plan: { ...PLAN, nextDueDate: "" } });
  assert.equal(text, NO_PLAN);
});

test("28's text and 29/43's latest payment text both carry the line with a plan", () => {
  const result = { customerName: "Ama", createdAt: AT, amountPesewas: 3000, remainingPesewas: 5000, parts: [{ paymentMethod: "cash", amountPesewas: 3000 }], debtAfter: PLAN };
  assert.equal(getCollectionReceiptText(result, "Shop", true), WITH_PLAN);
  assert.equal(getCollectionReceiptText({ ...result, debtAfter: { isInstallmentPlan: false } }, "Shop", true), NO_PLAN);
  const payment = { type: "payment", timestamp: AT, amountPesewas: 3000, method: "Cash" };
  assert.equal(buildLatestPaymentReceipt({ shopName: "Shop", customerName: "Ama", payment, balancePesewas: 5000, plan: PLAN }), WITH_PLAN);
  assert.equal(buildLatestPaymentReceipt({ shopName: "Shop", customerName: "Ama", payment, balancePesewas: 5000 }), NO_PLAN);
});

// ---- 28 ---------------------------------------------------------------------------------------------------

async function show28(env, debtAfter) {
  const { PaymentReceived } = await loadJsx("src/pos/DebtCollection.jsx", env);
  setLiveQuery(() => null);
  const result = {
    collectionId: "col-1", debtId: "d1", customerId: "c1", customerName: "Ama", phone: "",
    amountPesewas: 3000, remainingPesewas: 5000, createdAt: AT, undoExpiresAt: Date.now() - 1000,
    parts: [{ paymentMethod: "cash", amountPesewas: 3000 }], debtAfter
  };
  const view = render({ type: PaymentReceived, props: { params: result, onHome() {}, onNavigate() {}, onSaveCustomerContact() {}, shopName: "Shop" } });
  flushEffects(view);
  return view;
}

test("28 with a plan: Send receipt and Copy receipt carry the Next payment line", async () => {
  const calls = setNavigator();
  const view = await show28(ON, { ...PLAN, status: "unpaid" });
  await findButton(view.tree, "Send receipt").props.onClick();
  await findButton(view.tree, "Copy receipt").props.onClick();
  assert.equal(calls.share[0].text, WITH_PLAN);
  assert.equal(calls.copy[0], WITH_PLAN);
});

// Changed 21 Nov 2026 (item 4j): a one-time debt with a due date gets "Due on"; without a date, no line.
test("28 without a plan: no Next payment line; Due on with a due date", async () => {
  const calls = setNavigator();
  const view = await show28(ON, { isInstallmentPlan: false, dueDate: "2026-11-22" });
  await findButton(view.tree, "Copy receipt").props.onClick();
  assert.equal(calls.copy[0], NO_PLAN.replace("\nThank you!", "\nDue on 22/11/2026\nThank you!"));
  const noDate = await show28(ON, { isInstallmentPlan: false, dueDate: "" });
  await findButton(noDate.tree, "Copy receipt").props.onClick();
  assert.equal(calls.copy[1], NO_PLAN);
});

test("28 flag off, with a plan: nothing about receipts", async () => {
  setNavigator();
  const text = textOf((await show28({}, { ...PLAN, status: "unpaid" })).tree);
  assert.doesNotMatch(text, /receipt/i);
  assert.equal([...walk((await show28({}, PLAN)).tree)].filter((node) => node.type === "button" && /receipt/i.test(textOf(node))).length, 0);
});

// ---- 29/43 -----------------------------------------------------------------------------------------------

const dayOffset = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const latest = { id: "collection-b", type: "payment", timestamp: AT, amountPesewas: 3000, collectionParts: [{ method: "Cash", amountPesewas: 3000 }] };
const credit = { id: "credit-1", type: "credit", timestamp: AT - 2 * 86_400_000, amountPesewas: 8000 };

async function showDetail(env, { late, plan }) {
  const { DebtorDetail } = await loadJsx("src/pos/DebtCollection.jsx", env);
  const due = dayOffset(late ? -3 : 7);
  const debt = plan
    ? { id: "d1", customerId: "c1", customerName: "Ama", amountPesewas: 5000, status: "unpaid", isInstallmentPlan: true, installmentAmount: 2000, frequency: "weekly", installmentsRemaining: 3, nextDueDate: due }
    : { id: "d1", customerId: "c1", customerName: "Ama", amountPesewas: 5000, status: "unpaid", isInstallmentPlan: false, dueDate: due };
  const data = { name: "Ama", customerId: "c1", phone: "", ghanaCardNumber: "", balancePesewas: 5000, debt, planPaidPesewas: 3000, unpaidDebts: [debt], unpaidDebtCount: 1, lastReminderAt: 0, history: [latest, credit] };
  setLiveQuery(([debtId]) => (debtId === "d1" ? data : undefined));
  try {
    return { view: render({ type: DebtorDetail, props: { params: { debtId: "d1", customerName: "Ama" }, onBack() {}, onNavigate() {}, onCollect() {}, shopName: "Shop" } }), due };
  } finally {
    setLiveQuery(null);
  }
}
const ddmmyyyy = (iso) => iso.split("-").reverse().join("/");

for (const late of [false, true]) {
  const screen = late ? "43" : "29";

  test(`${screen} with a plan: Receipt and Copy receipt carry the Next payment line`, async () => {
    const calls = setNavigator();
    const { view, due } = await showDetail(ON, { late, plan: true });
    await findButton(view.tree, "Receipt for").props.onClick();
    await findButton(view.tree, "Copy receipt").props.onClick();
    const expected = NO_PLAN.replace("\nThank you!", `\nNext payment: GH₵20.00 on ${ddmmyyyy(due)}\nThank you!`);
    assert.equal(calls.share[0].text, expected);
    assert.equal(calls.copy[0], expected);
  });

  // Changed 21 Nov 2026 (item 4j): the one-time debt's due date shows as "Due on", late or not.
  test(`${screen} without a plan: no Next payment line, Due on the debt's date`, async () => {
    const calls = setNavigator();
    const { view, due } = await showDetail(ON, { late, plan: false });
    await findButton(view.tree, "Copy receipt").props.onClick();
    assert.equal(calls.copy[0], NO_PLAN.replace("\nThank you!", `\nDue on ${ddmmyyyy(due)}\nThank you!`));
  });

  test(`${screen} flag off, with a plan: nothing about receipts`, async () => {
    setNavigator();
    const { view } = await showDetail({}, { late, plan: true });
    assert.equal([...walk(view.tree)].filter((node) => node.type === "button" && /receipt/i.test(textOf(node))).length, 0);
    assert.doesNotMatch(textOf(view.tree), /receipt/i);
  });
}
