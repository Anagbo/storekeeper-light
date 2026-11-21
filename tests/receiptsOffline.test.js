import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { findButton, flushEffects, loadJsx, render, setLiveQuery, textOf } from "./helpers/renderJsx.js";

// Wiring 28, 30, 31 "Receipts offline": Send receipt uses the share sheet or the WhatsApp app link
// (wa.me only on a desktop browser), Copy receipt copies the exact text, and one quiet line shows
// only while the phone is offline. Done and New sale never wait on any of it.

const ON = { VITE_ENABLE_POS_RECEIPTS: "true" };
const PHONE_UA = "Mozilla/5.0 (Linux; Android 13; Phone) Mobile";
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
const OFFLINE_LINE = "You are offline. WhatsApp will send it when you are back online.";

const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const realWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  Object.defineProperty(globalThis, "navigator", realNavigator);
  if (realWindow) Object.defineProperty(globalThis, "window", realWindow);
  else delete globalThis.window;
  mock.timers.reset();
});

function setNavigator({ share = false, clipboard = false, onLine = true, userAgent = PHONE_UA } = {}) {
  const calls = { share: [], copy: [], open: [], location: "" };
  const nav = { onLine, userAgent };
  if (share) nav.share = async (data) => { calls.share.push(data); };
  if (clipboard) nav.clipboard = { writeText: async (text) => { calls.copy.push(text); } };
  Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true });
  const win = new EventTarget();
  win.open = (...args) => { calls.open.push(args); };
  win.location = { set href(value) { calls.location = value; } };
  Object.defineProperty(globalThis, "window", { value: win, configurable: true });
  return { calls, nav, win };
}

const SALE = {
  id: "sale-1", amountPesewas: 500, payment_method: "cash", cashReceivedPesewas: 500, momoReceivedPesewas: 0,
  timestamp: Date.now(), items_json: "[]"
};

async function show30(done = () => {}) {
  const { default: SaleRecorded } = await loadJsx("src/pos/SaleRecorded.jsx", ON);
  const view = render({ type: SaleRecorded, props: { transaction: SALE, shopName: "Shop", onDone: done, onNewSale() {} } });
  flushEffects(view);
  return view;
}

test("30 phone with a share sheet: Send receipt shares the receipt text, no wa.me", async () => {
  const { calls } = setNavigator({ share: true });
  const view = await show30();
  await findButton(view.tree, "Send receipt").props.onClick();
  assert.equal(calls.share.length, 1);
  assert.match(calls.share[0].text, /^Receipt from Shop/);
  assert.deepEqual(calls.open, []);
  assert.equal(calls.location, "");
});

test("30 phone without a share sheet: opens the whatsapp:// link, not wa.me", async () => {
  const { calls } = setNavigator({ share: false });
  const view = await show30();
  await findButton(view.tree, "Send receipt").props.onClick();
  assert.match(calls.location, /^whatsapp:\/\/send\?text=Receipt%20from%20Shop/);
  assert.deepEqual(calls.open, []);
});

test("30 desktop browser without a share sheet: wa.me is the last fallback", async () => {
  const { calls } = setNavigator({ share: false, userAgent: DESKTOP_UA });
  const view = await show30();
  await findButton(view.tree, "Send receipt").props.onClick();
  assert.equal(calls.location, "");
  assert.equal(calls.open.length, 1);
  assert.match(calls.open[0][0], /^https:\/\/wa\.me\/\?text=Receipt%20from%20Shop/);
});

test("30 closing the share sheet is not an error", async () => {
  const { nav } = setNavigator({ share: false });
  nav.share = async () => { throw Object.assign(new Error("closed"), { name: "AbortError" }); };
  const view = await show30();
  await findButton(view.tree, "Send receipt").props.onClick();
  assert.doesNotMatch(textOf(view.rerender().tree), /could not open/i);
});

