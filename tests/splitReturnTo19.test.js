import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordManualDebt } from "../src/db/debtLedger.js";
import { recordCreditSale } from "../src/db/debts.js";
import { setPreference } from "../src/db/preferences.js";
import { posText } from "../src/pos/i18n.js";
import { backRoute, popToRoute, pushRoute, replaceRoute, returnFromMomoPickState } from "../src/pos/routes.js";
import { addDueCycles, localDateString } from "../src/utils/installments.js";
import { flushEffects, findButton, loadJsx, render, textOf, walk } from "./helpers/renderJsx.js";
import { waitFor } from "./helpers/waitFor.js";

// 19 -> 27 (Split payment) -> back to 19. The payment taken on 27 is today's payment on 19: it is
// not "already paid before 19", so Owed and Maximum stay the full balance, Today stays selected,
// and Save plan records the payment once. Picking Next cycle afterwards discards the recorded
// parts. Driven with the real screens (34, 18, 19, 27, 61, 62) and the history helpers PosApp uses;
// PosApp itself is not rendered.
after(async () => {
  db.close();
  await db.delete();
});
beforeEach(async () => {
  for (const table of [db.debts, db.customers, db.transactions, db.payments, db.settings]) await table.clear();
});

const TODAY = localDateString();
// Each wait below is for the thing the test needs (a screen, a saved record, a message), not for a fixed time.
const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx");
const { default: InstallmentSplitPayment } = await loadJsx("src/pos/InstallmentSplitPayment.jsx");
const { MoMoChoice, MoMoDirect } = await loadJsx("src/pos/MoMoScreens.jsx");

async function posSave(details) {
  return recordCreditSale({
    amountPesewas: details.amountPesewas, name: details.customer?.name ?? "", phone: details.customer?.phone ?? "",
    ghanaCardNumber: details.customer?.ghanaCardNumber ?? "", dueDate: details.dueDate ?? "", installmentPlan: details.installmentPlan ?? null,
    initialPaymentPesewas: details.initialPaymentPesewas ?? 0, initialPaymentParts: details.initialPaymentParts ?? null,
    paymentMethod: details.paymentMethod ?? "cash", note: "Sale", saleItems: [], attemptId: details.attemptId
  });
}

// A small stand-in for PosApp's navigation: the same route helpers, the real screens.
function app() {
  let state = { current: "Sell", params: {}, history: [] };
  let mounted = null;
  const api = {
    get state() { return state; },
    get tree() { return mounted.view.tree; },
    saved: null,
    saveError: null,
    navigate(route, params = {}) { state = pushRoute(state, route, params); remount(); },
    replace(route, params = {}) { state = replaceRoute(state, route, params); remount(); },
    update(params) { state = replaceRoute(state, state.current, { ...state.params, ...params }); api.rerender(); },
    returnTo(route, params = {}, predicate) { state = popToRoute(state, route, params, predicate) ?? pushRoute(state, route, params); remount(); },
    back() { state = backRoute(state); remount(); },
    pick(details) { state = returnFromMomoPickState(state, details); remount(); },
    rerender() { mounted.el.props = propsFor(); mounted.view.rerender(); },
    start(route, params) { state = { current: route, params, history: [{ current: "Sell", params: {} }] }; remount(); },
    flush() { flushEffects(mounted.view); },
  };
  function propsFor() {
    const common = { params: state.params, onBack: api.back, onNavigate: api.navigate, onUpdateParams: api.update };
    if (state.current === "SplitPayment") return { ...common, onReturnTo: api.returnTo };
    if (state.current === "MoMoChoice") return { ...common, onReplace: api.replace };
    if (state.current === "MoMoDirect") return { ...common, onConfirm: (details) => api.pick({ ...details, momoMethod: "direct", verification: "merchant_confirmed" }), onPick: (details) => api.pick(details) };
    return {
      ...common, route: state.current, onReturnToSplit() {},
      onSaveCredit: async (details) => {
        try { api.saved = await posSave(details); } catch (error) { api.saveError = error; throw error; }
      }
    };
  }
  function remount() {
    const type = state.current === "SplitPayment" ? InstallmentSplitPayment : state.current === "MoMoChoice" ? MoMoChoice : state.current === "MoMoDirect" ? MoMoDirect : CreditScreens;
    const el = { type, props: propsFor() };
    mounted = { el, view: render(el) };
    flushEffects(mounted.view);
  }
  return api;
}

