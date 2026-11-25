import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale, recordDebtCollection } from "../src/db/debts.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { addDueCycles, localDateString, prepareInstallmentPlan } from "../src/utils/installments.js";
import { openPosApp } from "./helpers/posAppHarness.js";

// Owner bug (11 Nov 2026): GH₵8.00 on credit to Juju, who already owes, with a plan on 19
// (GH₵60.00 each time, Every week, Next cycle) ended on "This screen could not load." with
// "The recorded sale has an invalid payment method." from 30 (SaleRecorded).
// These tests drive the real PosApp: real screens, route state, save handlers and writers.

const TODAY = localDateString();
const NEXT_WEEK = addDueCycles(TODAY, "weekly", 1);
const SCREEN_ERROR = "This screen could not load.";

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  resetBrowserBack();
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
});

async function seedDebt(name, amountPesewas) {
  await recordCreditSale({ name, amountPesewas, now: Date.now() - 3 * 86_400_000 });
}

// What the database holds for one customer.
async function ledger(name) {
  const lower = name.toLowerCase();
  const byName = (row) => (row.customer_name ?? row.customerName ?? "").trim().toLowerCase() === lower;
  const debts = (await db.debts.toArray()).filter(byName);
  const unpaid = debts.filter((debt) => debt.status === "unpaid");
  const transactions = (await db.transactions.toArray()).filter(byName);
  const payments = (await db.payments.toArray()).filter(byName);
  const customers = (await db.customers.toArray()).filter((row) => (row.nameLower ?? row.name.toLowerCase()) === lower);
  return {
    debts,
    unpaid,
    balancePesewas: unpaid.reduce((sum, debt) => sum + (debt.amountPesewas ?? debt.total_owed), 0),
    customerTotalPesewas: customers[0]?.totalDebtPesewas,
    customers,
    sales: transactions.filter((row) => row.paymentType === "credit"),
    collections: transactions.filter((row) => row.collectionType === "debt_collection"),
    payments
  };
}

async function open() {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  return app;
}

function assertNoScreenError(app) {
  assert.doesNotMatch(app.text(), new RegExp(SCREEN_ERROR), `${app.route} shows the error screen`);
  const renderErrors = app.errors.filter((args) => /failed to render/.test(String(args[0])));
  assert.deepEqual(renderErrors.map((args) => String(args[1]?.message ?? args[1])), []);
}

async function sell(app, digits) {
  await app.tap(/^Sell$/);
  await app.keys(digits.split(""));
}

async function chooseCustomer(app, name) {
  assert.equal(app.route, "WhoOwesYou");
  // The picker shows the initial and the name with a capital first letter ("amos" shows as "Amos").
  const shown = name.charAt(0).toUpperCase() + name.slice(1);
  await app.tap(new RegExp(`^${shown.charAt(0)}${shown}`));
  await app.tap(/^Next/);
  assert.equal(app.route, "WhenWillTheyPay");
}

// 19: each time, Every week, and either Next cycle or Today with a cash payment.
async function plan(app, { each, today } = {}) {
  await app.tap(/A little at a time/);
  assert.equal(app.route, "ALittleAtATime");
  await app.type("How much each time?", each);
  if (today) {
    await app.tap("Today");
    await app.type("Amount paid today", today);
  }
  await app.tap(/^Save plan$/);
}

function shown(app) {
  return app.text().replace(/\s+/g, " ");
}

// ---- Plain credit sale (15 > Owe): the flow ends on 31 ----