test("30 offline line shows only when offline", async () => {
  setNavigator({ share: true, onLine: true });
  assert.doesNotMatch(textOf((await show30()).tree), /You are offline/);
  setNavigator({ share: true, onLine: false });
  assert.ok(textOf((await show30()).tree).includes(OFFLINE_LINE));
});

test("30 the offline line follows the offline and online events without a reload", async () => {
  const { nav, win } = setNavigator({ share: true, onLine: true });
  const view = await show30();
  nav.onLine = false;
  win.dispatchEvent(new Event("offline"));
  assert.ok(textOf(view.rerender().tree).includes(OFFLINE_LINE));
  nav.onLine = true;
  win.dispatchEvent(new Event("online"));
  assert.doesNotMatch(textOf(view.rerender().tree), /You are offline/);
});

test("30 Copy receipt copies the exact receipt text and shows Copied for two seconds", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const { calls } = setNavigator({ share: true, clipboard: true });
  const view = await show30();
  await findButton(view.tree, "Send receipt").props.onClick();
  await findButton(view.tree, "Copy receipt").props.onClick();
  assert.equal(calls.copy.length, 1);
  assert.equal(calls.copy[0], calls.share[0].text, "the copied text is the sent text");
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(findButton(view.rerender().tree, "Copied"));
  mock.timers.tick(1999);
  assert.ok(findButton(view.rerender().tree, "Copied"));
  mock.timers.tick(1);
  assert.ok(findButton(view.rerender().tree, "Copy receipt"));
});

test("30 Done works offline, and New sale is there", async () => {
  setNavigator({ share: true, onLine: false });
  let done = 0;
  const view = await show30(() => { done += 1; });
  findButton(view.tree, "Done").props.onClick();
  assert.equal(done, 1);
  assert.ok(!findButton(view.tree, "Done").props.disabled);
  assert.ok(findButton(view.tree, "New sale"));
});

test("30 the receipt text uses GH₵ for every amount", async () => {
  const { calls } = setNavigator({ share: true });
  const view = await show30();
  await findButton(view.tree, "Send receipt").props.onClick();
  assert.match(calls.share[0].text, /GH₵5\.00/);
  assert.doesNotMatch(calls.share[0].text.replace(/GH₵\d[\d,]*\.\d\d/g, ""), /\d+\.\d\d/, "no bare amount in the text");
});

test("28 Send receipt goes to the app link with the customer's number; Copy copies the same text", async () => {
  const { calls } = setNavigator({ share: false, clipboard: true });
  const { PaymentReceived } = await loadJsx("src/pos/DebtCollection.jsx", ON);
  setLiveQuery(() => null);
  try {
    const result = {
      collectionId: "col-1", debtId: "d1", customerId: "c1", customerName: "Ama", phone: "0241234567",
      amountPesewas: 1250, remainingPesewas: 875, createdAt: Date.now(), undoExpiresAt: Date.now() - 1000,
      parts: [{ paymentMethod: "cash", amountPesewas: 500 }, { paymentMethod: "momo", amountPesewas: 750 }],
      debtAfter: { isInstallmentPlan: false }
    };
    const view = render({ type: PaymentReceived, props: { params: result, onHome() {}, onNavigate() {}, onSaveCustomerContact() {}, shopName: "Shop" } });
    flushEffects(view);
    await findButton(view.tree, "Send receipt").props.onClick();
    assert.match(calls.location, /^whatsapp:\/\/send\?phone=233241234567&text=/);
    await findButton(view.tree, "Copy receipt").props.onClick();
    const sentText = decodeURIComponent(calls.location.split("&text=")[1]);
    assert.equal(calls.copy[0], sentText);
    assert.match(sentText, /GH₵12\.50/);
  } finally {
    setLiveQuery(null);
  }
});

