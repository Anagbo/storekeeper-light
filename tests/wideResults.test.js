import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { enterMeansNewSale } from "../src/pos/resultKeys.js";
import { flushEffects, loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Wide D11 (wiring "30, 31, 28 results", clarified 23 Nov 2026): each result screen keeps exactly its
// phone buttons (New sale only on 30; 31: See {Name}'s details and Done; 28: Undo, See details and Done).
// Send receipt and Copy receipt sit side by side with the offline line full width directly under the
// pair. On 28 Done is not sticky inside the panel. On 30 Enter means New sale on wide, ignored while a
// button or text field has focus.
const ON = { VITE_ENABLE_POS_RECEIPTS: "true" };
const OFFLINE_LINE = "You are offline. WhatsApp will send it when you are back online.";

const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const realWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  Object.defineProperty(globalThis, "navigator", realNavigator);
  if (realWindow) Object.defineProperty(globalThis, "window", realWindow);
  else delete globalThis.window;
  setLiveQuery(null);
});

function setOnline(onLine) {
  Object.defineProperty(globalThis, "navigator", { value: { onLine, userAgent: "Mozilla/5.0 (Linux; Android 13) Mobile", share: async () => {} }, configurable: true });
  Object.defineProperty(globalThis, "window", { value: new EventTarget(), configurable: true });
}

const nameOf = (button) => (button.props["aria-label"] ?? textOf(button)).replace(/\s+/g, " ").trim();
const buttons = (root) => [...walk(root)].filter((node) => node.type === "button");
const isSend = (node) => node.type === "button" && /Send receipt|^Receipt for .* payment$/.test(textOf(node).trim());
const isCopy = (node) => node.type === "button" && textOf(node).includes("Copy receipt");
const isLine = (node) => node.type === "p" && textOf(node) === OFFLINE_LINE;

async function show(screen, { wide, env = ON, onNewSale = () => {} } = {}) {
  const screens = await loadJsx("tests/helpers/resultScreensEntry.js", env);
  let element;
  if (screen === "30") {
    const transaction = { id: "s1", amountPesewas: 1234500, payment_method: "cash", cashReceivedPesewas: 1234500, momoReceivedPesewas: 0, timestamp: Date.now(), items_json: "[]" };
    element = { type: screens.SaleRecorded, props: { transaction, shopName: "Shop", onDone() {}, onNewSale } };
  } else if (screen === "28") {
    setLiveQuery(() => null);
    const params = {
      collectionId: "col-1", debtId: "d1", customerId: "c1", customerName: "Ama", phone: "0241234567",
      amountPesewas: 1250, remainingPesewas: 875, createdAt: Date.now(), undoExpiresAt: Date.now() - 1000,
      parts: [{ paymentMethod: "cash", amountPesewas: 1250 }], debtAfter: { isInstallmentPlan: false }
    };
    element = { type: screens.PaymentReceived, props: { params, onHome() {}, onNavigate() {}, onSaveCustomerContact() {}, shopName: "Shop" } };
  } else {
    setLiveQuery(() => null);
    const params = {
      customer: { id: "c1", name: "Ama", phone: "0241234567" },
      creditResult: {
        customerId: "c1", customerName: "Ama", phone: "0241234567", debtId: "d1", amountPesewas: 2500, addedDebtPesewas: 2500,
        previousDebtPesewas: 0, totalDebtPesewas: 2500, initialPaymentPesewas: 0, initialPaymentParts: [],
        debtAfter: { isInstallmentPlan: false }, saleTransaction: { timestamp: Date.now() }
      }
    };
    element = { type: screens.CreditScreens, props: { route: "CreditSaved", params, onHome() {}, onNavigate() {}, onSaveCustomerContact() {}, shopName: "Shop" } };
  }
  const view = render(wide ? { type: screens.TaskColumnContext.Provider, props: { value: "sidebar", children: element } } : element);
  flushEffects(view);
  return view;
}

const PHONE_BUTTONS = {
  "30": ["Send receipt", "Copy receipt", "Done", "New sale"],
  "31": ["Send receipt", "Copy receipt", "See Ama’s details", "Done"],
  "28": ["Undo", "Send receipt", "Copy receipt", "See Ama’s details", "Done"]
};

