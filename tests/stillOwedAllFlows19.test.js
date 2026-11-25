import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { textOf, walk } from "./helpers/renderJsx.js";

// Wiring 19 "Still owed row, all flows" (12 Nov 2026, phone test): the pink "Still owed · {Name}"
// row shows whenever the Paying today panel is shown and something remains owed after today's
// payment, in every flow. Amount = the customer's balance after this sale and today's payment
// (the figure 31 shows as "owes"). Absent when today's payment settles everything, and absent on
// Next cycle (no panel).

globalThis.HTMLElement ??= class {};

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  resetBrowserBack();
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
  await setPreference("momoReceivingNumber", "0241234567");
  await setPreference("momoReceivingNetwork", "MTN");
});

const cedis = (text) => Math.round(Number(text.replace(/[^0-9.]/g, "")) * 100);
const nodes = (tree) => [...walk(tree)].filter((node) => node.props);
const shown = (app) => app.text().replace(/\s+/g, " ");

async function open() {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  return app;
}

function panel(app) {
  const box = nodes(app.view.tree).find((node) => node.props["data-paying-today"] !== undefined && /Paying today/.test(textOf(node)));
  if (!box) return null;
  const total = nodes(box).find((node) => node.props["data-total-today"] !== undefined);
  const owed = nodes(box).find((node) => node.props["data-still-owed"] !== undefined);
  const amountOf = (node) => cedis(textOf(node).match(/GH₵[\d,.]+/g).at(-1));
  return {
    total: total ? amountOf(total) : null,
    owedText: owed ? textOf(owed).replace(/\s+/g, " ").trim() : null,
    owedPesewas: owed ? amountOf(owed) : null,
    owedClass: owed?.props.className ?? ""
  };
}

// The Owed figure at the top of 19.
function owedAtTop(app) {
  return cedis(shown(app).match(/A little at a timeOwed\s*(GH₵[\d,.]+)/)[1]);
}

// Sell GH₵8.00 on credit to a new customer typed "KOFI MENSAH", then 19 with an amount each time.
async function newCustomerTo19(app) {
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Owe");
  await app.tap(/New person/);
  assert.equal(app.route, "NewPerson");
  const nameInput = nodes(app.view.tree).find((node) => node.type === "input" && node.props.placeholder === "For example: Ama");
  nameInput.props.onChange({ target: { value: "KOFI MENSAH" } });
  await app.settle();
  const form = nodes(app.view.tree).find((node) => node.type === "form");
  await form.props.onSubmit({ preventDefault() {} });
  await app.settle();
  assert.equal(app.route, "WhenWillTheyPay");
  await app.tap(/A little at a time/);
  assert.equal(app.route, "ALittleAtATime");
  await app.type("How much each time?", "2");
}

async function payTodaySplit(app, cash, momo) {
  await app.tap("Today");
  await app.type("Amount paid today", ((cedis(cash) + cedis(momo)) / 100).toFixed(2));
  await app.tap(/Split payment$/);
  assert.equal(app.route, "SplitPayment");
  await app.tap(/^Cash$/);
  await app.tap("Edit Cash amount");
  await app.type("split-draft-amount", cash);
  await app.tap(/^Save$/);
  await app.tap(/^MoMo$/);
  await app.type("split-draft-amount", momo);
  await app.tap(/^Save$/);
  await app.tap(/^Customer sends to my number/);
  await app.tap(/^Done$/);
  assert.equal(app.route, "ALittleAtATime");
}

test("phone repro: GH₵8.00 to KOFI MENSAH, 2.00 today split Cash 1.00 + MoMo 1.00: pink Still owed · Kofi Mensah GH₵6.00, saved balance 6.00 = 31", async () => {
  const app = await open();
  await newCustomerTo19(app);
  assert.equal(owedAtTop(app), 800);
  await payTodaySplit(app, "1.00", "1.00");
  const box = panel(app);
  assert.ok(box, "Paying today panel shown");
  assert.equal(box.total, 200);
  assert.equal(box.owedText, "Still owed · Kofi MensahGH₵6.00");
  assert.equal(box.owedPesewas, owedAtTop(app) - box.total);
  assert.match(box.owedClass, /bg-white/, "neutral Still owed row inside the soft tile (24 Nov 2026)");

  await app.tap(/^Save plan$/);
  if (app.route === "MoMoDirect") await app.tap("Money received");
  assert.equal(app.route, "CreditSaved");
  const owes31 = cedis(shown(app).match(/owes (GH₵[\d,.]+)/)[1]);
  assert.equal(owes31, 600, "31 owes");
  const unpaid = (await db.debts.toArray()).filter((debt) => debt.status !== "paid");
  const balance = unpaid.reduce((sum, debt) => sum + (debt.amountPesewas ?? debt.total_owed), 0);
  assert.equal(balance, 600, "stored balance");
  assert.equal(box.owedPesewas, owes31);
});

test("today's payment by cash only also shows the pink row (8.00 sale, 3.00 cash: 5.00)", async () => {
  const app = await open();
  await newCustomerTo19(app);
  await app.tap("Today");
  await app.type("Amount paid today", "3");
  await app.tap(/Split payment$/);
  await app.tap(/^Cash$/);
  await app.tap("Edit Cash amount");
  await app.type("split-draft-amount", "3.00");
  await app.tap(/^Save$/);
  await app.tap(/^Done$/);
  const box = panel(app);
  assert.ok(box);
  assert.equal(box.total, 300);
  assert.equal(box.owedPesewas, 500);
});

test("a payment that settles the whole balance shows no pink row", async () => {
  const app = await open();
  await newCustomerTo19(app);
  await app.type("How much each time?", "8");
  await payTodaySplit(app, "5.00", "3.00");
  const box = panel(app);
  assert.ok(box);
  assert.equal(box.total, 800);
  assert.equal(box.owedText, null);
});

test("Next cycle shows no Paying today panel and no pink row", async () => {
  const app = await open();
  await newCustomerTo19(app);
  await app.tap(/^Next cycle/);
  assert.equal(panel(app), null);
  assert.equal(nodes(app.view.tree).some((node) => node.props["data-still-owed"] !== undefined), false);
});

test("split from 16 with an existing debt: the pink row is the balance after the sale (= Owed at the top of 19)", async () => {
  await recordCreditSale({ name: "juju", amountPesewas: 1000, now: Date.now() - 3 * 86_400_000 });
  const app = await open();
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Split payment");
  await app.tap(/^Cash$/);
  await app.tap("Edit Cash amount");
  await app.type("split-draft-amount", "4.00");
  await app.tap(/^Save$/);
  await app.tap(/^Owe$/);
  await app.tap(/^JJuju/);
  await app.tap(/^Next/);
  await app.tap(/A little at a time/);
  // 10.00 before + 8.00 sale - 4.00 cash on 16 = 14.00, already net of 16's payment.
  assert.equal(owedAtTop(app), 1400);
  const box = panel(app);
  assert.equal(box.total, 400);
  assert.equal(box.owedText, "Still owed · JujuGH₵14.00");
});