test("31 Send receipt and Copy receipt send and copy the same GH₵ text", async () => {
  const { calls } = setNavigator({ share: true, clipboard: true });
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx", ON);
  setLiveQuery(() => null);
  try {
    const params = {
      customer: { id: "c1", name: "Ama", phone: "" },
      creditResult: {
        customerId: "c1", customerName: "Ama", phone: "", debtId: "d1", amountPesewas: 2500, addedDebtPesewas: 2500,
        previousDebtPesewas: 0, totalDebtPesewas: 2500, initialPaymentPesewas: 0, initialPaymentParts: [],
        debtAfter: { isInstallmentPlan: false }, saleTransaction: { timestamp: Date.now() }
      }
    };
    const view = render({ type: CreditScreens, props: { route: "CreditSaved", params, onHome() {}, onNavigate() {}, onSaveCustomerContact() {}, shopName: "Shop" } });
    flushEffects(view);
    await findButton(view.tree, "Send receipt").props.onClick();
    await findButton(view.tree, "Copy receipt").props.onClick();
    assert.equal(calls.copy[0], calls.share[0].text);
    assert.match(calls.share[0].text, /GH₵25\.00/);
  } finally {
    setLiveQuery(null);
  }
});

test("28 without a phone: Send receipt opens the share sheet; Copy copies the same text", async () => {
  const { calls } = setNavigator({ share: true, clipboard: true });
  const { PaymentReceived } = await loadJsx("src/pos/DebtCollection.jsx", ON);
  setLiveQuery(() => null);
  try {
    const result = {
      collectionId: "col-1", debtId: "d1", customerId: "c1", customerName: "Ama", phone: "",
      amountPesewas: 1250, remainingPesewas: 875, createdAt: Date.now(), undoExpiresAt: Date.now() - 1000,
      parts: [{ paymentMethod: "cash", amountPesewas: 1250 }],
      debtAfter: { isInstallmentPlan: false }
    };
    const view = render({ type: PaymentReceived, props: { params: result, onHome() {}, onNavigate() {}, onSaveCustomerContact() {}, shopName: "Shop" } });
    flushEffects(view);
    const send = findButton(view.tree, "Send receipt");
    assert.ok(!send.props.disabled, "enabled without a phone once Undo has passed");
    await send.props.onClick();
    await findButton(view.tree, "Copy receipt").props.onClick();
    assert.equal(calls.share.length, 1);
    assert.equal(calls.location, "");
    assert.deepEqual(calls.open, []);
    assert.equal(calls.copy[0], calls.share[0].text);
    assert.match(calls.share[0].text, /GH₵12\.50/);
  } finally {
    setLiveQuery(null);
  }
});

// 29 (on time) and 43 (late): the latest-payment receipt uses the same logic as 28, 30 and 31.
async function showDetail(env = ON, due = "2099-01-01", phone = "+233241234567") {
  const { DebtorDetail } = await loadJsx("src/pos/DebtCollection.jsx", env);
  const debt = { id: "d1", customerId: "c1", customerName: "Ama", amountPesewas: 8000, status: "unpaid", isInstallmentPlan: false, dueDate: due };
  const payment = { id: "collection-c1", type: "payment", timestamp: Date.now() - 3_600_000, amountPesewas: 3000, collectionParts: [{ method: "Cash", amountPesewas: 3000 }] }; // 29/43 receipts cover the latest payment (15 Nov 2026)
  const data = { name: "Ama", customerId: "c1", phone, ghanaCardNumber: "", balancePesewas: 8000, debt, unpaidDebts: [debt], unpaidDebtCount: 1, history: [payment] };
  setLiveQuery(([debtId]) => (debtId === "d1" ? data : undefined));
  try {
    const view = render({ type: DebtorDetail, props: { params: { debtId: "d1", customerName: "Ama" }, onBack() {}, onNavigate() {}, onCollect() {}, shopName: "Shop" } });
    return view;
  } finally {
    setLiveQuery(null);
  }
}