const input = (tree, predicate) => [...walk(tree)].find((node) => node.type === "input" && predicate(node.props));
const button = (tree, predicate) => [...walk(tree)].find((node) => (node.type === "button" || (typeof node.type === "function" && /Button$/.test(node.type.name))) && predicate(node.props, textOf(node)));
const alerts = (tree) => [...walk(tree)].filter((node) => node.props?.role === "alert").map(textOf);
const cedis = (pesewas) => (pesewas / 100).toFixed(2);

function screen19(a) {
  const tree = a.tree;
  const owed = [...walk(tree)].find((node) => typeof node.type === "function" && node.type.name === "CreditAmount");
  const today = button(tree, (_props, text) => text === "Today");
  const next = button(tree, (_props, text) => /^Next cycle/.test(text));
  const save = findButton(tree, "Save plan");
  return {
    owed: cedis(owed.props.amountPesewas),
    maximum: [...walk(tree)].filter((node) => node.type === "span" && /^Maximum/.test(textOf(node))).map(textOf),
    todayDisabled: Boolean(today.props.disabled),
    todayPressed: today.props["aria-pressed"],
    todaySelectedStyle: /green-200/.test(today.props.className),
    nextPressed: next.props["aria-pressed"],
    saveOff: Boolean(save.props.disabled),
    recordedPanel: textOf(tree).includes(posText("credit.payingToday")),
    alerts: alerts(tree)
  };
}

// 34 -> 18 -> 19, typing the name of an existing debtor (or a new one) and "How much each time".
async function openNineteen({ existing, sale = 8000, each = "40" }) {
  if (existing) await recordManualDebt({ name: "Ama", amountPesewas: existing, dueDate: addDueCycles(TODAY, "weekly", 1), now: Date.now() - 5000 });
  const a = app();
  a.start("NewPerson", { amountPesewas: sale, saleItems: [] });
  input(a.tree, (props) => props.autoComplete === "name").props.onChange({ target: { value: existing ? "Ama" : "Kofi New" } });
  a.rerender(); a.flush();
  // rules_global.duplicate_person (25 Nov 2026): an existing name is asked about; "Use this person" goes on.
  if (existing) await waitFor(() => { a.rerender(); return [...walk(a.tree)].some((node) => node.props?.role === "status" && /already exists/.test(textOf(node))); }, "the duplicate question");
  const status = [...walk(a.tree)].filter((node) => node.props?.role === "status").map(textOf);
  if (existing) findButton(a.tree, "Use this person").props.onClick();
  else [...walk(a.tree)].find((node) => node.type === "form").props.onSubmit({ preventDefault() {} });
  await waitFor(() => a.state.current === "WhenWillTheyPay", "18 to open");
  assert.equal(a.state.current, "WhenWillTheyPay");
  findButton(a.tree, "A little at a time").props.onClick();
  assert.equal(a.state.current, "ALittleAtATime");
  input(a.tree, (props) => props["aria-label"] === "How much each time?").props.onChange({ target: { value: each } });
  a.rerender();
  return { a, status };
}

const choose = (a, label) => { button(a.tree, (_props, text) => text === label).props.onClick(); a.rerender(); };
const chooseNextCycle = (a) => { button(a.tree, (_props, text) => /^Next cycle/.test(text)).props.onClick(); a.rerender(); };
const typeToday = (a, value) => { input(a.tree, (props) => props["aria-label"] === "Amount paid today").props.onChange({ target: { value } }); a.rerender(); };
const openSplit = async (a) => { button(a.tree, (props) => props["aria-label"] === "Split payment").props.onClick(); await waitFor(() => a.state.current === "SplitPayment", "27 to open"); assert.equal(a.state.current, "SplitPayment"); };
// The MoMo part as received on 62 (these 19 tests save without opening 62).
const cashMoMo = (cash, momo) => [
  { paymentMethod: "cash", amountPesewas: cash },
  { paymentMethod: "momo", amountPesewas: momo, momoMethod: "direct", verification: "merchant_confirmed", confirmedPesewas: momo }
];
// MOMO16 (11 Nov 2026): a Direct part back from 27 is not confirmed until Save plan opens 62. Next
// cycle can drop parts only while nothing was received (received MoMo is locked).
const cashMoMoNotConfirmed = (cash, momo) => [
  { paymentMethod: "cash", amountPesewas: cash },
  { paymentMethod: "momo", amountPesewas: momo, momoMethod: "direct" }
];

