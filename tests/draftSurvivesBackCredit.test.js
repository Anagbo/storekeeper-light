import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { textOf, walk } from "./helpers/renderJsx.js";

// Wiring 34, 19, 27 "Draft survives Back" and draft_survives_trip_away (decided 12 Nov 2026, reported
// on the phone): in the credit sale flow 15 > 17 > 34 > 18 > 19 > 27 everything the owner typed or
// chose is kept when they go Back and return, in the route parameters. Cleared only by Done / Save
// plan, header Home, another tab or Leave. Driven through the real PosApp screens.

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  resetBrowserBack();
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
  await db.settings.put({ key: "momoReceivingNumber", value: "0241234567" });
  await db.settings.put({ key: "momoReceivingNetwork", value: "MTN" });
});

async function open() {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  return app;
}

const ERROR_BOX = "Enter the customer's name and a valid amount.";
const shown = (app) => app.text().replace(/\s+/g, " ");
const byPlaceholder = (app, placeholder) => [...walk(app.view.tree)].find((node) => node.type === "input" && node.props?.placeholder === placeholder);
const amountOwedInput = (app) => [...walk(app.view.tree)].find((node) => node.type === "input" && node.props?.type === "number");
const dateInput = (app) => [...walk(app.view.tree)].find((node) => node.type === "input" && node.props?.type === "date");
const partsOf = (app) => (app.params.splitParts ?? []).map((part) => [part.paymentMethod, part.amountPesewas, part.momoMethod ?? null]);
const rows = (app) => [...walk(app.view.tree)].filter((node) => node.props?.["data-split-row"] !== undefined).map((node) => node.props["data-split-row"]);

async function typeInto(app, input, value) {
  input.props.onChange({ target: { value } });
  return app.settle();
}
async function submit34(app) {
  [...walk(app.view.tree)].find((node) => node.type === "form").props.onSubmit({ preventDefault() {} });
  return app.settle();
}

// 15 GH₵8.00 > Owe > 17 > New person (34), name and phone typed.
async function to34(app) {
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Owe");
  assert.equal(app.route, "WhoOwesYou");
  await app.tap(/New person/);
  assert.equal(app.route, "NewPerson");
  await typeInto(app, byPlaceholder(app, "e.g. Kofi Mensah"), "KOFI MENSAH");
  await typeInto(app, byPlaceholder(app, "024 000 0000"), "0241112223");
  await typeInto(app, byPlaceholder(app, "GHA-000000000-0"), "GHA-123456789-0");
}

function assert34Filled(app) {
  assert.equal(app.route, "NewPerson");
  assert.equal(byPlaceholder(app, "e.g. Kofi Mensah").props.value, "KOFI MENSAH");
  assert.equal(byPlaceholder(app, "024 000 0000").props.value, "0241112223");
  assert.equal(byPlaceholder(app, "GHA-000000000-0").props.value, "GHA-123456789-0");
  assert.ok(!shown(app).includes(ERROR_BOX), "no error box on a returning form");
}

// 34 > Next > 18 > A little at a time > 19: 2.00 each time, Every 2 weeks, Today, 3.00 paid today.
async function to19(app) {
  await to34(app);
  await submit34(app);
  assert.equal(app.route, "WhenWillTheyPay");
  await app.tap(/^A little at a time/);
  assert.equal(app.route, "ALittleAtATime");
  await app.type("How much each time?", "2.00");
  await app.tap("Every 2 weeks");
  await app.tap("Today");
  await app.type("Amount paid today", "3.00");
}

function assert19Filled(app, expectedDate) {
  assert.equal(app.route, "ALittleAtATime");
  assert.equal(app.input("How much each time?").props.value, "2.00");
  assert.equal(app.button("Every 2 weeks").props["aria-pressed"], true);
  assert.equal(app.button("Today").props["aria-pressed"], true);
  assert.equal(app.input("Amount paid today").props.value, "3.00");
  assert.equal(dateInput(app).props.value, expectedDate);
}