for (const [screen, due] of [["29", "2099-01-01"], ["43", "2000-01-01"]]) {
  test(`${screen} Receipt sends the latest payment receipt through the shared logic and Copy receipt copies the same GH₵ text`, async () => {
    const { calls } = setNavigator({ share: true, clipboard: true });
    const view = await showDetail(ON, due);
    await findButton(view.tree, "Receipt for").props.onClick();
    await findButton(view.tree, "Copy receipt").props.onClick();
    // The customer has a saved number: the app link opens to that number, the share sheet is not used.
    assert.deepEqual(calls.share, []);
    assert.match(calls.location, /^whatsapp:\/\/send\?phone=233241234567&text=/);
    const sentText = decodeURIComponent(calls.location.split("&text=")[1]);
    assert.equal(calls.copy[0], sentText);
    assert.match(sentText, /GH₵80\.00/);
    assert.deepEqual(calls.open, []);
  });

  test(`${screen} without a phone: Receipt opens the share sheet and Copy receipt copies the same GH₵ text`, async () => {
    const { calls } = setNavigator({ share: true, clipboard: true });
    const view = await showDetail(ON, due, "");
    await findButton(view.tree, "Receipt for").props.onClick();
    await findButton(view.tree, "Copy receipt").props.onClick();
    assert.equal(calls.share.length, 1);
    assert.equal(calls.location, "");
    assert.deepEqual(calls.open, []);
    assert.equal(calls.copy[0], calls.share[0].text);
    assert.match(calls.share[0].text, /GH₵80\.00/);
  });

  test(`${screen} without a phone: the offline line shows when offline`, async () => {
    setNavigator({ share: true, onLine: false });
    assert.ok(textOf((await showDetail(ON, due, "")).tree).includes(OFFLINE_LINE));
  });

  test(`${screen} the offline line shows only when offline, and Collect still works`, async () => {
    setNavigator({ share: true, onLine: true });
    assert.doesNotMatch(textOf((await showDetail(ON, due)).tree), /You are offline/);
    setNavigator({ share: true, onLine: false });
    const view = await showDetail(ON, due);
    assert.ok(textOf(view.tree).includes(OFFLINE_LINE));
    assert.ok(!findButton(view.tree, "Collect").props.disabled);
  });

  test(`${screen} flag off: no Receipt, no Copy receipt, no offline line`, async () => {
    setNavigator({ share: true, onLine: false });
    const text = textOf((await showDetail({}, due)).tree);
    assert.doesNotMatch(text, /receipt/i);
    assert.doesNotMatch(text, /You are offline/);
  });
}

// Recipient order for 28, 29/43, 30 and 31.
const sendWith = async (opts, args) => {
  const { calls } = setNavigator(opts);
  const { sendReceipt } = await loadJsx("src/pos/receiptShare.js");
  const result = await sendReceipt({ text: "Hi & bye", ...args });
  return { calls, result };
};

test("recipient: a saved number on a phone opens whatsapp://send?phone=, even with a share sheet", async () => {
  const { calls, result } = await sendWith({ share: true }, { phone: "+233241234567" });
  assert.equal(result, "app");
  assert.equal(calls.location, "whatsapp://send?phone=233241234567&text=Hi%20%26%20bye");
  assert.deepEqual(calls.share, []);
});

test("recipient: a saved number on a desktop browser opens wa.me with the number", async () => {
  const { calls, result } = await sendWith({ share: true, userAgent: DESKTOP_UA }, { phone: "+233241234567" });
  assert.equal(result, "web");
  assert.equal(calls.open[0][0], "https://wa.me/233241234567?text=Hi%20%26%20bye");
  assert.deepEqual(calls.share, []);
});

test("recipient: no number uses the share sheet; closing it is not an error", async () => {
  const shared = await sendWith({ share: true }, { phone: "" });
  assert.equal(shared.result, "share");
  assert.deepEqual(shared.calls.share, [{ text: "Hi & bye" }]);
  const { nav } = setNavigator({ share: false });
  nav.share = async () => { throw Object.assign(new Error("closed"), { name: "AbortError" }); };
  const { sendReceipt } = await loadJsx("src/pos/receiptShare.js");
  assert.equal(await sendReceipt({ text: "x", phone: "" }), "cancelled");
});

