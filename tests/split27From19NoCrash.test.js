import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { getInitialPaymentParts, getMomoAmountPesewas } from "../src/pos/paymentAmount.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { loadJsx, textOf, walk } from "./helpers/renderJsx.js";
import { SCREEN_ERROR, crashesOn } from "./helpers/screenSweep.js";

// Regression (12 Nov 2026, blocks the merge): 19 with MoMo as the single method, then the cash +
// MoMo split button, opened 27 on "This screen could not load." (RangeError: The MoMo amount cannot
// exceed the remaining payment, from getInitialPaymentParts while rendering 27).
// Cause: 19's own MoMo pick (61 Direct, since f6ce9f6) stays in 19's params with the amount it was
// picked at (pendingMomoAmountPesewas), and the split button passed it to 27 unchanged. When Amount
// paid today was changed after the pick (or the pick was made at the default from "How much each
// time?" and a smaller amount was typed), 27 got a MoMo amount above its total.
// Fix: 19 sends 27 the MoMo start from the amount paid today as it is now (only when MoMo is the
// chosen method), and getInitialPaymentParts never throws while rendering.

globalThis.HTMLElement ??= class {};

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

const nodes = (tree) => [...walk(tree)].filter((node) => node.props);
const shown = (app) => app.text().replace(/\s+/g, " ");
// The rows on 27 as shown (27 keeps its starting parts in its own state until they change).
const rowsOn27 = (app) => nodes(app.view.tree)
  .filter((node) => node.props["data-split-row"] !== undefined)
  .map((node) => `${node.props["data-split-row"] === "momo" ? "MoMo" : "Cash"} ${textOf(node).match(/GH₵[\d,.]+/)[0]}`);
const noCrash = (app, where) => assert.equal(crashesOn(app), null, `no error screen ${where}`);

// Sell GH₵8.00 > Owe > new customer > 18 > A little at a time (19).
async function newCustomerTo19(app) {
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Owe");
  await app.tap(/New person/);
  const nameInput = nodes(app.view.tree).find((node) => node.type === "input" && node.props.placeholder === "For example: Ama");
  nameInput.props.onChange({ target: { value: "Ama Owusu" } });
  await app.settle();
  await nodes(app.view.tree).find((node) => node.type === "form").props.onSubmit({ preventDefault() {} });
  await app.settle();
  assert.equal(app.route, "WhenWillTheyPay");
  await app.tap(/A little at a time/);
  assert.equal(app.route, "ALittleAtATime");
}

async function pickMomoDirect(app) {
  await app.tap(/^MoMo$/);
  assert.equal(app.route, "MoMoChoice");
  await app.tap(/^Customer sends to my number/);
  assert.equal(app.route, "ALittleAtATime");
}

// The single-method Paying today panel on 19: its rows and total.
function singlePanel(app) {
  const box = nodes(app.view.tree).find((node) => node.props["data-single-method-panel"] !== undefined);
  if (!box) return null;
  const rows = nodes(box).filter((node) => node.props["data-recorded-part"] !== undefined).map((row) => ({
    method: row.props["data-recorded-part"],
    status: textOf(nodes(row).find((node) => node.props["data-row-status"] !== undefined) ?? { props: {} }).trim(),
    text: textOf(row).replace(/\s+/g, " ").trim()
  }));
  const total = textOf(nodes(box).find((node) => node.props["data-total-today"] !== undefined)).match(/GH₵([\d,.]+)/)[1];
  return { rows, totalPesewas: Math.round(Number(total) * 100) };
}

async function savedPayments() {
  const rows = await db.payments.toArray();
  return rows.map((row) => ({ method: row.paymentMethod ?? row.payment_method, amountPesewas: row.amountPesewas ?? row.amount_pesewas }));
}

test("the exact phone scenario: 2.00 today, MoMo, then split: 27 opens with MoMo GH₵2.00 and no Cash row", async () => {
  const app = await open();
  await newCustomerTo19(app);
  await app.type("How much each time?", "2");
  await app.tap("Today");
  await app.type("Amount paid today", "2.00");
  await pickMomoDirect(app);
  await app.tap(/Split payment$/);
  assert.equal(app.route, "SplitPayment");
  noCrash(app, "on 27");
  assert.deepEqual(rowsOn27(app), ["MoMo GH₵2.00"]);
  assert.match(shown(app), /MoMoGH₵2\.00Status ?Not confirmed yet/);
  assert.doesNotMatch(shown(app), /Left to pay/);
  assert.equal(app.button(/^Done$/).props.disabled, false);
});

