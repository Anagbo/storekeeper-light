import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordManualDebt } from "../src/db/debtLedger.js";
import { recordCreditSale } from "../src/db/debts.js";
import { posText } from "../src/pos/i18n.js";
import { addDueCycles, localDateString } from "../src/utils/installments.js";
import { findButton, flushEffects, loadJsx, render, textOf, walk } from "./helpers/renderJsx.js";

// Cleanup: 19 names what is wrong when a valid-looking plan cannot be saved, 34 warns about an
// existing debtor, and today is not accepted as the installment next payment date.
after(async () => {
  db.close();
  await db.delete();
});
beforeEach(async () => {
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings].map((table) => table.clear()));
});

const TODAY = localDateString();
const plusDays = (days) => {
  const date = new Date(`${TODAY}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const settle = async () => { for (let index = 0; index < 20; index += 1) await new Promise((resolve) => setTimeout(resolve, 3)); };
const alerts = (tree) => [...walk(tree)].filter((node) => node.props?.role === "alert").map(textOf);

const TOO_HIGH = "Each time is too high for this debt. Enter a smaller amount.";
const DEBT_CHANGED = "This customer’s debt changed since you started. Go back and choose the customer again.";
const DATE_MESSAGE = "Choose a valid next payment date.";

// What PosApp.saveCreditSale passes to the writers.
async function posSave(details) {
  if (details.manualDebt) {
    return recordManualDebt({
      customerId: details.customer?.id ?? details.customerId, debtId: details.debtId, name: details.customer?.name ?? "",
      phone: details.customer?.phone ?? "", ghanaCardNumber: details.customer?.ghanaCardNumber ?? "", amountPesewas: details.amountPesewas,
      initialPaymentPesewas: details.initialPaymentPesewas ?? 0, initialPaymentParts: details.initialPaymentParts ?? null,
      paymentMethod: details.paymentMethod ?? "cash", note: details.note ?? "", dueDate: details.dueDate ?? "",
      installmentPlan: details.installmentPlan ?? null, takenOn: details.takenOn ?? "", attemptId: details.attemptId, now: Date.now()
    });
  }
  return recordCreditSale({
    amountPesewas: details.amountPesewas, name: details.customer?.name ?? "", phone: details.customer?.phone ?? "",
    ghanaCardNumber: details.customer?.ghanaCardNumber ?? "", dueDate: details.dueDate ?? "", installmentPlan: details.installmentPlan ?? null,
    initialPaymentPesewas: details.initialPaymentPesewas ?? 0, initialPaymentParts: details.initialPaymentParts ?? null,
    paymentMethod: details.paymentMethod ?? "cash", note: "Sale", saleItems: [], attemptId: details.attemptId
  });
}

async function save19(params) {
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx");
  let result = null;
  let failed = false;
  const original = console.error;
  console.error = () => {};
  try {
    const view = render({ type: CreditScreens, props: {
      route: "ALittleAtATime", params, onBack() {}, onNavigate() {}, onUpdateParams() {}, onReturnToSplit() {},
      onSaveCredit: async (details) => { try { result = await posSave(details); } catch (error) { failed = true; throw error; } }
    } });
    const button = findButton(view.tree, "Save plan");
    const wasOff = Boolean(button.props.disabled);
    if (!wasOff) {
      await button.props.onClick();
      for (let index = 0; index < 200 && !result && alerts(view.tree).length === 0; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 3));
        view.rerender();
      }
      view.rerender();
    }
    return { wasOff, saved: Boolean(result), alerts: alerts(view.tree), failed, view };
  } finally {
    console.error = original;
  }
}

async function older(amount = 3000) {
  return recordManualDebt({ name: "Ama", amountPesewas: amount, dueDate: addDueCycles(TODAY, "weekly", 1), now: Date.now() - 5000 });
}
async function twoEntries() {
  const first = await older(3000);
  await db.debts.add({ ...first.debt, id: "second-entry", amountPesewas: 2000, total_owed: 2000, createdAt: first.debt.createdAt + 1, created_at: first.debt.createdAt + 1 });
  return first;
}
const customerOf = (first, totalDebtPesewas) => ({ ...(first.customer ?? {}), name: "Ama", totalDebtPesewas, debt: first.debt });
const nextCycle = (each, extra = {}) => ({ installmentAmount: String(each), frequency: "weekly", startToday: false, nextDueDate: plusDays(7), ...extra });

// ---- two open entries: Each time is more than the entry the plan is saved on ----------------------------------------

test("two open entries 30 + 20, 10 added: 50 each time says Each time is too high (sale and manual debt); 35 and 20 save", async () => {
  for (const flow of ["sale", "manual"]) {
    for (const [each, saves] of [[50, false], [35, true], [20, true]]) {
      await Promise.all([db.debts, db.customers, db.transactions, db.payments].map((table) => table.clear()));
      const first = await twoEntries();
      const base = flow === "sale"
        ? { amountPesewas: 1000, customer: customerOf(first, 5000) }
        : { manualDebt: true, amountPesewas: 1000, customer: customerOf(first, 5000), debtId: first.debt.id, note: "", takenOn: TODAY };
      const result = await save19({ ...base, ...nextCycle(each) });
      assert.equal(result.wasOff, false, `${flow} ${each}: the form looks valid`);
      if (saves) assert.deepEqual([result.saved, result.alerts], [true, []], `${flow} ${each}`);
      else assert.deepEqual([result.saved, result.alerts], [false, [TOO_HIGH]], `${flow} ${each}`);
    }
  }
});

// ---- the customer's debt is not what 19 was told --------------------------------------------------------------------

test("a payment that is more than the customer's debt allows says The payment today cannot exceed {amount}", async () => {
  for (const flow of ["sale", "manual"]) {
    await Promise.all([db.debts, db.customers, db.transactions, db.payments].map((table) => table.clear()));
    const first = await older(1000);            // the record says 10; 19 was told 30
    const base = flow === "sale"
      ? { amountPesewas: 5000, customer: customerOf(first, 3000) }
      : { manualDebt: true, amountPesewas: 5000, customer: customerOf(first, 3000), debtId: first.debt.id, note: "", takenOn: TODAY };
    const result = await save19({ ...base, ...nextCycle(20, { startToday: true, todayPaymentAmount: "80", paymentMethod: "cash" }) });
    assert.equal(result.wasOff, false);
    assert.deepEqual([result.saved, result.alerts], [false, ["The payment today cannot exceed GH₵60.00."]], flow);
    assert.equal(await db.payments.count(), 0, "nothing was written");
  }
});

test("a leftover mismatch (the customer owes more than 19 was told) says the debt changed", async () => {
  await older(3000);
  const result = await save19({ amountPesewas: 5000, customer: { name: "Ama", totalDebtPesewas: 0 }, ...nextCycle(20) });
  assert.equal(result.wasOff, false);
  assert.deepEqual([result.saved, result.alerts], [false, [DEBT_CHANGED]]);
  assert.equal((await db.debts.toArray())[0].amountPesewas, 3000, "nothing was written");
});

test("a manual debt on an entry that is gone says the debt changed", async () => {
  const first = await older(3000);
  const result = await save19({ manualDebt: true, amountPesewas: 5000, customer: customerOf(first, 3000), debtId: "gone", note: "", takenOn: TODAY, ...nextCycle(20) });
  assert.deepEqual([result.saved, result.alerts], [false, [DEBT_CHANGED]]);
});

test("an unknown failure keeps the general message", async () => {
  const first = await older(3000);
  const result = await save19({ manualDebt: true, amountPesewas: 5000, customer: customerOf(first, 3000), debtId: first.debt.id, note: "", takenOn: "2999-01-01", ...nextCycle(20) });
  assert.deepEqual(result.alerts, ["Enter a valid installment amount, frequency and payment date."]);
});

// ---- 34: a new person with the name of someone who already owes ------------------------------------------------------

async function typeName(view, value) {
  const name = [...walk(view.tree)].find((node) => node.type === "input" && node.props?.autoComplete === "name");
  name.props.onChange({ target: { value } });
  view.rerender();
  flushEffects(view);
  await settle();
  view.rerender();
}
async function newPersonView(params, navigated = []) {
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx");
  return render({ type: CreditScreens, props: { route: "NewPerson", params, onBack() {}, onNavigate: (...args) => navigated.push(args) } });
}

test("34: the name of someone who already owes shows the warning; other names and paid-off debts do not", async () => {
  await older(3000);
  await db.debts.add({ id: "paid-one", customerName: "Kofi", customer_name: "Kofi", status: "paid", amountPesewas: 0, total_owed: 0, createdAt: 1 });
  const view = await newPersonView({ amountPesewas: 5000 });
  assert.doesNotMatch(textOf(view.tree), /already owes/);
  await typeName(view, "  ama ");
  assert.match(textOf(view.tree), /Ama already owes GH₵30\.00\. This will be added to Ama’s debt\./);
  assert.deepEqual(alerts(view.tree), []);
  await typeName(view, "Esi");
  assert.doesNotMatch(textOf(view.tree), /already owes/);
  await typeName(view, "Kofi");
  assert.doesNotMatch(textOf(view.tree), /already owes/);
  await typeName(view, "");
  assert.doesNotMatch(textOf(view.tree), /already owes/);
});

test("34 to 19: the older debt is carried, so the plan is sized on the whole balance and saves (20 and 80 each time)", async () => {
  for (const each of [20, 80]) {
    await Promise.all([db.debts, db.customers, db.transactions, db.payments].map((table) => table.clear()));
    await older(3000);
    const navigated = [];
    const view = await newPersonView({ amountPesewas: 5000 }, navigated);
    await typeName(view, "Ama");
    [...walk(view.tree)].find((node) => node.type === "form").props.onSubmit({ preventDefault() {} });
    assert.equal(navigated.length, 1);
    const [route, params] = navigated[0];
    assert.equal(route, "WhenWillTheyPay");
    assert.equal(params.customer.totalDebtPesewas, 3000);
    assert.equal(params.isNewCustomer, true);
    const result = await save19({ ...params, ...nextCycle(each) });
    assert.deepEqual([result.saved, result.alerts], [true, []], `${each} each time`);
    const debts = await db.debts.toArray();
    assert.equal(debts.reduce((sum, debt) => sum + debt.amountPesewas, 0), 8000);
    assert.equal(debts[0].installmentAmount, each * 100);
    assert.equal(debts[0].installmentsRemaining, Math.ceil(8000 / (each * 100)));
  }
});

test("34: a name that owes nothing carries no debt total", async () => {
  const navigated = [];
  const view = await newPersonView({ amountPesewas: 5000 }, navigated);
  await typeName(view, "Esi");
  [...walk(view.tree)].find((node) => node.type === "form").props.onSubmit({ preventDefault() {} });
  assert.equal("totalDebtPesewas" in navigated[0][1].customer, false);
});

// ---- the next payment date on 19 must be after today ------------------------------------------------------------------

test("19: today and earlier are refused with the date message; tomorrow is accepted", async () => {
  for (const [date, ok] of [[plusDays(-1), false], [TODAY, false], [plusDays(1), true], [plusDays(7), true]]) {
    for (const startToday of [false, true]) {
      await Promise.all([db.debts, db.customers, db.transactions, db.payments].map((table) => table.clear()));
      const params = { amountPesewas: 5000, customer: { name: "Ama", totalDebtPesewas: 0 }, ...nextCycle(20, { nextDueDate: date, startToday, ...(startToday && { todayPaymentAmount: "5.00", paymentMethod: "cash" }) }) };
      const result = await save19(params);
      if (ok) assert.deepEqual([result.saved, result.alerts], [true, []], `${date} startToday=${startToday}`);
      else assert.deepEqual([result.wasOff, result.saved, result.alerts], [true, false, [DATE_MESSAGE]], `${date} startToday=${startToday}`);
    }
  }
});

test("19: the date field starts at tomorrow", async () => {
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx");
  const view = render({ type: CreditScreens, props: { route: "ALittleAtATime", params: { amountPesewas: 5000, customer: { name: "Ama", totalDebtPesewas: 0 } }, onBack() {}, onNavigate() {}, onUpdateParams() {}, onReturnToSplit() {}, onSaveCredit() {} } });
  assert.equal([...walk(view.tree)].find((node) => node.type === "input" && node.props?.type === "date").props.min, plusDays(1));
  assert.deepEqual(alerts(view.tree), [], "the default date shows no message");
});

// Deterministic (item 7): the clock is fixed, not the real date and time. Only Date is mocked, so
// IndexedDB's own timers still run. The fixed time is one second before local midnight, so a save
// that read the date twice would cross into tomorrow; with a fixed clock it never can, at any time
// of day and in any timezone (local midnight is built in the timezone the test runs in).
test("18: Today is still a valid fixed due date", async (t) => {
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx");
  const fixedNow = new Date(2026, 2, 15, 23, 59, 59, 0).getTime();
  t.mock.timers.enable({ apis: ["Date"], now: fixedNow });
  const fixedToday = localDateString(new Date(fixedNow));
  assert.equal(fixedToday, "2026-03-15", "the fixed day is the local calendar day");
  let result = null;
  let failure = null;
  const view = render({ type: CreditScreens, props: { route: "WhenWillTheyPay", params: { amountPesewas: 5000, customer: { name: "Ama", totalDebtPesewas: 0 }, creditDueChoice: "today" }, onBack() {}, onNavigate() {}, onReturnToSplit() {}, onSaveCredit: async (details) => { try { result = await posSave(details); } catch (error) { failure = error; } } } });
  // Save on 18 shows two lines; its accessible name stays "Save · {Name} owes GH₵x".
  const save = [...walk(view.tree)].filter((node) => node.type === "button" && /^Save · /.test(node.props["aria-label"] ?? textOf(node))).at(-1);
  await save.props.onClick();
  // Wait for the save itself (a fixed pause was too short on a busy machine); Date is frozen, so count rounds.
  for (let round = 0; round < 2000 && !result && !failure; round += 1) await new Promise((resolve) => setTimeout(resolve, 2));
  assert.equal(failure, null, "the writer accepted today");
  assert.ok(result, "saved");
  const debts = await db.debts.toArray();
  assert.equal(debts.length, 1);
  assert.equal(debts[0].dueDate, fixedToday);
});

// ---- the wording -----------------------------------------------------------------------------------------------------------

test("the new messages read exactly as approved; the existing ones are unchanged", () => {
  assert.equal(posText("credit.eachTimeTooHigh"), TOO_HIGH);
  assert.equal(posText("credit.debtChanged"), DEBT_CHANGED);
  assert.equal(posText("credit.existingDebtor", { name: "Ama", amount: "GH₵30.00" }), "Ama already owes GH₵30.00. This will be added to Ama’s debt.");
  assert.equal(posText("credit.paymentTodayTooHigh", { amount: "GH₵60.00" }), "The payment today cannot exceed GH₵60.00.");
  assert.equal(posText("credit.invalidDueDate"), DATE_MESSAGE);
  assert.equal(posText("credit.invalidInstallment"), "Enter a valid installment amount, frequency and payment date.");
});

test("the catch on 19 maps the known causes; the date rule is 'after today'", () => {
  const source = readFileSync(new URL("../src/pos/CreditScreens.jsx", import.meta.url), "utf8");
  assert.match(source, /PLAN_ERROR\.eachTimeTooHigh/);
  assert.match(source, /PLAN_ERROR\.paymentTooHigh/);
  assert.match(source, /PLAN_ERROR\.debtChanged/);
  assert.doesNotMatch(source, /nextDueDate >= today|nextDueDate < today/);
});