test("recipient: no number and no share sheet falls back to the link without a number", async () => {
  const phoneFallback = await sendWith({ share: false }, { phone: "" });
  assert.equal(phoneFallback.calls.location, "whatsapp://send?text=Hi%20%26%20bye");
  const desktop = await sendWith({ share: false, userAgent: DESKTOP_UA }, { phone: "" });
  assert.equal(desktop.calls.open[0][0], "https://wa.me/?text=Hi%20%26%20bye");
});

test("recipient: an invalid number is treated as no number", async () => {
  const { calls, result } = await sendWith({ share: true }, { phone: "abc" });
  assert.equal(result, "share");
  assert.equal(calls.location, "");
});

test("30 a sale with a part owed to a customer with a saved number goes to that number", async () => {
  const { calls } = setNavigator({ share: true });
  const { default: SaleRecorded } = await loadJsx("src/pos/SaleRecorded.jsx", ON);
  const transaction = { ...SALE, amountPesewas: 800, cashReceivedPesewas: 300, momoReceivedPesewas: 0, creditExtendedPesewas: 500, customer_name: "Ama" };
  const view = render({ type: SaleRecorded, props: { transaction, creditResult: { phone: "0241234567", previousDebtPesewas: 0, totalDebtPesewas: 500 }, shopName: "Shop", onDone() {}, onNewSale() {} } });
  flushEffects(view);
  await findButton(view.tree, "Send receipt").props.onClick();
  assert.match(calls.location, /^whatsapp:\/\/send\?phone=233241234567&text=/);
  assert.deepEqual(calls.share, []);
});

test("31 with a saved number goes to that number; without one, the share sheet", async () => {
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx", ON);
  setLiveQuery(() => null);
  try {
    for (const [phone, viaShare] of [["0241234567", false], ["", true]]) {
      const { calls } = setNavigator({ share: true });
      const params = {
        customer: { id: "c1", name: "Ama", phone },
        creditResult: {
          customerId: "c1", customerName: "Ama", phone, debtId: "d1", amountPesewas: 2500, addedDebtPesewas: 2500,
          previousDebtPesewas: 0, totalDebtPesewas: 2500, initialPaymentPesewas: 0, initialPaymentParts: [],
          debtAfter: { isInstallmentPlan: false }, saleTransaction: { timestamp: Date.now() }
        }
      };
      const view = render({ type: CreditScreens, props: { route: "CreditSaved", params, onHome() {}, onNavigate() {}, onSaveCustomerContact() {}, shopName: "Shop" } });
      flushEffects(view);
      await findButton(view.tree, "Send receipt").props.onClick();
      assert.equal(calls.share.length, viaShare ? 1 : 0);
      assert.equal(calls.location.startsWith("whatsapp://send?phone=233241234567&text="), !viaShare);
    }
  } finally {
    setLiveQuery(null);
  }
});