test("15 > Owe > 17 > 18 > 19, plan with Next cycle: ends on 31, the sale counted once", async () => {
  await seedDebt("Juju", 19620);
  const app = await open();
  await sell(app, "8");
  await app.tap("Owe");
  await chooseCustomer(app, "Juju");
  await plan(app, { each: "60" });
  assert.equal(app.route, "CreditSaved");
  assertNoScreenError(app);
  assert.match(shown(app), /Saved as credit/);
  assert.match(shown(app), /owes GH₵204\.20/);
  const data = await ledger("Juju");
  assert.equal(data.balancePesewas, 20420);
  assert.equal(data.customerTotalPesewas, 20420);
  assert.equal(data.sales.length, 2, "the old sale and this one");
  const sale = data.sales.find((row) => row.amountPesewas === 800);
  assert.equal(sale.payment_method, null, "nothing paid today: no payment method on the sale");
  assert.equal(sale.creditExtendedPesewas, 800);
  assert.equal(data.unpaid.length, 1, "added to Juju's existing debt");
  assert.equal(data.unpaid[0].isInstallmentPlan, true);
  assert.equal(data.unpaid[0].installmentAmount, 6000);
  assert.equal(data.unpaid[0].nextDueDate, NEXT_WEEK);
  assert.equal(data.payments.length, 0);
});

test("15 > Owe > 17 > 18 Save (In 1 week, no plan): ends on 31, the sale counted once", async () => {
  await seedDebt("Juju", 19620);
  const app = await open();
  await sell(app, "8");
  await app.tap("Owe");
  await chooseCustomer(app, "Juju");
  await app.tap(/^Save · Juju owes GH₵204\.20$/);
  assert.equal(app.route, "CreditSaved");
  assertNoScreenError(app);
  const data = await ledger("Juju");
  assert.equal(data.balancePesewas, 20420);
  assert.equal(data.sales.filter((row) => row.amountPesewas === 800).length, 1);
  assert.equal(data.unpaid[0].isInstallmentPlan ?? false, false);
});

test("15 > Owe > 19 with a payment today (Today, GH₵60.00 cash): ends on 31, sale, plan and payment once", async () => {
  await seedDebt("Juju", 19620);
  const app = await open();
  await sell(app, "8");
  await app.tap("Owe");
  await chooseCustomer(app, "Juju");
  await plan(app, { each: "60", today: "60" });
  assert.equal(app.route, "CreditSaved");
  assertNoScreenError(app);
  const data = await ledger("Juju");
  assert.equal(data.balancePesewas, 20420 - 6000);
  assert.equal(data.sales.filter((row) => row.amountPesewas === 800).length, 1);
  assert.equal(data.payments.reduce((sum, row) => sum + row.amountPesewas, 0), 6000, "today's GH₵60.00 recorded once");
  assert.equal(data.unpaid[0].nextDueDate, NEXT_WEEK);
});

// ---- Split sale (15 > Split payment > Owe, flow=split): 19 returns to 16 ----
// Where Done ends (wiring 16, 11 Nov 2026): money received today (Cash or MoMo above zero) -> 30
// Sale recorded; nothing received (the only part is Owe) -> 31 Saved as credit. Both start a fresh
// stack, so the phone back lands on Home, never on the split screen.

async function phoneBackLandsHome(app) {
  await app.phoneBack();
  assert.equal(app.route, "Home", "phone back after the result screen goes Home");
  assert.deepEqual(app.state.history, []);
  assert.doesNotMatch(app.text(), /Split payment/);
}

test("split, all owed, plan with Next cycle: Save plan returns to 16, Done ends on 31, saved once", async () => {
  await seedDebt("Juju", 19620);
  const app = await open();
  await sell(app, "8");
  await app.tap("Split payment");
  await app.tap(/^Owe$/);
  await chooseCustomer(app, "Juju");
  await plan(app, { each: "60" });
  assert.equal(app.route, "SplitPayment", "SAVE19 in flow=split returns to 16");
  assert.doesNotMatch(shown(app), /Left to pay/);
  assert.equal((await ledger("Juju")).sales.length, 1, "nothing is saved before Done on 16");
  await app.tap(/^Done$/);
  assert.equal(app.route, "CreditSaved", "nothing received today: Done on 16 goes to 31");
  assert.deepEqual(app.state.history, [], "31 starts a fresh stack");
  assertNoScreenError(app);
  assert.match(shown(app), /Saved as credit/);
  assert.match(shown(app), /owes GH₵204\.20/);
  assert.doesNotMatch(shown(app), /CashGH₵8\.00/, "the owed amount is not shown as cash");
  const saved = app.params.creditResult.saleTransaction;
  assert.equal(saved.payment_method, null, "nothing paid: no payment method on the sale");
  assert.equal(saved.paymentType, "credit");
  assert.equal(saved.creditExtendedPesewas, 800);
  const data = await ledger("Juju");
  assert.equal(data.balancePesewas, 20420);
  assert.equal(data.sales.filter((row) => row.amountPesewas === 800).length, 1);
  assert.equal(data.unpaid.length, 1);
  assert.equal(data.unpaid[0].installmentAmount, 6000);
  assert.equal(data.unpaid[0].nextDueDate, NEXT_WEEK);
  assert.equal(data.payments.length, 0);
  await phoneBackLandsHome(app);
  assert.equal((await ledger("Juju")).sales.filter((row) => row.amountPesewas === 800).length, 1, "still saved once");
});