// What is on 27 as rows, handed back with Done (the rows were built on 27).
async function receive(a, parts) {
  const split = () => [...walk(a.tree)].find((node) => typeof node.type === "function" && node.type.name === "SplitPayment");
  split().props.onPartsChange(parts);
  split().props.onDone(parts);
  await waitFor(() => a.state.current === "ALittleAtATime", "19 to open again");
  assert.equal(a.state.current, "ALittleAtATime");
  a.rerender();
}

async function clickSave(a) {
  const original = console.error;
  console.error = () => {};
  try {
    const save = findButton(a.tree, "Save plan");
    await save.props.onClick();
    await waitFor(() => a.saved !== null || a.saveError !== null, "the plan save to finish");
    a.rerender();
  } finally { console.error = original; }
}

async function ledger() {
  const debts = await db.debts.toArray();
  const payments = await db.payments.toArray();
  const byMethod = (method) => payments.filter((payment) => payment.paymentMethod === method).reduce((sum, payment) => sum + payment.amountPesewas, 0);
  return {
    balance: debts.filter((debt) => debt.status === "unpaid").reduce((sum, debt) => sum + debt.amountPesewas, 0),
    cash: byMethod("cash"),
    momo: byMethod("momo"),
    plans: debts.filter((debt) => debt.status === "unpaid" && debt.isInstallmentPlan).map((debt) => ({ each: debt.installmentAmount, left: debt.installmentsRemaining, next: debt.nextDueDate }))
  };
}

// ---- A, B, C, C2, D: pay part of the balance on 27, come back, save --------------------------------------------------

const GRID = [
  { name: "A: Ama owes 248.20, sale 80, each 40, pays 200 (Cash 120 + MoMo 80)", existing: 24820, each: "40", cash: 12000, momo: 8000, balance: 12820, left: 4 },
  { name: "B: Ama owes 248.20, sale 80, each 40, pays 100 (Cash 60 + MoMo 40)", existing: 24820, each: "40", cash: 6000, momo: 4000, balance: 22820, left: 6 },
  { name: "C: new customer, sale 80, each 10, pays 60 (Cash 30 + MoMo 30)", existing: 0, each: "10", cash: 3000, momo: 3000, balance: 2000, left: 2 },
  { name: "C2: new customer, sale 80, each 10, pays 40 (Cash 20 + MoMo 20)", existing: 0, each: "10", cash: 2000, momo: 2000, balance: 4000, left: 4 },
  { name: "D: A with Next cycle chosen first, then Today, then the split", existing: 24820, each: "40", cash: 12000, momo: 8000, balance: 12820, left: 4, nextCycleFirst: true }
];

for (const row of GRID) {
  test(`${row.name}: back on 19 Owed is the full balance, Today is selected, Save plan works once, Money in and balance are right`, async () => {
    const { a, status } = await openNineteen({ existing: row.existing, each: row.each });
    if (row.existing) assert.deepEqual(status, ["Ama already exists (owes GH₵248.20). Use this person?"]);
    const fullBalance = row.existing + 8000;
    if (row.nextCycleFirst) chooseNextCycle(a);
    choose(a, "Today");
    typeToday(a, cedis(row.cash + row.momo));
    await openSplit(a);
    await receive(a, cashMoMo(row.cash, row.momo));

    const back = screen19(a);
    assert.equal(back.owed, cedis(fullBalance), "Owed is the full balance, not the balance minus today's payment");
    assert.deepEqual(back.maximum, [`Maximum: GH₵${cedis(fullBalance)}`]);
    assert.equal(back.todayDisabled, false, "Today stays tappable");
    assert.equal(back.todayPressed, true);
    assert.equal(back.todaySelectedStyle, true, "Today looks selected");
    assert.equal(back.nextPressed, false);
    assert.equal(back.recordedPanel, true, "the Paying today panel shows the parts");
    assert.equal(back.saveOff, false);
    assert.deepEqual(back.alerts, []);

    await clickSave(a);
    assert.equal(a.saveError, null);
    assert.ok(a.saved, "the plan saved");
    const result = await ledger();
    // Money in: exactly what was paid, once, by method.
    assert.equal(result.cash + result.momo, row.cash + row.momo, "Money in is the payment, once");
    assert.equal(result.momo, row.momo);
    assert.equal(result.cash, row.cash);
    assert.equal(result.balance, row.balance, "balance = owed + sale - paid");
    assert.deepEqual(result.plans.map((plan) => [plan.each, plan.left]), [[Number(row.each) * 100, row.left]]);
  });
}