for (const [name, back] of [["on-screen Back", (app) => app.tap("Back")], ["phone back", (app) => app.phoneBack()]]) {
  test(`34: Name, Phone and Ghana Card survive Next > 18 > ${name} to 34, with no error box`, async () => {
    const app = await open();
    await to34(app);
    await submit34(app);
    assert.equal(app.route, "WhenWillTheyPay");
    await back(app);
    assert34Filled(app);
    // And forward again carries the same customer.
    await submit34(app);
    assert.equal(app.route, "WhenWillTheyPay");
    assert.equal(app.params.customer.name, "KOFI MENSAH");
  });

  test(`19: every input survives ${name} to 18 and A little at a time again, and ${name} twice to 34`, async () => {
    const app = await open();
    await to19(app);
    await dateInput(app).props.onChange({ target: { value: "2099-03-07" } });
    await app.settle();
    await back(app);
    assert.equal(app.route, "WhenWillTheyPay");
    await app.tap(/^A little at a time/);
    assert19Filled(app, "2099-03-07");
    await back(app);
    await back(app);
    assert34Filled(app);
    await submit34(app);
    await app.tap(/^A little at a time/);
    assert19Filled(app, "2099-03-07");
  });
}

// Wiring 34 "No amount field on 34" (15 Nov 2026): the amount is the sale's, not typed, and is the
// same after Next > 18 > Back.
test("34: no Amount owed field; the sale's amount is kept through Next > 18 > Back", async () => {
  const app = await open();
  await to34(app);
  assert.equal(amountOwedInput(app), undefined);
  await submit34(app);
  assert.equal(app.params.amountPesewas, 800);
  await app.tap("Back");
  assert.equal(amountOwedInput(app), undefined);
  assert.match(shown(app), /Owes from this sale: GH₵8\.00/);
});

test("34: the error box shows only after Next with a problem, and not on return", async () => {
  const app = await open();
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Owe");
  await app.tap(/New person/);
  assert.ok(!shown(app).includes(ERROR_BOX), "fresh form: no error box");
  await submit34(app);
  assert.ok(shown(app).includes(ERROR_BOX), "Next with no name: the error box");
  await typeInto(app, byPlaceholder(app, "e.g. Kofi Mensah"), "KOFI MENSAH");
  await submit34(app);
  await app.tap("Back");
  assert.equal(app.route, "NewPerson");
  assert.ok(!shown(app).includes(ERROR_BOX), "returning form: no error box");
});

test("19: the chosen method (MoMo picked) survives Back to 18 and forward again", async () => {
  const app = await open();
  await to19(app);
  await app.tap(/^MoMo$/);
  await app.tap(/^Customer sends to my number/);
  assert.equal(app.route, "ALittleAtATime");
  assert.equal(app.button(/^MoMo$/).props["aria-pressed"], true);
  await app.tap("Back");
  await app.tap(/^A little at a time/);
  assert.equal(app.button(/^MoMo$/).props["aria-pressed"], true);
  assert.equal(app.input("Amount paid today").props.value, "3.00");
});

// 19 > Split payment (27) > Cash 1.00 + MoMo 2.00 Direct.
async function split27(app) {
  await app.tap("Split payment");
  assert.equal(app.route, "SplitPayment");
  await app.tap(/^Cash$/);
  await app.tap("Edit Cash amount");
  await app.type("split-draft-amount", "1.00");
  await app.tap(/^Save$/);
  await app.tap(/^MoMo$/);
  await app.type("split-draft-amount", "2.00");
  await app.tap(/^Save$/);
  await app.tap(/^Customer sends to my number/);
  assert.equal(app.route, "SplitPayment");
  assert.deepEqual(partsOf(app), [["cash", 100, null], ["momo", 200, "direct"]]);
}

for (const [name, back] of [["on-screen Back", (app) => app.tap("Back")], ["phone back", (app) => app.phoneBack()]]) {
  test(`27 from 19: Cash and MoMo parts survive ${name} to 19 and Split payment again`, async () => {
    const app = await open();
    await to19(app);
    const date = dateInput(app).props.value;
    await split27(app);
    await back(app);
    assert19Filled(app, date);
    assert.equal(app.params.firstPaymentParts, undefined, "Back is not Done: nothing recorded on 19");
    await app.tap("Split payment");
    assert.equal(app.route, "SplitPayment");
    assert.deepEqual(rows(app), ["cash", "momo"]);
    assert.deepEqual(partsOf(app), [["cash", 100, null], ["momo", 200, "direct"]]);
    assert.equal((await db.transactions.toArray()).length, 0);
  });
}