test("split, all owed, no plan (18 Save): 16, then Done ends on 31, saved once", async () => {
  await seedDebt("Juju", 19620);
  const app = await open();
  await sell(app, "8");
  await app.tap("Split payment");
  await app.tap(/^Owe$/);
  await chooseCustomer(app, "Juju");
  await app.tap(/^Save · Juju owes/);
  assert.equal(app.route, "SplitPayment");
  await app.tap(/^Done$/);
  assert.equal(app.route, "CreditSaved");
  assertNoScreenError(app);
  assert.match(shown(app), /Saved as credit/);
  const data = await ledger("Juju");
  assert.equal(data.balancePesewas, 20420);
  assert.equal(data.sales.filter((row) => row.amountPesewas === 800).length, 1);
  await phoneBackLandsHome(app);
});

test("split, GH₵3.00 cash + GH₵5.00 owed with a plan: 30 shows Cash GH₵3.00 and the GH₵5.00 still owed", async () => {
  await seedDebt("Juju", 19620);
  const app = await open();
  await sell(app, "8");
  await app.tap("Split payment");
  await app.tap(/^Cash$/);
  await app.tap("Edit Cash amount");
  await app.type("split-draft-amount", "3.00");
  await app.tap(/^Save$/);
  await app.tap(/^Owe$/);
  await chooseCustomer(app, "Juju");
  await plan(app, { each: "60" });
  assert.equal(app.route, "SplitPayment");
  await app.tap(/^Done$/);
  assert.equal(app.route, "SaleRecorded");
  assertNoScreenError(app);
  assert.match(shown(app), /CashGH₵3\.00/);
  assert.match(shown(app), /Juju owesfrom this saleGH₵5\.00/);
  assert.match(shown(app), /Now owesGH₵(?!5\.00)\d/, "earlier balance: a Total owed key-value row");
  assert.doesNotMatch(shown(app), /CashGH₵8\.00/);
  const data = await ledger("Juju");
  assert.equal(data.balancePesewas, 19620 + 500);
  assert.equal(data.sales.filter((row) => row.amountPesewas === 800).length, 1);
  assert.equal(data.payments.reduce((sum, row) => sum + row.amountPesewas, 0), 300);
  await phoneBackLandsHome(app);
});

test("split, MoMo GH₵3.00 + GH₵5.00 owed: ends on 30 with MoMo and the GH₵5.00 still owed; phone back goes Home", async () => {
  await setPreference("momoReceivingNumber", "0241234567");
  await setPreference("momoReceivingNetwork", "MTN");
  await seedDebt("Juju", 19620);
  const app = await open();
  await sell(app, "8");
  await app.tap("Split payment");
  // The MoMo tile asks how much first (prefilled with Left to pay), then 61; Direct returns to 16
  // not confirmed yet, and 62 comes after Done (MOMO16).
  await app.tap(/^MoMo$/);
  await app.type("split-draft-amount", "3.00");
  await app.tap(/^Save$/);
  assert.equal(app.route, "MoMoChoice");
  await app.tap(/Customer sends to my number/);
  assert.equal(app.route, "SplitPayment");
  await app.tap(/^Owe$/);
  await chooseCustomer(app, "Juju");
  await app.tap(/^Save · Juju owes/);
  assert.equal(app.route, "SplitPayment");
  await app.tap(/^Done$/);
  assert.equal(app.route, "MoMoDirect");
  await app.tap("Money received");
  assert.equal(app.route, "SaleRecorded", "money received today: 30");
  assertNoScreenError(app);
  assert.match(shown(app), /MoMo[^G]{0,30}GH₵3\.00/, "the MoMo part with its amount");
  assert.doesNotMatch(shown(app), /CashGH₵/, "no cash part");
  assert.match(shown(app), /Juju owesfrom this saleGH₵5\.00/);
  const data = await ledger("Juju");
  assert.equal(data.sales.filter((row) => row.amountPesewas === 800).length, 1, "saved once");
  assert.equal(data.balancePesewas, 19620 + 500);
  await phoneBackLandsHome(app);
});