for (const screen of ["30", "31", "28"]) {
  test(`${screen} wide: the phone's buttons only, Send and Copy side by side, the offline line full width under the pair`, async () => {
    setOnline(false);
    const phone = (await show(screen, { wide: false })).tree;
    const phoneNames = buttons(phone).map(nameOf);
    const view = await show(screen, { wide: true });
    const names = buttons(view.tree).map(nameOf);
    assert.deepEqual([...names].sort(), [...phoneNames].sort(), `${screen}: the same buttons as the phone (${names.join(", ")})`);
    for (const label of PHONE_BUTTONS[screen]) assert.ok(names.some((name) => name.includes(label)), `${screen}: ${label}`);
    assert.equal(names.some((name) => /New sale/.test(name)), screen === "30", `${screen}: New sale only on 30`);

    const pair = [...walk(view.tree)].find((node) => node.props?.["data-receipt-pair"] !== undefined);
    assert.ok(pair, `${screen}: the receipt pair`);
    assert.match(pair.props.className, /\bgrid-cols-2\b/);
    const children = (Array.isArray(pair.props.children) ? pair.props.children : [pair.props.children]).filter(Boolean);
    assert.ok(isSend([...walk(children[0])].find(isSend) ?? {}), `${screen}: Send receipt first`);
    assert.ok([...walk(children[1])].some(isCopy), `${screen}: Copy receipt beside it`);
    const line = [...walk(pair)].find(isLine);
    assert.ok(line, `${screen}: the offline line inside the pair`);
    assert.match(line.props.className, /\bcol-span-full\b/);
    assert.match(line.props.className, /text-\[17px\]/);
  });
}

test("30 wide: New sale (main) above Done; the amount is the 56px bold hero", async () => {
  setOnline(true);
  const view = await show("30", { wide: true });
  const names = buttons(view.tree).map(nameOf);
  assert.ok(names.indexOf("New sale") < names.indexOf("Done"), names.join(", "));
  const amount = [...walk(view.tree)].find((node) => node.props?.["data-result-amount"] !== undefined);
  assert.equal(textOf(amount), "GH₵12,345.00");
  assert.match(amount.props.className, /text-\[56px\] font-bold/);
  assert.doesNotMatch(amount.props.className, /extrabold/);
});

test("28 wide: Done sits at the bottom of the panel, not sticky; phone keeps it pinned", async () => {
  setOnline(true);
  const row = (view) => [...walk(view.tree)].find((node) => node.props?.["data-bottom-row"] !== undefined);
  assert.doesNotMatch(row(await show("28", { wide: true })).props.className, /sticky/);
  assert.match(row(await show("28", { wide: false })).props.className, /sticky bottom-0/);
});

test("30: Enter is New sale on wide, not on the phone", async () => {
  setOnline(true);
  let newSales = 0;
  await show("30", { wide: true, onNewSale: () => { newSales += 1; } });
  const enter = () => window.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), { key: "Enter" }));
  enter();
  assert.equal(newSales, 1);
  delete globalThis.window;
  setOnline(true);
  await show("30", { wide: false, onNewSale: () => { newSales += 1; } });
  enter();
  assert.equal(newSales, 1, "no Enter shortcut on the phone");
});

test("Enter is ignored while a button or text field has focus, while a dialog is open, and with a modifier", () => {
  const docWith = (activeTag, { dialog = false } = {}) => {
    const body = { closest: () => null };
    const active = activeTag ? { closest: (selector) => (selector.split(",").map((s) => s.trim()).includes(activeTag) ? {} : null) } : body;
    return { body, activeElement: active, querySelector: () => (dialog ? {} : null) };
  };
  const enter = { key: "Enter" };
  assert.equal(enterMeansNewSale(enter, docWith(null)), true, "nothing focused");
  for (const tag of ["button", "input", "textarea", "select", "a[href]"]) assert.equal(enterMeansNewSale(enter, docWith(tag)), false, tag);
  assert.equal(enterMeansNewSale(enter, docWith(null, { dialog: true })), false, "a dialog is open");
  assert.equal(enterMeansNewSale({ key: "Enter", repeat: true }, docWith(null)), false, "held key");
  assert.equal(enterMeansNewSale({ key: "Enter", ctrlKey: true }, docWith(null)), false, "with a modifier");
  assert.equal(enterMeansNewSale({ key: "a" }, docWith(null)), false, "another key");
});