test("27 from 19: the parts also survive 19 > Back to 18 > forward > Split payment", async () => {
  const app = await open();
  await to19(app);
  await split27(app);
  await app.tap("Back");
  await app.tap("Back");
  await app.tap(/^A little at a time/);
  await app.tap("Split payment");
  assert.deepEqual(rows(app), ["cash", "momo"]);
});

test("27 from 19: a changed Amount paid today clears the parts and 27 starts with the new amount", async () => {
  const app = await open();
  await to19(app);
  await split27(app);
  await app.tap("Back");
  await app.type("Amount paid today", "4.00");
  await app.tap("Split payment");
  assert.equal(app.route, "SplitPayment");
  assert.deepEqual(rows(app), []);
  assert.match(shown(app), /Left to payGH₵4\.00/);
});

test("Save plan ends the task: a new credit sale starts with empty 34 and 19", async () => {
  const app = await open();
  await to19(app);
  await app.tap(/^Cash$/);
  await app.tap("Save plan");
  assert.equal(app.route, "CreditSaved");
  await app.tap(/^Done$/);
  await app.tap(/^Sell$/);
  await app.keys(["5"]);
  await app.tap("Owe");
  await app.tap(/New person/);
  assert.equal(byPlaceholder(app, "e.g. Kofi Mensah").props.value, "");
  assert.equal(byPlaceholder(app, "024 000 0000").props.value, "");
  await typeInto(app, byPlaceholder(app, "e.g. Kofi Mensah"), "Ama");
  await submit34(app);
  await app.tap(/^A little at a time/);
  assert.equal(app.input("How much each time?").props.value, "");
  assert.equal(app.button("Today").props["aria-pressed"], false);
});

test("header Home clears everything: a new credit sale starts empty", async () => {
  const app = await open();
  await to19(app);
  await split27(app);
  await app.tap("Back");
  await app.tap(/^Home$/);
  assert.equal(app.route, "Home");
  assert.equal(app.state.history.length, 0);
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Owe");
  await app.tap(/New person/);
  assert.equal(byPlaceholder(app, "e.g. Kofi Mensah").props.value, "");
});

test("27 from 19: reopened parts, Done, Save plan, Money received: saved once with those parts", async () => {
  const app = await open();
  await to19(app);
  await split27(app);
  await app.tap("Back");
  await app.tap("Split payment");
  await app.tap(/^Done$/);
  assert.equal(app.route, "ALittleAtATime");
  assert.equal(app.params.installmentSplitDraft, undefined, "Done records the parts: no kept draft left");
  await app.tap("Save plan");
  assert.equal(app.route, "MoMoDirect");
  await app.tap(/^Money received$/);
  assert.equal(app.route, "CreditSaved");
  const payments = await db.payments.toArray();
  const debts = await db.debts.toArray();
  assert.equal(debts.length, 1);
  assert.equal(payments.reduce((sum, payment) => sum + (payment.amountPesewas ?? 0), 0), 300, "Cash 1.00 + MoMo 2.00 once");
});

test("27 from 19: a received (locked) MoMo part kept after Back stays locked and leaving 19 asks", async () => {
  const { backRoute, getLeaveOnBackRoute, getReceivedMomoInDraft } = await import("../src/pos/routes.js");
  const locked = { paymentMethod: "momo", amountPesewas: 200, momoMethod: "direct", verification: "merchant_confirmed" };
  const nineteen = { amountPesewas: 800, customer: { name: "Kofi", nameLower: "kofi" }, startToday: true, todayPaymentAmount: "3.00" };
  const state = {
    current: "SplitPayment",
    params: { ...nineteen, installmentSplit: true, splitTotalPesewas: 300, splitParts: [{ paymentMethod: "cash", amountPesewas: 100 }, locked] },
    history: [{ current: "Sell", params: {} }, { current: "ALittleAtATime", params: nineteen }]
  };
  const on19 = backRoute(state);
  assert.equal(on19.current, "ALittleAtATime");
  assert.deepEqual(on19.params.installmentSplitDraft.splitParts[1], locked, "the lock is kept on the part");
  assert.equal(getReceivedMomoInDraft(on19), 200);
  assert.equal(getLeaveOnBackRoute(on19), "Sell", "Back from 19 asks first, Leave starts an empty 15");
});