// ---- Next cycle after the split: the recorded parts are discarded ---------------------------------------------------------

test("Next cycle after a recorded split discards the parts, hides the panel, records no payment and sizes the plan on the full balance", async () => {
  const { a } = await openNineteen({ existing: 24820, each: "40" });
  choose(a, "Today");
  typeToday(a, "200");
  await openSplit(a);
  await receive(a, cashMoMoNotConfirmed(12000, 8000));
  assert.equal(screen19(a).recordedPanel, true);

  chooseNextCycle(a);
  const afterNext = screen19(a);
  assert.equal(afterNext.nextPressed, true);
  assert.equal(afterNext.todayPressed, false);
  assert.equal(afterNext.recordedPanel, false, "the Paying today panel is hidden");
  assert.equal(afterNext.owed, "328.20");
  assert.equal(afterNext.saveOff, false);
  assert.equal(a.state.params.firstPaymentParts, undefined, "the recorded parts are discarded");
  assert.equal(a.state.params.splitParts, undefined);
  assert.notEqual(a.state.params.paymentMethod, "split");

  await clickSave(a);
  assert.equal(a.saveError, null);
  const result = await ledger();
  assert.deepEqual([result.cash, result.momo], [0, 0], "no payment is recorded");
  assert.equal(result.balance, 32820, "the plan is on the full balance");
  assert.deepEqual(result.plans.map((plan) => [plan.each, plan.left]), [[4000, 9]]);
});

test("Today again after Next cycle starts clean: the split parts are gone; the typed amount shows the one-row Cash panel", async () => {
  const { a } = await openNineteen({ existing: 24820, each: "40" });
  choose(a, "Today");
  typeToday(a, "200");
  await openSplit(a);
  await receive(a, cashMoMoNotConfirmed(12000, 8000));
  chooseNextCycle(a);
  choose(a, "Today");
  const again = screen19(a);
  assert.equal(a.state.params.firstPaymentParts, undefined, "no recorded split parts");
  assert.equal(a.state.params.splitParts, undefined);
  assert.equal(again.recordedPanel, true, "Amount paid today 200 and Cash chosen: single-method panel (12 Nov 2026)");
  assert.equal(again.todayPressed, true);
  assert.equal(again.owed, "328.20");
});

test("Cash only on 19 still saves (no split involved)", async () => {
  const { a } = await openNineteen({ existing: 24820, each: "40" });
  choose(a, "Today");
  typeToday(a, "200");
  await clickSave(a);
  assert.equal(a.saveError, null);
  const result = await ledger();
  assert.equal(result.balance, 12820);
  assert.equal(result.cash + result.momo, 20000);
});

// ---- the MoMo tile on 27 from 19: editor first, then 61 and 62, then back to 19 -----------------------------------------

