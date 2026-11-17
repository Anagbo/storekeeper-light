import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { recordManualDebt } from "../src/db/debtLedger.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { loadJsx, render, textOf, walk } from "./helpers/renderJsx.js";

// Wiring 18 "Reason on 18" (16 Nov 2026), real PosApp: the "What for? (optional)" field with recent
// chips for a keypad sale and the Owe part of a split, saved on Save (18) or on Done (16), kept through
// 17, 19 and 16 and back; a read-only "For" row for items and for a debt added on 53.

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  resetBrowserBack();
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
  await recordCreditSale({ name: "Juju", amountPesewas: 500, now: Date.now() - 86_400_000 });
  await recordCreditSale({ name: "Ama", amountPesewas: 400, now: Date.now() - 86_400_000 });
});

async function open() {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  return app;
}

const reasonField = (app) => app.input("credit-reason");
const chips = (app) => [...walk(app.view.tree)].filter((node) => node.type === "button" && node.props?.["data-reason-chip"] !== undefined).map(textOf);
const forRow = (app) => {
  const row = [...walk(app.view.tree)].find((node) => node.props?.["data-credit-for"] !== undefined);
  return row ? textOf(row) : null;
};
const latestCredit = async (name) => (await db.transactions.toArray())
  .filter((row) => row.customer_name === name && row.paymentType === "credit")
  .sort((left, right) => right.createdAt - left.createdAt)[0];

async function to18(app, customer = /^JJuju/) {
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Owe");
  await app.tap(customer);
  await app.tap(/^Next/);
  assert.equal(app.route, "WhenWillTheyPay");
}

test("keypad sale: the reason typed on 18 is saved on the credit event", async () => {
  const app = await open();
  await to18(app);
  await app.type("credit-reason", "School fees");
  await app.tap(/^Save · /);
  const row = await latestCredit("Juju");
  assert.equal(row.amountPesewas, 800);
  assert.equal(row.creditReason, "School fees");
  assert.equal(row.note, "School fees · Juju");
});

test("keypad sale: the reason is optional, empty saves with no reason", async () => {
  const app = await open();
  await to18(app);
  assert.equal(reasonField(app).props.value, "");
  await app.tap(/^Save · /);
  const row = await latestCredit("Juju");
  assert.equal(row.amountPesewas, 800);
  assert.equal("creditReason" in row, false);
});

for (const [name, back] of [["on-screen Back", (app) => app.tap("Back")], ["phone back", (app) => app.phoneBack()]]) {
  test(`keypad sale: the reason survives 19 and ${name}, 17 and Next, another customer, and 15 and Owe`, async () => {
    const app = await open();
    await to18(app);
    await app.type("credit-reason", "Rice · beans");
    await app.tap(/^A little at a time/);
    assert.equal(app.route, "ALittleAtATime");
    await back(app);
    assert.equal(reasonField(app).props.value, "Rice · beans");
    await back(app);
    assert.equal(app.route, "WhoOwesYou");
    await app.tap(/^AAma/);
    await app.tap(/^Next/);
    assert.equal(reasonField(app).props.value, "Rice · beans", "kept with another customer");
    await back(app);
    await back(app);
    assert.equal(app.route, "Sell");
    await app.tap("Owe");
    await app.tap(/^AAma/);
    await app.tap(/^Next/);
    assert.equal(reasonField(app).props.value, "Rice · beans");
    await app.tap(/^Save · /);
    assert.equal((await latestCredit("Ama")).creditReason, "Rice · beans");
  });
}

test("keypad sale on a plan: Save plan on 19 saves the reason", async () => {
  const app = await open();
  await to18(app);
  await app.type("credit-reason", "Gas");
  await app.tap(/^A little at a time/);
  await app.type("How much each time?", "2.00");
  await app.tap(/^Save plan/);
  assert.equal((await latestCredit("Juju")).creditReason, "Gas");
});