// 4g (21 Nov 2026): offline, Send receipt for a person WITH a valid number uses the share sheet (the
// direct whatsapp://send?phone= link stops at WhatsApp's "No internet connection"), on 28, 30 and 31.
test("28, 30 and 31 offline with a saved number: Send receipt opens the share sheet, not the direct link", async () => {
  const { PaymentReceived } = await loadJsx("src/pos/DebtCollection.jsx", ON);
  const { default: SaleRecorded } = await loadJsx("src/pos/SaleRecorded.jsx", ON);
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx", ON);
  const creditResult = {
    customerId: "c1", customerName: "Ama", phone: "0241234567", debtId: "d1", amountPesewas: 2500, addedDebtPesewas: 2500,
    previousDebtPesewas: 0, totalDebtPesewas: 2500, initialPaymentPesewas: 0, initialPaymentParts: [],
    debtAfter: { isInstallmentPlan: false }, saleTransaction: { timestamp: Date.now() }
  };
  const screens = {
    28: { type: PaymentReceived, props: { params: { collectionId: "col-1", debtId: "d1", customerId: "c1", customerName: "Ama", phone: "0241234567", amountPesewas: 1250, remainingPesewas: 875, createdAt: Date.now(), undoExpiresAt: Date.now() - 1000, parts: [{ paymentMethod: "cash", amountPesewas: 1250 }], debtAfter: { isInstallmentPlan: false } }, onHome() {}, onNavigate() {}, onSaveCustomerContact() {}, shopName: "Shop" } },
    30: { type: SaleRecorded, props: { transaction: { ...SALE, amountPesewas: 800, cashReceivedPesewas: 300, creditExtendedPesewas: 500, customer_name: "Ama" }, creditResult: { phone: "0241234567", previousDebtPesewas: 0, totalDebtPesewas: 500 }, shopName: "Shop", onDone() {}, onNewSale() {} } },
    31: { type: CreditScreens, props: { route: "CreditSaved", params: { customer: { id: "c1", name: "Ama", phone: "0241234567" }, creditResult }, onHome() {}, onNavigate() {}, onSaveCustomerContact() {}, shopName: "Shop" } }
  };
  setLiveQuery(() => null);
  try {
    for (const [screen, element] of Object.entries(screens)) {
      const { calls } = setNavigator({ share: true, onLine: false });
      const view = render(element);
      flushEffects(view);
      assert.ok(textOf(view.tree).includes(OFFLINE_LINE), `${screen}: the offline line`);
      await findButton(view.tree, "Send receipt").props.onClick();
      assert.equal(calls.share.length, 1, `${screen}: the share sheet`);
      assert.match(calls.share[0].text, /GH₵/, screen);
      assert.equal(calls.location, "", `${screen}: no whatsapp://send?phone= offline`);
      assert.deepEqual(calls.open, [], `${screen}: no wa.me`);
    }
  } finally {
    setLiveQuery(null);
  }
});

// 28: "+ Add phone" (the add look since 17 Nov 2026, open_text_sweep) with a quiet line under it; only
// with the receipts flag on and no phone.
async function show28(env, phone) {
  const { PaymentReceived } = await loadJsx("src/pos/DebtCollection.jsx", env);
  setLiveQuery(() => null);
  try {
    const result = {
      collectionId: "col-1", debtId: "d1", customerId: "c1", customerName: "Ama", phone,
      amountPesewas: 1250, remainingPesewas: 875, createdAt: Date.now(), undoExpiresAt: Date.now() - 1000,
      parts: [{ paymentMethod: "cash", amountPesewas: 1250 }],
      debtAfter: { isInstallmentPlan: false }
    };
    const view = render({ type: PaymentReceived, props: { params: result, onHome() {}, onNavigate() {}, onSaveCustomerContact() {}, shopName: "Shop" } });
    flushEffects(view);
    return view;
  } finally {
    setLiveQuery(null);
  }
}

test("28 without a phone and receipts on: \"+ Add phone\" (add look) with the quiet line under it", async () => {
  const view = await show28(ON, "");
  const button = findButton(view.tree, "Add phone");
  assert.ok(button, "the add button");
  assert.equal(button.props["data-look"], "add");
  assert.equal(textOf(button), "+ Add phone");
  assert.doesNotMatch(textOf(view.tree), /Add a phone number/);
  assert.match(textOf(view.tree), /\+ Add phone\s*Next time the receipt opens their WhatsApp chat\./);
});

test("28 with a phone, or with the receipts flag off: no link and no quiet line", async () => {
  for (const view of [await show28(ON, "+233241234567"), await show28({}, "")]) {
    assert.doesNotMatch(textOf(view.tree), /Add phone|Next time the receipt opens/);
  }
});
