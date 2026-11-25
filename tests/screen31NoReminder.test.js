import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { flushEffects, loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Wiring 31 "No reminder button on 31" (14 Nov 2026): the WhatsApp {Name} reminder button is gone
// (and with it Add contact and Edit contact, decided by the owner the same day). Top to bottom:
// Send receipt, the offline line (offline only), Copy receipt (these three only with the receipts
// flag on), See {Name}'s details, Done.
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

async function show31(env, phone) {
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx", env);
  setLiveQuery(() => null);
  const params = {
    customer: { id: "c1", name: "ama", phone },
    creditResult: {
      customerId: "c1", customerName: "ama", phone, debtId: "d1", amountPesewas: 2500, addedDebtPesewas: 2500,
      previousDebtPesewas: 0, totalDebtPesewas: 2500, initialPaymentPesewas: 0, initialPaymentParts: [],
      debtAfter: { isInstallmentPlan: false }, saleTransaction: { timestamp: Date.now() }
    }
  };
  const view = render({ type: CreditScreens, props: { route: "CreditSaved", params, onHome() {}, onNavigate() {}, onSaveCustomerContact() {}, shopName: "Shop" } });
  flushEffects(view);
  return view;
}

// What a person sees from top to bottom: each button or link, and the offline line.
function sequence(view) {
  return [...walk(view.tree)]
    .filter((node) => node.type === "button" || node.type === "a" || (node.type === "p" && textOf(node) === OFFLINE_LINE))
    .map((node) => (node.type === "p" ? "line" : textOf(node).trim()));
}

// saved_credit_layout (25 Nov 2026): without a phone, Send receipt (a WhatsApp button) is replaced by the
// dashed "+ Add phone number to send WhatsApp", and its offline line goes with it.
const ADD_PHONE = "+ Add phone number to send WhatsApp";
for (const phone of ["0241234567", ""]) {
  const which = phone ? "with a phone" : "without a phone";

  test(`31 ${which}, receipts on, offline: Send receipt (or Add phone), line, Copy receipt, See Ama's details, Done`, async () => {
    setOnline(false);
    assert.deepEqual(sequence(await show31(ON, phone)), phone ? ["Send receipt", "line", "Copy receipt", "See Ama’s details", "Done"] : [ADD_PHONE, "Copy receipt", "See Ama’s details", "Done"]);
  });

  test(`31 ${which}, receipts on, online: no offline line`, async () => {
    setOnline(true);
    assert.deepEqual(sequence(await show31(ON, phone)), [phone ? "Send receipt" : ADD_PHONE, "Copy receipt", "See Ama’s details", "Done"]);
  });

  test(`31 ${which}, receipts off: See Ama's details and Done only`, async () => {
    setOnline(false);
    assert.deepEqual(sequence(await show31({}, phone)), ["See Ama’s details", "Done"]);
  });

  test(`31 ${which}: no WhatsApp reminder, no wa.me link, no Add or Edit contact`, async () => {
    setOnline(true);
    const view = await show31(ON, phone);
    const text = textOf(view.tree);
    assert.doesNotMatch(text, /WhatsApp Ama|Add contact|Edit contact/);
    assert.ok(![...walk(view.tree)].some((node) => node.type === "a" && /wa\.me/.test(String(node.props.href))));
  });
}