test("MoMo picked at the default from How much each time (4.00), then 2.00 typed: 27 opens with MoMo 2.00, the stale 4.00 is dropped", async () => {
  const app = await open();
  await newCustomerTo19(app);
  await app.type("How much each time?", "4");
  await app.tap("Today");
  await pickMomoDirect(app);
  assert.equal(app.params.pendingMomoAmountPesewas, 400, "the pick was made at the default 4.00");
  await app.type("Amount paid today", "2.00");
  assert.equal(singlePanel(app).totalPesewas, 200);
  await app.tap(/Split payment$/);
  assert.equal(app.route, "SplitPayment");
  noCrash(app, "on 27 (this is the crash)");
  assert.equal(app.params.splitTotalPesewas, 200);
  assert.deepEqual(rowsOn27(app), ["MoMo GH₵2.00"]);
  // The owner can still edit the parts: Back keeps nothing broken, the amount can change, 27 again.
  await app.tap("Back");
  assert.equal(app.route, "ALittleAtATime");
  noCrash(app, "after Back");
  await app.type("Amount paid today", "3.00");
  await app.tap(/Split payment$/);
  noCrash(app, "on 27 with 3.00");
  assert.deepEqual(rowsOn27(app), ["MoMo GH₵3.00"]);
});

test("MoMo picked, then Cash chosen, then split: the stale MoMo pick is not carried to 27", async () => {
  const app = await open();
  await newCustomerTo19(app);
  await app.type("How much each time?", "4");
  await app.tap("Today");
  await pickMomoDirect(app);
  await app.type("Amount paid today", "1.00");
  await app.tap(/^Cash$/);
  await app.tap(/Split payment$/);
  noCrash(app, "on 27");
  assert.deepEqual(rowsOn27(app), []);
  assert.match(shown(app), /Left to payGH₵1\.00/);
});

test("Amount paid today left blank (the How much each time amount is used): Cash, MoMo and split all use GH₵2.00, nothing throws, Save plan saves what the panel showed", async () => {
  const app = await open();
  await newCustomerTo19(app);
  await app.type("How much each time?", "2");
  await app.tap("Today");
  assert.equal(app.input("Amount paid today").props.value, "2", "the field shows the default");
  assert.equal(app.params.todayPaymentAmount, undefined, "nothing typed");

  await app.tap(/^Cash$/);
  assert.deepEqual(singlePanel(app), { rows: [{ method: "cash", status: "", text: "CashGH₵2.00" }], totalPesewas: 200 });

  await pickMomoDirect(app);
  noCrash(app, "after MoMo");
  const panel = singlePanel(app);
  assert.equal(panel.totalPesewas, 200);
  assert.deepEqual(panel.rows.map(({ method, status }) => ({ method, status })), [{ method: "momo", status: "Customer sends · not confirmed yet" }]);

  await app.tap(/Split payment$/);
  noCrash(app, "on 27");
  assert.equal(app.params.splitTotalPesewas, panel.totalPesewas, "27's total is the panel's amount");
  assert.deepEqual(rowsOn27(app), ["MoMo GH₵2.00"]);
  await app.tap("Back");
  assert.equal(app.route, "ALittleAtATime");
  // Back to the single MoMo method and save.
  await pickMomoDirect(app);
  assert.equal(singlePanel(app).totalPesewas, 200);
  await app.tap(/^Save plan$/);
  assert.equal(app.route, "MoMoDirect");
  assert.match(shown(app), /send ?GH₵2\.00/);
  await app.tap(/^Money received$/);
  assert.equal(app.route, "CreditSaved");
  assert.deepEqual(await savedPayments(), [{ method: "momo", amountPesewas: panel.totalPesewas }], "saved = the panel amount");
});

test("Amount paid today left blank, Cash: Save plan saves the default the panel showed", async () => {
  const app = await open();
  await newCustomerTo19(app);
  await app.type("How much each time?", "2");
  await app.tap("Today");
  await app.tap(/^Cash$/);
  const panel = singlePanel(app);
  assert.equal(panel.totalPesewas, 200);
  await app.tap(/^Save plan$/);
  assert.equal(app.route, "CreditSaved");
  assert.deepEqual(await savedPayments(), [{ method: "cash", amountPesewas: panel.totalPesewas }]);
});

test("19 single MoMo row in the Paying today panel shows the split panel's status line", async () => {
  const app = await open();
  await newCustomerTo19(app);
  await app.type("How much each time?", "2");
  await app.tap("Today");
  await app.type("Amount paid today", "2.00");
  await pickMomoDirect(app);
  const panel = singlePanel(app);
  assert.equal(panel.rows.length, 1);
  assert.equal(panel.rows[0].method, "momo");
  assert.equal(panel.rows[0].status, "Customer sends · not confirmed yet");
  // Same line as the MoMo row of the split panel on 19 after 27.
  await app.tap(/Split payment$/);
  await app.tap(/^Done$/);
  assert.equal(app.route, "ALittleAtATime");
  const splitRow = nodes(app.view.tree).find((node) => node.props["data-recorded-part"] === "momo");
  assert.equal(textOf(nodes(splitRow).find((node) => node.props["data-row-status"] !== undefined)).trim(), "Customer sends · not confirmed yet");
});

// ---- getInitialPaymentParts: safe starting parts, never a throw while rendering ------------------

