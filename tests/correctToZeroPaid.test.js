import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { correctDebtBalance } from "../src/db/debtLedger.js";
import { recordCreditSale, recordDebtPayment } from "../src/db/debts.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { getMostUrgentCustomerDebt } from "../src/pos/money.js";
import { loadAllUnpaidDebts } from "../src/pos/owed.js";
import { loadCustomerHistory } from "../src/utils/loadCustomerDebtHistory.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

globalThis.HTMLElement ??= class {};

// 14 Nov 2026: a correction that brings a balance to zero stores the debt as paid, like a full
// payment, so every view agrees. The correction event (previous balance, new balance, difference,
// reason) is still appended and nothing is overwritten. A partial correction leaves it unpaid.

let liveResults = new Map();
setLiveQuery((deps, query) => {
  const key = `${String(query)}|${JSON.stringify(deps)}`;
  if (!liveResults.has(key)) {
    liveResults.set(key, undefined);
    Promise.resolve().then(query).then((value) => liveResults.set(key, value), () => liveResults.set(key, null));
  }
  return liveResults.get(key);
});

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  resetBrowserBack();
  liveResults = new Map();
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
});

const DAY = 86_400_000;
const DUE = new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10);

async function oweJuju(amountPesewas = 1000) {
  await recordCreditSale({ name: "Juju", amountPesewas, dueDate: DUE, now: Date.now() - 3 * DAY });
  return (await db.debts.toArray()).find((debt) => debt.status === "unpaid");
}

async function correct(debt, newBalancePesewas) {
  return correctDebtBalance({ debtId: debt.id, expectedUpdatedAt: debt.updatedAt, newBalancePesewas, reasonCode: "wrong_amount" });
}

async function open() {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  return app;
}

const owedCard = (app) => [...walk(app.view.tree)].find((node) => node.type === "section" && "data-owed-card" in (node.props ?? {}));
const shown = (node) => textOf(node).replace(/\s+/g, " ");

async function owedListText(app) {
  const home = [...walk(app.view.tree)].find((node) => node.type?.name === "Home");
  home.props.onNavigate("PeopleWhoOweYou");
  await app.settle();
  assert.equal(app.route, "PeopleWhoOweYou");
  return shown(app.view.tree);
}

// The person's history (29/43): its own balance from the stored debts, and the events.
async function history(debt, expectedBalancePesewas) {
  const summary = await loadCustomerHistory(debt.customerId, "Juju");
  assert.equal(summary.currentBalancePesewas, expectedBalancePesewas, "history balance");
  return summary;
}

test("correct to zero: the debt is stored as paid, like a full payment", async () => {
  const corrected = await oweJuju();
  await correct(corrected, 0);
  const afterCorrection = await db.debts.get(corrected.id);

  await db.debts.clear(); await db.transactions.clear(); await db.payments.clear(); await db.customers.clear();
  const paid = await oweJuju();
  await recordDebtPayment({ debtId: paid.id, amountPesewas: 1000, paymentMethod: "cash" });
  const afterPayment = await db.debts.get(paid.id);

  for (const field of ["status", "amountPesewas", "total_owed", "dueDate"]) {
    assert.deepEqual(afterCorrection[field], afterPayment[field], field);
  }
  assert.equal(afterCorrection.status, "paid");
});

test("correct to zero: the correction event is still appended and the sale is kept", async () => {
  const debt = await oweJuju();
  const before = await db.transactions.toArray();
  const { adjustment } = await correct(debt, 0);
  const transactions = await db.transactions.toArray();
  assert.equal(transactions.length, before.length + 1, "one event added");
  for (const record of before) assert.deepEqual(transactions.find(({ id }) => id === record.id), record, "earlier records unchanged");
  const stored = transactions.find(({ id }) => id === adjustment.id);
  assert.equal(stored.type, "debt_adjustment");
  assert.equal(stored.previousBalancePesewas, 1000);
  assert.equal(stored.newBalancePesewas, 0);
  assert.equal(stored.deltaPesewas, -1000);
  assert.equal(stored.reasonCode, "wrong_amount");
  assert.equal(stored.debtBefore.status, "unpaid");
  assert.equal(stored.debtAfter.status, "paid");
  assert.equal(stored.debtBefore.dueDate, DUE, "the cleared due date is kept in the event");
  assert.equal(stored.debtAfter.dueDate, "");
});

test("correct to zero: Home, 32, Collect first and the history all agree nobody owes", async () => {
  const debt = await oweJuju();
  await correct(debt, 0);

  assert.equal(getMostUrgentCustomerDebt(await db.debts.toArray()), null, "Collect first: nobody");
  assert.deepEqual(await loadAllUnpaidDebts(), [], "32 loader: nobody");
  const summary = await history(debt, 0);
  assert.equal(summary.unaccountedCreditPesewas, 0, "history agrees with the stored balance");
  assert.ok(summary.events.some((event) => event.type === "adjustment" && event.deltaPesewas === -1000), "history shows the correction");

  const app = await open();
  assert.equal(owedCard(app), undefined, "Home: no Owed card");
  assert.doesNotMatch(shown(app.view.tree), /Collect first|Juju/);
  const list = await owedListText(app);
  assert.match(list, /No one owes you right now\./, "32: empty wording");
  assert.doesNotMatch(list, /Juju/);
});

test("a partial correction leaves the debt unpaid, and every view shows the new balance", async () => {
  const debt = await oweJuju();
  await correct(debt, 400);
  const stored = await db.debts.get(debt.id);
  assert.equal(stored.status, "unpaid");
  assert.equal(stored.amountPesewas, 400);
  assert.equal(stored.dueDate, DUE, "the due date stays");

  const urgent = getMostUrgentCustomerDebt(await db.debts.toArray());
  assert.equal(urgent.customerName, "Juju");
  assert.equal(urgent.amountPesewas, 400);
  assert.deepEqual((await loadAllUnpaidDebts()).map((row) => row.id), [debt.id]);
  const summary = await history(debt, 400);
  assert.equal(summary.unaccountedCreditPesewas, 0, "history agrees with the stored balance");

  const app = await open();
  const card = owedCard(app);
  assert.ok(card, "Home: the Owed card shows");
  assert.match(shown(card), /GH₵4\.00/);
  assert.match(shown(card), /Juju/);
  const list = await owedListText(app);
  assert.match(list, /Juju/);
  assert.match(list, /GH₵4\.00/);
});
