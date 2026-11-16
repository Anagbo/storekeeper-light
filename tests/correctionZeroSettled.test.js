import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale, recordDebtCollection } from "../src/db/debts.js";
import { recalculateCustomerDebtBalance } from "../src/db/debtLedger.js";
import { setPreference } from "../src/db/preferences.js";
import { recordReminderSent } from "../src/db/reminders.js";
import { summarizePosMoney } from "../src/lib/money.js";
import { localDateString } from "../src/utils/installments.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// A Balance corrected row (16 Nov 2026 layout): "Was GH₵old" on the left, the new balance on the right.
const correctionParts = (node) => {
  const part = (name) => textOf([...walk(node)].find((child) => child.props?.[name] !== undefined) ?? "");
  return { was: part("data-correction-was"), now: part("data-correction-new") };
};

// Wiring 54 (decided 16 Nov 2026): a correction to GH₵0.00, saved from the sheet, settles the debt.
// The person owes nothing (29/43, the Owed list and Home update, no leftover "Open debt entries"); the
// history shows "Balance corrected", "Was GH₵old" with GH₵0.00 on the right, and the reason; a plan and reminders behave
// as for a paid-off debt; Money in, Money spent and Cash left do not change; 73 shows the card.
// "As for a paid-off debt" is checked against a twin paid in full in cash.

globalThis.HTMLElement ??= class {};

after(async () => {
  setLiveQuery(null);
  db.close();
  await db.delete();
});

beforeEach(async () => {
  resetBrowserBack();
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
  // Live queries re-run on every render, so 29 and Home show what is stored now.
  setLiveQuery((deps, query) => {
    const key = `${String(query)}|${JSON.stringify(deps)}`;
    liveCache.has(key) || liveCache.set(key, undefined);
    Promise.resolve().then(query).then((value) => liveCache.set(key, value), () => liveCache.set(key, null));
    return liveCache.get(key);
  });
});
const liveCache = new Map();

const nodes = (tree) => [...walk(tree)].filter((node) => node.props);
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
const money = async () => summarizePosMoney(await db.transactions.toArray());

async function openDetail(app, debtId, customerName) {
  nodes(app.view.tree).find((node) => node.type?.name === "Home")?.props.onNavigate("DebtorDetail", { debtId, customerName });
  await app.settle();
}

async function correctToZeroOnSheet(app, { entryAmount = null } = {}) {
  if (entryAmount) {
    const row = nodes(app.view.tree).find((node) => node.type === "li" && textOf(node).includes(entryAmount) && [...walk(node)].some((kid) => kid.type === "button" && textOf(kid) === "Correct this entry"));
    await [...walk(row)].find((kid) => kid.type === "button" && textOf(kid) === "Correct this entry").props.onClick();
    await app.settle();
  } else {
    await app.tap("Correct balance");
  }
  app.input("pos-correction-amount").props.onChange({ target: { value: "0" } });
  await app.settle();
  await app.tap("Debt forgiven");
  const form = nodes(app.view.tree).find((node) => node.type === "form" && node.props.onSubmit?.name === "saveCorrection");
  assert.equal(app.button("Save correction").props.disabled, false);
  await form.props.onSubmit({ preventDefault() {} });
  await app.settle();
  const left = nodes(app.view.tree).find((node) => node.props["aria-labelledby"] === "pos-correction-title");
  assert.equal(left, undefined, `the sheet closed: ${left ? textOf(left) : ""} ${JSON.stringify(app.errors.map(String))}`);
}

// What 29 offers, without the person's name: the buttons and links with their state, and the sections.
function detailShape(app, name) {
  const controls = nodes(app.view.tree)
    .filter((node) => node.type === "button" || node.type === "a")
    .map((node) => `${node.type}:${(node.props["aria-label"] ?? textOf(node)).replaceAll(name, "NAME").trim()}:${node.props.disabled ? "off" : "on"}`)
    .filter((text) => !/Open menu|Back/.test(text));
  return { controls, openEntries: /Open debt entries/.test(app.text()), plan: /Installment|plan/i.test(app.text()) };
}