test("27 from 19 through the MoMo tile (editor, 61, 62) then Cash and Done: back on 19 and the save is right", async () => {
  await setPreference("momoReceivingNumber", "0241234567");
  await setPreference("momoReceivingNetwork", "MTN");
  const { a } = await openNineteen({ existing: 24820, each: "40" });
  choose(a, "Today");
  typeToday(a, "200");
  await openSplit(a);

  // 27: the MoMo tile asks how much first, prefilled with Left to pay; a comma is accepted.
  button(a.tree, (_props, text) => text === "MoMo").props.onClick(); a.rerender();
  const editor = input(a.tree, (props) => props.id === "split-draft-amount");
  assert.equal(editor.props.value, "200.00", "prefilled with Left to pay");
  editor.props.onChange({ target: { value: "80,00" } }); a.rerender();
  button(a.tree, (_props, text) => text === "Save").props.onClick();
  await waitFor(() => a.state.current === "MoMoChoice", "61 to open");
  assert.equal(a.state.current, "MoMoChoice", "Save goes to 61");
  assert.equal(a.state.params.pendingMomoAmountPesewas, 8000);
  assert.match(textOf(a.tree), /Customer pays GH₵80\.00/);

  // 61 -> 62 (Customer sends to my number), then Money received.
  button(a.tree, (_props, text) => /Customer sends to my number/.test(text)).props.onClick();
  await waitFor(() => a.state.current === "MoMoDirect", "62 to open");
  a.rerender();
  assert.equal(a.state.current, "MoMoDirect");
  assert.match(textOf(a.tree), /Ask the customer to send ?GH₵80\.00/);
  await waitFor(() => { a.rerender(); return !findButton(a.tree, "Money received").props.disabled; }, "62 to load the receiving number");
  await findButton(a.tree, "Money received").props.onClick();
  await waitFor(() => a.state.current === "SplitPayment", "27 to open again");
  a.rerender();
  assert.equal(a.state.current, "SplitPayment", "back on 27");
  assert.deepEqual(a.state.params.splitParts.map((part) => [part.paymentMethod, part.amountPesewas]), [["momo", 8000]]);
  assert.equal(a.state.params.pendingMomoAmountPesewas, undefined, "the pending MoMo values are removed");

  // 27: Cash takes the rest in one tap, Done returns to 19.
  button(a.tree, (_props, text) => text === "Cash").props.onClick(); a.rerender();
  const received = findButton(a.tree, "Done");
  assert.equal(Boolean(received.props.disabled), false);
  await received.props.onClick();
  await waitFor(() => a.state.current === "ALittleAtATime", "19 to open again");
  a.rerender();
  assert.equal(a.state.current, "ALittleAtATime");

  const back = screen19(a);
  assert.equal(back.owed, "328.20");
  assert.equal(back.todayDisabled, false);
  assert.equal(back.todaySelectedStyle, true);
  assert.equal(back.saveOff, false);
  assert.equal(back.recordedPanel, true);
  await clickSave(a);
  assert.equal(a.saveError, null);
  const result = await ledger();
  assert.deepEqual([result.cash, result.momo, result.balance], [12000, 8000, 12820]);
});

// ---- the safety net: a payment that does not match its parts has a code and a message -------------------------------------

test("parts that do not add up to the payment throw a coded error with the same text, and 19 shows the message", async () => {
  const mismatch = { amountPesewas: 8000, name: "Kofi", initialPaymentPesewas: 5000, initialPaymentParts: [{ paymentMethod: "cash", amountPesewas: 3000 }], paymentMethod: "cash", note: "Sale", saleItems: [] };
  await assert.rejects(recordCreditSale(mismatch), (error) => error.code === "payment_parts_mismatch" && error.message === "Initial payment parts must add up to the initial payment amount.");
  await assert.rejects(recordManualDebt({ name: "Kofi", amountPesewas: 8000, initialPaymentPesewas: 5000, initialPaymentParts: [{ paymentMethod: "cash", amountPesewas: 3000 }], paymentMethod: "cash", now: Date.now() }), (error) => error.code === "payment_parts_mismatch");

  const message = "The payment today does not match the cash and MoMo entered. Go back and enter the payment again.";
  assert.equal(posText("credit.paymentPartsMismatch"), message);
  const { planError, PLAN_ERROR } = await import("../src/lib/planErrors.js");
  const { default: Screens } = await loadJsx("src/pos/CreditScreens.jsx");
  const view = render({ type: Screens, props: {
    route: "ALittleAtATime", params: { amountPesewas: 8000, customer: { name: "Kofi", totalDebtPesewas: 0 }, installmentAmount: "40", frequency: "weekly", startToday: false, nextDueDate: addDueCycles(TODAY, "weekly", 1) },
    onBack() {}, onNavigate() {}, onUpdateParams() {}, onReturnToSplit() {},
    onSaveCredit: async () => { throw planError(PLAN_ERROR.paymentPartsMismatch, "Initial payment parts must add up to the initial payment amount."); }
  } });
  const original = console.error;
  console.error = () => {};
  try {
    await findButton(view.tree, "Save plan").props.onClick();
    await waitFor(() => { view.rerender(); return alerts(view.tree).length > 0; }, "the message on 19");
  } finally { console.error = original; }
  assert.deepEqual(alerts(view.tree), [message]);
});