test("split: the reason is held in the draft through 18, 19, 17 and 16, and saved on Done on 16", async () => {
  const app = await open();
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Split payment");
  assert.equal(app.route, "SplitPayment");
  await app.tap(/^Owe$/);
  await app.tap(/^JJuju/);
  await app.tap(/^Next/);
  await app.type("credit-reason", "Bread");
  await app.tap(/^A little at a time/);
  await app.tap("Back");
  await app.tap("Back");
  assert.equal(app.route, "WhoOwesYou");
  await app.tap("Back");
  assert.equal(app.route, "SplitPayment");
  await app.tap(/^Owe$/);
  await app.tap(/^JJuju/);
  await app.tap(/^Next/);
  assert.equal(reasonField(app).props.value, "Bread");
  await app.tap(/^Save · /);
  assert.equal(app.route, "SplitPayment");
  assert.equal((await db.transactions.toArray()).filter((row) => row.creditReason).length, 0, "nothing saved before Done");
  await app.tap("Remove Owe");
  await app.tap(/^Owe$/);
  await app.tap(/^JJuju/);
  await app.tap(/^Next/);
  assert.equal(reasonField(app).props.value, "Bread", "kept after 16 and back");
  await app.tap(/^Save · /);
  await app.tap(/^Done$/);
  const row = await latestCredit("Juju");
  assert.equal(row.amountPesewas, 800);
  assert.equal(row.creditReason, "Bread");
});

test("chips: the last three distinct reasons; a tap fills the field; hidden when none", async () => {
  const app = await open();
  await to18(app);
  assert.deepEqual(chips(app), [], "no typed reasons yet: no chips");
  const now = Date.now();
  await recordCreditSale({ name: "B", amountPesewas: 100, creditReason: "Rice", now: now - 40_000 });
  await recordManualDebt({ name: "C", amountPesewas: 100, note: "School fees", now: now - 30_000 });
  await recordCreditSale({ name: "D", amountPesewas: 100, creditReason: "rice", now: now - 20_000 });
  await recordCreditSale({ name: "E", amountPesewas: 100, creditReason: "Bread", now: now - 10_000 });
  await recordCreditSale({ name: "F", amountPesewas: 100, creditReason: "Gas", now: now - 50_000 });
  const again = await open();
  await to18(again);
  assert.deepEqual(chips(again), ["Bread", "rice", "School fees"]);
  await again.type("credit-reason", "Something else");
  await again.tap("School fees");
  assert.equal(reasonField(again).props.value, "School fees");
  await again.tap(/^Save · /);
  assert.equal((await latestCredit("Juju")).creditReason, "School fees");
});

test("53: no field on 18; a read-only For row with what was typed, or no row", async () => {
  const app = await open();
  await app.tap(/^Owed$/);
  await app.tap(/Add debt/);
  await app.tap(/^JJuju/);
  await app.tap(/^Next/);
  assert.equal(app.route, "ManualDebtAmount");
  await app.keys(["2", "5"]);
  await app.tap(/^Next/);
  assert.equal(app.route, "WhenWillTheyPay");
  assert.throws(() => reasonField(app));
  assert.equal(forRow(app), null);
  await app.tap("Back");
  const note = [...walk(app.view.tree)].find((node) => node.type === "input" && node.props?.placeholder === "What for? (optional)");
  note.props.onChange({ target: { value: "Old fridge" } });
  await app.settle();
  await app.tap(/^Next/);
  assert.equal(forRow(app), "ForOld fridge");
  assert.throws(() => reasonField(app));
});

test("sale with items: no field on 18; a read-only For row with the items", async () => {
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx");
  const view = render({ type: CreditScreens, props: {
    route: "WhenWillTheyPay",
    params: {
      amountPesewas: 1300,
      customer: { name: "Kofi", nameLower: "kofi" },
      saleItems: [
        { productId: 3, name: "Rice", quantity: 2, unitPricePesewas: 500, total_amount: 1000 },
        { productId: 4, name: "Water", quantity: 3, unitPricePesewas: 100, total_amount: 300 }
      ]
    },
    onBack() {}, onNavigate() {}, onUpdateParams() {}, onReturnToSplit() {}, onSaveCredit() {}
  } });
  const nodes = [...walk(view.tree)];
  assert.equal(nodes.some((node) => node.type === "input"), false);
  const row = nodes.find((node) => node.props?.["data-credit-for"] !== undefined);
  assert.equal(textOf(row), "ForRice × 2, Water × 3");
});
