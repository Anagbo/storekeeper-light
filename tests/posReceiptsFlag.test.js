import assert from "node:assert/strict";
import { test } from "node:test";
import { findButton, loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// One flag for every POS receipt button: VITE_ENABLE_POS_RECEIPTS (FEATURE_FLAGS.SHOW_POS_RECEIPTS).
// Off hides every receipt control (30, 31, 28, 29/43); on shows every one of them.
// Each screen is compiled twice, once per flag value, through import.meta.env.

const OFF = {};
const ON = { VITE_ENABLE_POS_RECEIPTS: "true" };
const PHONE = "0241234567";

// Every link or button whose label or accessible name speaks of a receipt.
function receiptControls(tree) {
  return [...walk(tree)].filter((node) => (
    (node.type === "a" || node.type === "button" || (typeof node.type === "function" && /Button$/.test(node.type.name)))
    && /receipt/i.test(`${textOf(node)} ${node.props?.["aria-label"] ?? ""}`)
  ));
}

function assertFlag(tree, on, screen) {
  const controls = receiptControls(tree);
  if (on) assert.ok(controls.length > 0, `${screen}: a receipt button with the flag on`);
  else {
    assert.deepEqual(controls.map(textOf), [], `${screen}: no receipt button with the flag off`);
    assert.doesNotMatch(textOf(tree), /receipt/i, `${screen}: no receipt wording with the flag off`);
  }
}

// 30 Sale recorded
const SALE = {
  id: "sale-1", amountPesewas: 800, payment_method: "cash", cashReceivedPesewas: 800, momoReceivedPesewas: 0,
  timestamp: Date.now(), items_json: "[]"
};

async function show30(env) {
  const { default: SaleRecorded } = await loadJsx("src/pos/SaleRecorded.jsx", env);
  return render({ type: SaleRecorded, props: { transaction: SALE, shopName: "Shop", onDone() {}, onNewSale() {} } }).tree;
}

test("30 flag off: no Send receipt", async () => assertFlag(await show30(OFF), false, "30"));
test("30 flag on: Send receipt and Copy receipt", async () => {
  const tree = await show30(ON);
  assertFlag(tree, true, "30");
  assert.ok(findButton(tree, "Send receipt"));
  assert.ok(findButton(tree, "Copy receipt"));
});

// 31 Saved as credit
function creditParams(phone) {
  return {
    customer: { id: "c1", name: "Ama", phone },
    creditResult: {
      customerId: "c1", customerName: "Ama", phone, debtId: "d1",
      amountPesewas: 2500, addedDebtPesewas: 2500, previousDebtPesewas: 0, totalDebtPesewas: 2500,
      initialPaymentPesewas: 0, initialPaymentParts: [],
      debtAfter: { isInstallmentPlan: false },
      saleTransaction: { timestamp: Date.now() }
    }
  };
}

async function show31(env, phone) {
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx", env);
  setLiveQuery(() => null);
  try {
    return render({ type: CreditScreens, props: { route: "CreditSaved", params: creditParams(phone), onHome() {}, onNavigate() {}, onSaveCustomerContact() {}, shopName: "Shop" } }).tree;
  } finally {
    setLiveQuery(null);
  }
}

for (const [label, phone] of [["with a phone", PHONE], ["without a phone", ""]]) {
  test(`31 flag off ${label}: no Send receipt`, async () => assertFlag(await show31(OFF, phone), false, "31"));
  test(`31 flag on ${label}: Send receipt`, async () => assertFlag(await show31(ON, phone), true, "31"));
}

// 28 Payment received
function collectionParams(phone, undoExpiresAt = Date.now() - 1000) {
  return {
    collectionId: "col-1", debtId: "d1", customerId: "c1", customerName: "Ama", phone,
    amountPesewas: 1250, remainingPesewas: 875, createdAt: Date.now(), undoExpiresAt,
    parts: [{ paymentMethod: "cash", amountPesewas: 500 }, { paymentMethod: "momo", amountPesewas: 750 }],
    debtAfter: { isInstallmentPlan: false }
  };
}

async function show28(env, phone, undoExpiresAt) {
  const { PaymentReceived } = await loadJsx("src/pos/DebtCollection.jsx", env);
  setLiveQuery(() => null);
  try {
    return render({ type: PaymentReceived, props: { params: collectionParams(phone, undoExpiresAt), onHome() {}, onNavigate() {}, onSaveCustomerContact() {}, shopName: "Shop" } }).tree;
  } finally {
    setLiveQuery(null);
  }
}

for (const [label, phone] of [["with a phone", PHONE], ["without a phone", ""]]) {
  test(`28 flag off ${label}: no Send receipt, no receipt prompt`, async () => assertFlag(await show28(OFF, phone), false, "28"));
  test(`28 flag on ${label}: Send receipt`, async () => assertFlag(await show28(ON, phone), true, "28"));
}

test("28 flag on with a phone: Send receipt is a button, enabled once Undo has passed", async () => {
  const send = findButton(await show28(ON, PHONE), "Send receipt");
  assert.equal(send.type, "button");
  assert.ok(!send.props.disabled);
});

test("28 flag on without a phone: Send receipt and Copy receipt are enabled once Undo has passed", async () => {
  const tree = await show28(ON, "");
  assert.ok(!findButton(tree, "Send receipt").props.disabled, "no phone: the share sheet is used");
  assert.ok(!findButton(tree, "Copy receipt").props.disabled);
});

for (const [label, phone] of [["with a phone", PHONE], ["without a phone", ""]]) {
  test(`28 flag on ${label}: Send receipt and Copy receipt are disabled during the Undo window`, async () => {
    const tree = await show28(ON, phone, Date.now() + 60_000);
    assert.ok(findButton(tree, "Send receipt").props.disabled);
    assert.ok(findButton(tree, "Copy receipt").props.disabled);
    assert.match(textOf(tree), /Share becomes available in/);
  });
}

// 29 (on time) and 43 (late) Debtor detail: the current-balance Receipt button
function debtorData(dueDate, phone = "+233241234567") {
  const debt = { id: "d1", customerId: "c1", customerName: "Ama", amountPesewas: 8000, status: "unpaid", isInstallmentPlan: false, dueDate };
  return { name: "Ama", customerId: "c1", phone, ghanaCardNumber: "", balancePesewas: 8000, debt, unpaidDebts: [debt], unpaidDebtCount: 1, history: [] };
}

async function showDetail(env, dueDate, phone) {
  const { DebtorDetail } = await loadJsx("src/pos/DebtCollection.jsx", env);
  const data = debtorData(dueDate, phone);
  setLiveQuery(([debtId]) => (debtId === "d1" ? data : undefined));
  try {
    return render({ type: DebtorDetail, props: { params: { debtId: "d1", customerName: "Ama" }, onBack() {}, onNavigate() {}, onCollect() {}, shopName: "Shop" } }).tree;
  } finally {
    setLiveQuery(null);
  }
}

const dayOffset = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

for (const [screen, dueDate] of [["29", dayOffset(7)], ["43", dayOffset(-3)]]) {
  test(`${screen} flag off: no Receipt button; Collect, WhatsApp and Call stay`, async () => {
    const tree = await showDetail(OFF, dueDate);
    assertFlag(tree, false, screen);
    const text = textOf(tree);
    assert.match(text, /Collect/);
    assert.ok([...walk(tree)].some((node) => node.type === "a" && String(node.props.href).startsWith("https://wa.me/233241234567?text=Hello")), "the WhatsApp reminder stays");
    assert.ok([...walk(tree)].some((node) => node.type === "a" && String(node.props.href).startsWith("tel:")), "Call stays");
  });
  test(`${screen} flag on: Receipt button with the current balance`, async () => {
    const tree = await showDetail(ON, dueDate);
    assertFlag(tree, true, screen);
    const send = findButton(tree, "Receipt");
    assert.equal(send.type, "button", "no raw link");
    assert.match(send.props["aria-label"], /Send current balance receipt for Ama/);
    assert.ok(findButton(tree, "Copy receipt"));
  });
  test(`${screen} flag on without a phone: Receipt and Copy receipt still show; no WhatsApp reminder, no Call`, async () => {
    const tree = await showDetail(ON, dueDate, "");
    const send = findButton(tree, "Receipt");
    assert.equal(send.type, "button");
    assert.match(send.props["aria-label"], /Send current balance receipt for Ama/);
    assert.ok(findButton(tree, "Copy receipt"));
    assert.ok(findButton(tree, "Add contact"), "Add contact stays");
    assert.ok(![...walk(tree)].some((node) => node.type === "a" && /^(tel:|https:\/\/wa\.me)/.test(String(node.props.href))));
  });
  test(`${screen} flag off without a phone: no receipt control`, async () => {
    assertFlag(await showDetail(OFF, dueDate, ""), false, screen);
  });
}
