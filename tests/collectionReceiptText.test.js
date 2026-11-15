import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { buildLatestPaymentReceipt, buildPaymentReceipt, getCollectionReceiptText } from "../src/pos/receiptTemplates.js";
import { findButton, flushEffects, loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Wiring 28 and 29/43 "Collection receipt" (decided 15 Nov 2026). Everywhere a collection receipt is
// built (28, 29/43, Copy receipt):
//   Receipt from {Shop} / dd/mm/yyyy HH:mm (no comma) / Received from {Name}: GH₵x (Cash|MoMo) /
//   Balance owed now: GH₵y ("Nothing owed now" when zero) / Thank you!
// 29/43 cover the person's latest payment only, the label says so, and a person who never paid has no
// receipt buttons. With the receipts flag off nothing about receipts shows.

const ON = { VITE_ENABLE_POS_RECEIPTS: "true" };
const AT = new Date(2026, 10, 15, 9, 5).getTime(); // 15/11/2026 09:05 local time

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

// ---- the text -----------------------------------------------------------------------------------------

test("the receipt text: five lines, date and time with no comma, Cash", () => {
  assert.equal(buildPaymentReceipt({ shopName: "Ama's Shop", customerName: "kofi mensah", timestamp: AT, cashPesewas: 3000, remainingPesewas: 5000 }), [
    "Receipt from Ama's Shop",
    "15/11/2026 09:05",
    "Received from Kofi Mensah: GH₵30.00 (Cash)",
    "Balance owed now: GH₵50.00",
    "Thank you!"
  ].join("\n"));
});

test("the receipt text: MoMo, and plain MoMo (no confirmation wording on a customer receipt)", () => {
  const text = buildPaymentReceipt({ shopName: "Shop", customerName: "Ama", timestamp: AT, momoPesewas: 1250, remainingPesewas: 875 });
  assert.match(text, /^Received from Ama: GH₵12\.50 \(MoMo\)$/m);
  assert.doesNotMatch(text, /confirmed/i);
});

test("the receipt text: zero balance reads 'Nothing owed now'", () => {
  const text = buildPaymentReceipt({ shopName: "Shop", customerName: "Ama", timestamp: AT, cashPesewas: 8000, remainingPesewas: 0 });
  assert.equal(text.split("\n")[3], "Nothing owed now");
  assert.doesNotMatch(text, /Balance owed now/);
});

test("28's text (a recorded collection) is the same template", () => {
  const result = { customerName: "Ama", createdAt: AT, amountPesewas: 3000, remainingPesewas: 0, parts: [{ paymentMethod: "cash", amountPesewas: 3000 }], debtAfter: { isInstallmentPlan: true, installmentAmount: 1000, nextDueDate: "2026-11-22" } };
  assert.equal(getCollectionReceiptText(result, "Shop", true), "Receipt from Shop\n15/11/2026 09:05\nReceived from Ama: GH₵30.00 (Cash)\nNothing owed now\nThank you!");
});

test("the latest payment: a grouped collection or a single payment row; none gives no receipt", () => {
  assert.equal(buildLatestPaymentReceipt({ shopName: "Shop", customerName: "Ama", payment: null, balancePesewas: 100 }), null);
  const single = buildLatestPaymentReceipt({ shopName: "Shop", customerName: "Ama", payment: { type: "payment", timestamp: AT, amountPesewas: 3000, method: "MoMo" }, balancePesewas: 100 });
  assert.match(single, /Received from Ama: GH₵30\.00 \(MoMo\)\nBalance owed now: GH₵1\.00/);
});

// ---- 28 ---------------------------------------------------------------------------------------------------

async function show28(env, remainingPesewas = 5000) {
  const { PaymentReceived } = await loadJsx("src/pos/DebtCollection.jsx", env);
  setLiveQuery(() => null);
  const result = {
    collectionId: "col-1", debtId: "d1", customerId: "c1", customerName: "Ama", phone: "",
    amountPesewas: 3000, remainingPesewas, createdAt: AT, undoExpiresAt: Date.now() - 1000,
    parts: [{ paymentMethod: "cash", amountPesewas: 3000 }], debtAfter: { isInstallmentPlan: false }
  };
  const view = render({ type: PaymentReceived, props: { params: result, onHome() {}, onNavigate() {}, onSaveCustomerContact() {}, shopName: "Shop" } });
  flushEffects(view);
  return view;
}

test("28: Send receipt and Copy receipt carry the new text; zero balance says Nothing owed now", async () => {
  const calls = setNavigator();
  const view = await show28(ON);
  await findButton(view.tree, "Send receipt").props.onClick();
  await findButton(view.tree, "Copy receipt").props.onClick();
  const expected = "Receipt from Shop\n15/11/2026 09:05\nReceived from Ama: GH₵30.00 (Cash)\nBalance owed now: GH₵50.00\nThank you!";
  assert.equal(calls.share[0].text, expected);
  assert.equal(calls.copy[0], expected);
  const paidUp = setNavigator();
  await findButton((await show28(ON, 0)).tree, "Copy receipt").props.onClick();
  assert.match(paidUp.copy[0], /\nNothing owed now\n/);
});

test("28 flag off: nothing about receipts", async () => {
  setNavigator();
  assert.doesNotMatch(textOf((await show28({})).tree), /receipt/i);
});

// ---- 29/43 -----------------------------------------------------------------------------------------------

const dayOffset = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const older = { id: "collection-a", type: "payment", timestamp: AT - 86_400_000, amountPesewas: 5000, collectionParts: [{ method: "MoMo", amountPesewas: 5000 }] };
const latest = { id: "collection-b", type: "payment", timestamp: AT, amountPesewas: 3000, collectionParts: [{ method: "Cash", amountPesewas: 3000 }] };
const credit = { id: "credit-1", type: "credit", timestamp: AT - 2 * 86_400_000, amountPesewas: 16000 };

async function showDetail(env, { late = false, history, balancePesewas = 8000 }) {
  const { DebtorDetail } = await loadJsx("src/pos/DebtCollection.jsx", env);
  const debt = { id: "d1", customerId: "c1", customerName: "Ama", amountPesewas: balancePesewas, status: balancePesewas > 0 ? "unpaid" : "paid", isInstallmentPlan: false, dueDate: dayOffset(late ? -3 : 7) };
  const unpaidDebts = balancePesewas > 0 ? [debt] : [];
  const data = { name: "Ama", customerId: "c1", phone: "", ghanaCardNumber: "", balancePesewas, debt, unpaidDebts, unpaidDebtCount: unpaidDebts.length, lastReminderAt: 0, history };
  setLiveQuery(([debtId]) => (debtId === "d1" ? data : undefined));
  try {
    return render({ type: DebtorDetail, props: { params: { debtId: "d1", customerName: "Ama" }, onBack() {}, onNavigate() {}, onCollect() {}, shopName: "Shop" } });
  } finally {
    setLiveQuery(null);
  }
}
const receiptButtons = (view) => [...walk(view.tree)].filter((node) => node.type === "button" && /receipt/i.test(textOf(node)));

for (const late of [false, true]) {
  const screen = late ? "43" : "29";

  test(`${screen}: Receipt and Copy receipt cover the latest payment only, and the label says so`, async () => {
    const calls = setNavigator();
    const view = await showDetail(ON, { late, history: [latest, older, credit] });
    const send = findButton(view.tree, "Receipt for");
    assert.equal(textOf(send).trim(), "Receipt for GH₵30.00 payment");
    await send.props.onClick();
    await findButton(view.tree, "Copy receipt").props.onClick();
    const expected = "Receipt from Shop\n15/11/2026 09:05\nReceived from Ama: GH₵30.00 (Cash)\nBalance owed now: GH₵80.00\nThank you!";
    assert.equal(calls.share[0].text, expected);
    assert.equal(calls.copy[0], expected, "Copy receipt copies the same latest-payment text");
    assert.doesNotMatch(calls.copy[0], /GH₵50\.00|GH₵160\.00/, "not the older payment, not the credit");
  });

  test(`${screen}: a person who has never paid has no receipt buttons`, async () => {
    setNavigator();
    const view = await showDetail(ON, { late, history: [credit] });
    assert.deepEqual(receiptButtons(view), []);
    assert.doesNotMatch(textOf(view.tree), /receipt/i);
  });

  test(`${screen}: paid in full, the receipt says Nothing owed now`, async () => {
    const calls = setNavigator();
    const view = await showDetail(ON, { late, history: [latest, credit], balancePesewas: 0 });
    await findButton(view.tree, "Copy receipt").props.onClick();
    assert.equal(calls.copy[0].split("\n")[3], "Nothing owed now");
  });

  test(`${screen} flag off: nothing about receipts, even after a payment`, async () => {
    setNavigator();
    const view = await showDetail({}, { late, history: [latest, older, credit] });
    assert.deepEqual(receiptButtons(view), []);
    assert.doesNotMatch(textOf(view.tree), /receipt/i);
  });
}