test("getInitialPaymentParts clamps a MoMo amount above the total and never throws", () => {
  const momo = { momoMethod: "direct" };
  assert.deepEqual(getInitialPaymentParts({ ...momo, pendingMomoAmountPesewas: 400 }, 200),
    [{ paymentMethod: "momo", amountPesewas: 200, momoMethod: "direct", verification: undefined }]);
  // Cash already there: MoMo gets at most what is left.
  assert.deepEqual(getInitialPaymentParts({ ...momo, pendingMomoAmountPesewas: 400, splitParts: [{ paymentMethod: "cash", amountPesewas: 150 }] }, 200),
    [{ paymentMethod: "cash", amountPesewas: 150 }, { paymentMethod: "momo", amountPesewas: 50, momoMethod: "direct", verification: undefined }]);
  // Parts from an earlier, larger amount are dropped; the MoMo pick is then clamped.
  assert.deepEqual(getInitialPaymentParts({ ...momo, pendingMomoAmountPesewas: 400, splitParts: [{ paymentMethod: "cash", amountPesewas: 500 }] }, 200),
    [{ paymentMethod: "momo", amountPesewas: 200, momoMethod: "direct", verification: undefined }]);
  assert.deepEqual(getInitialPaymentParts({ splitParts: [{ paymentMethod: "cash", amountPesewas: 500 }] }, 200), []);
  // Invalid parts are dropped instead of throwing.
  assert.deepEqual(getInitialPaymentParts({ splitParts: [{ paymentMethod: "cash", amountPesewas: -1 }, { paymentMethod: "cash", amountPesewas: 1.5 }, null] }, 200), []);
  // Total zero or missing, odd pending values: no throw.
  for (const total of [0, undefined, NaN, -5]) {
    assert.doesNotThrow(() => getInitialPaymentParts({ ...momo, pendingMomoAmountPesewas: 400, splitParts: [{ paymentMethod: "cash", amountPesewas: 100 }] }, total));
  }
  for (const pending of [0, -1, 1.5, "200", null, Number.MAX_SAFE_INTEGER]) {
    assert.doesNotThrow(() => getInitialPaymentParts({ ...momo, pendingMomoAmountPesewas: pending }, 200));
  }
  // Unchanged behaviour: a valid pick within the total, parts that already add up.
  assert.deepEqual(getInitialPaymentParts({ ...momo, pendingMomoAmountPesewas: 50, splitParts: [{ paymentMethod: "cash", amountPesewas: 100 }] }, 200),
    [{ paymentMethod: "cash", amountPesewas: 100 }, { paymentMethod: "momo", amountPesewas: 50, momoMethod: "direct", verification: undefined }]);
  const full = [{ paymentMethod: "cash", amountPesewas: 200 }];
  assert.deepEqual(getInitialPaymentParts({ ...momo, pendingMomoAmountPesewas: 50, splitParts: full }, 200), full);
});

test("the save-time check still throws for a real mistake (getMomoAmountPesewas)", () => {
  assert.throws(() => getMomoAmountPesewas({ splitTotalPesewas: 200, pendingMomoAmountPesewas: 400 }), /cannot exceed the remaining payment/);
});

// ---- The error screen ---------------------------------------------------------------------------

test("error screen: Go back calls the screen's Back; Try again is offered once, not again after it fails the same way", async () => {
  const { default: PosErrorBoundary } = await loadJsx("src/pos/PosErrorBoundary.jsx");
  let backs = 0;
  const boundary = new PosErrorBoundary({ children: null, onBack: () => { backs += 1; } });
  boundary.setState = (update) => { boundary.state = { ...boundary.state, ...update }; };
  boundary.state = { ...boundary.state, ...PosErrorBoundary.getDerivedStateFromError(new Error("boom")) };
  const buttons = (tree) => nodes(tree).filter((node) => node.type === "button");
  let tree = boundary.render();
  assert.match(textOf(tree), new RegExp(SCREEN_ERROR.replace(".", "\\.")));
  assert.deepEqual(buttons(tree).map((node) => textOf(node)), ["Go back", "Try again"]);
  buttons(tree).find((node) => textOf(node) === "Go back").props.onClick();
  assert.equal(backs, 1);
  // Try again renders the screen again; the same crash comes back: only Go back is left.
  buttons(tree).find((node) => textOf(node) === "Try again").props.onClick();
  assert.equal(boundary.state.error, null);
  boundary.state = { ...boundary.state, ...PosErrorBoundary.getDerivedStateFromError(new Error("boom")) };
  tree = boundary.render();
  assert.deepEqual(buttons(tree).map((node) => textOf(node)), ["Go back"]);
});

test("PosApp gives the error screen the same Back as the screen (navigateBack keeps the draft)", () => {
  const source = readFileSync(new URL("../src/pos/PosApp.jsx", import.meta.url), "utf8");
  // The key is built from the route and pickRemount; the exact key expression may change with wide layouts.
  assert.match(source, /<PosErrorBoundary key=\{[^\n]*\bpickRemount\b[^\n]*\} onBack=\{navigateBack\}>/);
});