test("54 single debt with a plan and a reminder, corrected to 0: settled exactly like a full payment", async () => {
  const { debtId: amaDebt } = await recordCreditSale({ name: "Ama", amountPesewas: 20000, installmentPlan: plan(20000, 5000), now: Date.now() - 3 * 86_400_000 });
  const { debtId: kofiDebt } = await recordCreditSale({ name: "Kofi", amountPesewas: 20000, installmentPlan: plan(20000, 5000), now: Date.now() - 3 * 86_400_000 });
  const ama = await db.debts.get(amaDebt);
  const kofi = await db.debts.get(kofiDebt);
  await recordReminderSent({ customerId: ama.customerId, customerName: "Ama" });
  await recordReminderSent({ customerId: kofi.customerId, customerName: "Kofi" });
  await recordDebtCollection({ debtId: kofiDebt, parts: [{ paymentMethod: "cash", amountPesewas: 20000 }] });
  const moneyBefore = await money();

  const app = await openPosApp();
  after(() => app.restoreConsole());
  assert.match(app.text(), /Owed to you/, "Home: Ama owes before");
  await openDetail(app, amaDebt, "Ama");
  await correctToZeroOnSheet(app);

  // Stored: paid, no plan left, exactly as the twin paid in full.
  const amaAfter = await db.debts.get(amaDebt);
  const kofiAfter = await db.debts.get(kofiDebt);
  for (const field of ["status", "amountPesewas", "total_owed", "dueDate", "isInstallmentPlan", "nextDueDate", "installmentsRemaining", "installmentAmount"]) {
    assert.deepEqual(amaAfter[field], kofiAfter[field], `debt ${field} as for a paid-off debt`);
  }
  assert.equal(amaAfter.status, "paid");
  assert.equal((await db.customers.get(ama.customerId)).totalDebtPesewas, 0, "the person owes nothing");

  // Money in, Money spent and Cash left do not move: no cash moved.
  const moneyAfter = await money();
  for (const field of ["moneyIn", "moneySpent", "cashLeft", "cashIn", "momoIn"]) assert.equal(moneyAfter[field], moneyBefore[field], field);

  // 29 after the save: owes nothing, no Open debt entries, the history row with Was GH₵old, the new balance and the reason.
  await app.settle();
  const text = app.text();
  assert.doesNotMatch(text, /Open debt entries/);
  assert.match(text, /GH₵0\.00/);
  const row = nodes(app.view.tree).find((node) => node.props["data-correction-row"] !== undefined);
  assert.ok(row, "a correction row in the history");
  assert.match(textOf(row), /Balance corrected/);
  assert.deepEqual(correctionParts(row), { was: "Was GH₵200.00", now: "GH₵0.00" });
  assert.match(textOf(row), /Debt forgiven/);
  const amaShape = detailShape(app, "Ama");

  // The twin paid in full: the same 29 (buttons, their state, no entries, no plan panel).
  await app.phoneBack();
  await openDetail(app, kofiDebt, "Kofi");
  const kofiShape = detailShape(app, "Kofi");
  assert.deepEqual(amaShape.openEntries, kofiShape.openEntries);
  assert.deepEqual(amaShape.plan, kofiShape.plan, "the plan panel as for a paid-off debt");
  assert.deepEqual(amaShape.controls, kofiShape.controls, "29's buttons (Collect, reminders, Correct balance) as for a paid-off debt");

  // Home and the Owed list: nobody owes.
  await app.goHome();
  assert.doesNotMatch(app.text(), /Owed to you|Collect first/, "Home: no Owed card");
  await app.tap("Owed");
  assert.match(app.text(), /No one owes you right now\./);
  assert.doesNotMatch(app.text(), /Ama|Kofi/);

  // 73 shows the correction card.
  await app.goHome();
  await openDetail(app, amaDebt, "Ama");
  await app.tap(/the record/);
  assert.equal(app.route, "CustomerRecordView");
  const card = nodes(app.view.tree).find((node) => /correct/i.test(String(node.props["data-record-row"] ?? "")));
  assert.ok(card, "73: a correction card");
  assert.match(textOf(card), /Balance corrected/);
  assert.deepEqual(correctionParts(card), { was: "Was GH₵200.00", now: "GH₵0.00" });
  assert.match(textOf(card), /Debt forgiven/);
});

test("54 one entry among several corrected to 0: that entry is settled, the rest still owed", async () => {
  const { debtId } = await recordCreditSale({ name: "Ama", amountPesewas: 15000, now: Date.now() - 3 * 86_400_000 });
  const first = await db.debts.get(debtId);
  // A second open entry with its own credit sale behind it (as older or synced data can hold).
  const sale = (await db.transactions.toArray()).find((record) => record.debtId === debtId);
  const at = Date.now() - 86_400_000;
  await db.transactions.add({ ...sale, id: "second-sale", debtId: "second-entry", amountPesewas: 5000, total_amount: 5000, pricePesewas: 5000, creditSaleGrossPesewas: 5000, creditExtendedPesewas: 5000, items_json: JSON.stringify([{ name: "Sale", quantity: 1, total_amount: 5000 }]), createdAt: at, timestamp: at, updatedAt: at });
  await db.debts.add({ ...first, id: "second-entry", transactionId: "second-sale", amountPesewas: 5000, total_owed: 5000, note: "Second entry", createdAt: at, created_at: at, updatedAt: at });
  await recalculateCustomerDebtBalance({ customerId: first.customerId });
  const moneyBefore = await money();

  const app = await openPosApp();
  after(() => app.restoreConsole());
  await openDetail(app, debtId, "Ama");
  await correctToZeroOnSheet(app, { entryAmount: "GH₵50.00" });

  assert.equal((await db.debts.get("second-entry")).status, "paid", "that entry is settled");
  assert.equal((await db.debts.get(debtId)).status, "unpaid", "the other entry is untouched");
  assert.equal((await db.customers.get(first.customerId)).totalDebtPesewas, 15000);
  const moneyAfter = await money();
  for (const field of ["moneyIn", "moneySpent", "cashLeft"]) assert.equal(moneyAfter[field], moneyBefore[field], field);

  await app.settle();
  const row = nodes(app.view.tree).find((node) => node.props["data-correction-row"] !== undefined);
  assert.deepEqual(correctionParts(row), { was: "Was GH₵50.00", now: "GH₵0.00" }, "Was is that entry's balance");
  assert.match(textOf(row), /Debt forgiven/);
  assert.doesNotMatch(app.text(), /Open debt entries/, "one open entry left: no entries list");
  assert.match(app.text(), /GH₵150\.00/);
});
