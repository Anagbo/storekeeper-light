import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { flushEffects, loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Wiring "Receipts offline" on 28, 30, 31 and 29/43 (14 Nov 2026): the quiet offline line sits
// directly under the Send receipt button (8px below it), above Copy receipt. Only offline, never
// online, never with the receipts flag off.
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

const isSend = (node) => node.type === "button" && (/Send receipt/.test(textOf(node)) || /^Send current balance receipt/.test(node.props?.["aria-label"] ?? ""));
const isCopy = (node) => node.type === "button" && textOf(node).includes("Copy receipt");
const isLine = (node) => node.type === "p" && textOf(node) === OFFLINE_LINE;
const contains = (root, predicate) => [...walk(root)].some(predicate);

async function show(screen, env) {
  if (screen === "30") {
    const { default: SaleRecorded } = await loadJsx("src/pos/SaleRecorded.jsx", env);
    const transaction = { id: "s1", amountPesewas: 500, payment_method: "cash", cashReceivedPesewas: 500, momoReceivedPesewas: 0, timestamp: Date.now(), items_json: "[]" };
    const view = render({ type: SaleRecorded, props: { transaction, shopName: "Shop", onDone() {}, onNewSale() {} } });
    flushEffects(view);
    return view;
  }
  if (screen === "28") {
    const { PaymentReceived } = await loadJsx("src/pos/DebtCollection.jsx", env);
    setLiveQuery(() => null);
    const params = {
      collectionId: "col-1", debtId: "d1", customerId: "c1", customerName: "Ama", phone: "0241234567",
      amountPesewas: 1250, remainingPesewas: 875, createdAt: Date.now(), undoExpiresAt: Date.now() - 1000,
      parts: [{ paymentMethod: "cash", amountPesewas: 1250 }], debtAfter: { isInstallmentPlan: false }
    };
    const view = render({ type: PaymentReceived, props: { params, onHome() {}, onNavigate() {}, onSaveCustomerContact() {}, shopName: "Shop" } });
    flushEffects(view);
    return view;
  }
  if (screen === "31") {
    const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx", env);
    setLiveQuery(() => null);
    const params = {
      customer: { id: "c1", name: "Ama", phone: "0241234567" },
      creditResult: {
        customerId: "c1", customerName: "Ama", phone: "0241234567", debtId: "d1", amountPesewas: 2500, addedDebtPesewas: 2500,
        previousDebtPesewas: 0, totalDebtPesewas: 2500, initialPaymentPesewas: 0, initialPaymentParts: [],
        debtAfter: { isInstallmentPlan: false }, saleTransaction: { timestamp: Date.now() }
      }
    };
    const view = render({ type: CreditScreens, props: { route: "CreditSaved", params, onHome() {}, onNavigate() {}, onSaveCustomerContact() {}, shopName: "Shop" } });
    flushEffects(view);
    return view;
  }
  // 29 (due later) and 43 (late)
  const { DebtorDetail } = await loadJsx("src/pos/DebtCollection.jsx", env);
  const debt = { id: "d1", customerId: "c1", customerName: "Ama", amountPesewas: 8000, status: "unpaid", isInstallmentPlan: false, dueDate: screen === "43" ? "2000-01-01" : "2099-01-01" };
  const data = { name: "Ama", customerId: "c1", phone: "+233241234567", ghanaCardNumber: "", balancePesewas: 8000, debt, unpaidDebts: [debt], unpaidDebtCount: 1, history: [] };
  setLiveQuery(([debtId]) => (debtId === "d1" ? data : undefined));
  return render({ type: DebtorDetail, props: { params: { debtId: "d1", customerName: "Ama" }, onBack() {}, onNavigate() {}, onCollect() {}, shopName: "Shop" } });
}

for (const screen of ["28", "29", "43", "30", "31"]) {
  test(`${screen} offline: Send receipt, then the offline line 8px below it, then Copy receipt`, async () => {
    setOnline(false);
    const view = await show(screen, ON);
    const nodes = [...walk(view.tree)];
    const send = nodes.findIndex(isSend);
    const line = nodes.findIndex(isLine);
    const copy = nodes.findIndex(isCopy);
    assert.ok(send >= 0 && line >= 0 && copy >= 0, "all three are shown");
    assert.ok(send < line && line < copy, `order is Send receipt, line, Copy receipt (got ${send}, ${line}, ${copy})`);
    // The smallest box holding Send receipt and the line spaces them 8px apart (gap-2) and does
    // not hold Copy receipt. On 28 and 30 that box is Send receipt's two-button row, so the line
    // spans the row under it; nothing tappable sits between them outside that row.
    const box = nodes.filter((node) => typeof node.type === "string" && contains(node, isSend) && contains(node, isLine)).at(-1);
    assert.match(box.props.className, /(^|\s)gap-2(\s|$)/);
    assert.ok(!contains(box, isCopy), "Copy receipt is below that box");
    const inBox = new Set(walk(box));
    assert.equal(nodes.slice(send + 1, line).filter((node) => (node.type === "button" || node.type === "a") && !inBox.has(node)).length, 0, "nothing tappable between Send receipt and the line");
    const row = box.props.children;
    const lineChild = (Array.isArray(row) ? row : [row]).filter(Boolean).at(-1);
    assert.ok(contains(lineChild, isLine), "the line is the last thing in that box, right under Send receipt's row");
  });

  test(`${screen} online: no offline line`, async () => {
    setOnline(true);
    const view = await show(screen, ON);
    assert.doesNotMatch(textOf(view.tree), /You are offline/);
  });

  test(`${screen} receipts flag off: no offline line even offline`, async () => {
    setOnline(false);
    const view = await show(screen, {});
    assert.doesNotMatch(textOf(view.tree), /You are offline/);
    assert.ok(![...walk(view.tree)].some(isCopy));
  });
}