// ---- 4b: 19 shows the balance after this sale ----

for (const flow of ["plain", "split"]) {
  test(`4b (${flow}): old GH₵204.20 + GH₵8.00 on credit: 19 shows Owed and Maximum GH₵212.20, saved GH₵212.20 once`, async () => {
    await seedDebt("Juju", 20420);
    const app = await open();
    await sell(app, "8");
    if (flow === "split") {
      await app.tap("Split payment");
      await app.tap(/^Owe$/);
    } else {
      await app.tap("Owe");
    }
    await chooseCustomer(app, "Juju");
    await app.tap(/A little at a time/);
    assert.match(shown(app), /OwedGH₵212\.20/);
    assert.match(shown(app), /Maximum: GH₵212\.20/);
    // The plan check uses the same figure: GH₵212.20 each time is accepted, more is capped to it.
    await app.type("How much each time?", "300");
    assert.equal(app.input("How much each time?").props.value, "212.20");
    await app.type("How much each time?", "60");
    await app.tap(/^Save plan$/);
    if (flow === "split") await app.tap(/^Done$/);
    // Nothing received today: both flows end on 31.
    assert.equal(app.route, "CreditSaved");
    assertNoScreenError(app);
    const data = await ledger("Juju");
    assert.equal(data.balancePesewas, 21220, "old + this sale, once");
    assert.equal(data.customerTotalPesewas, 21220);
    assert.equal(data.sales.filter((row) => row.amountPesewas === 800).length, 1);
    assert.equal(data.unpaid[0].installmentsRemaining, Math.ceil(21220 / 6000));
  });
}

// ---- amos: an existing plan, a collection, then a GH₵5.00 credit sale paying GH₵20.00 today ----

test("amos through the app: GH₵5.00 sale, Today GH₵20.00 cash: ends on 31, balance GH₵834.00, saved once", async () => {
  const first = prepareInstallmentPlan({ amountPesewas: 85500, installmentAmountPesewas: 2000, frequency: "weekly", nextDueDate: NEXT_WEEK });
  const { debtId } = await recordCreditSale({ name: "amos", amountPesewas: 85500, installmentPlan: first.plan, now: Date.now() - 6 * 86_400_000 });
  await recordDebtCollection({ debtId, parts: [{ paymentMethod: "cash", amountPesewas: 600 }] });
  const app = await open();
  await sell(app, "5");
  await app.tap("Owe");
  await chooseCustomer(app, "amos");
  await app.tap(/A little at a time/);
  assert.match(shown(app), /OwedGH₵854\.00/);
  await app.type("How much each time?", "20");
  await app.tap("Today");
  await app.type("Amount paid today", "20");
  await app.tap(/^Save plan$/);
  assert.equal(app.route, "CreditSaved");
  assertNoScreenError(app);
  const data = await ledger("amos");
  assert.equal(data.balancePesewas, 83400);
  assert.equal(data.sales.filter((row) => row.amountPesewas === 500).length, 1);
  assert.equal(data.unpaid.length, 1);
  assert.equal(data.unpaid[0].nextDueDate, NEXT_WEEK);
  assert.equal(data.unpaid[0].installmentsRemaining, 42);
  assert.equal(data.unpaid[0].totalInstallments, 43);
  assert.equal(data.payments.reduce((sum, row) => sum + row.amountPesewas, 0), 600 + 2000);
});