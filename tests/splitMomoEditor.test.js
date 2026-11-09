import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCashSale } from "../src/db/sales.js";
import { recordCreditSale, recordDebtCollection } from "../src/db/debts.js";
import { recordManualDebt } from "../src/db/debtLedger.js";
import { validateBackupData } from "../src/utils/backup.js";
import { applyMomoPick } from "../src/pos/paymentAmount.js";
import { POS_ROUTES, backRoute, createRouteState, pushRoute, replaceRoute, returnFromMomoPickState } from "../src/pos/routes.js";
import { setPartAmount } from "../src/pos/splitTender.js";
import { findButton, flushEffects, loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Batch 17, commit 2 (brief 3.8 rules 2 and 4): tapping MoMo asks how much first; the confirmed amount
// (confirmedPesewas) rides on the row; raising above it sends only the extra to 62; lowering keeps the
// saved record matching and records what was confirmed; a verified row cannot be edited or removed.
after(async () => {
  setLiveQuery(null);
  db.close();
  await db.delete();
});
beforeEach(async () => {
  await Promise.all([db.settings, db.debts, db.customers, db.transactions, db.payments].map((table) => table.clear()));
  await db.settings.put({ key: "momoReceivingNumber", value: "0241234567" });
  await db.settings.put({ key: "momoReceivingNetwork", value: "MTN" });
});

const settle = async () => { for (let index = 0; index < 8; index += 1) await new Promise((resolve) => setImmediate(resolve)); };
const direct = { momoMethod: "direct", verification: "merchant_confirmed" };
const momoRow = (amountPesewas, confirmedPesewas = amountPesewas) => ({ paymentMethod: "momo", amountPesewas, ...direct, confirmedPesewas });
const exactButtons = (tree, label) => [...walk(tree)].filter((node) => node.type === "button" && textOf(node) === label);
const tileOf = (tree, label) => exactButtons(tree, label).at(-1);          // the tiles come after the rows
const rowOf = (tree, label) => [...walk(tree)].find((node) => node.type === "button" && textOf(node).startsWith(label));
const removeButton = (tree, method) => [...walk(tree)].find((node) => node.type === "button" && node.props?.["aria-label"] === `Remove ${method}`);
const editorInput = (tree) => [...walk(tree)].find((node) => node.type === "input");

function makeApp(initialParams) {
  const app = { state: createRouteState(POS_ROUTES.SplitPayment, initialParams), saved: [] };
  app.navigate = (route, params = {}) => { app.state = pushRoute(app.state, route, params); };
  app.back = () => { app.state = backRoute(app.state); };
  app.updateParams = (params) => { app.state = replaceRoute(app.state, app.state.current, { ...app.state.params, ...params }); };
  app.returnFromPick = (details) => { app.state = returnFromMomoPickState(app.state, details); };
  return app;
}
async function mountFor(app) {
  const { default: SaleSplitPayment } = await loadJsx("src/pos/SaleSplitPayment.jsx");
  return () => render({ type: SaleSplitPayment, props: {
    params: app.state.params, onBack: app.back, onNavigate: app.navigate, onUpdateParams: app.updateParams,
    onSaveSale: async (details) => { app.saved.push(details); }
  } });
}
async function run61And62(app) {
  const { MoMoChoice, MoMoDirect } = await loadJsx("src/pos/MoMoScreens.jsx");
  const v61 = render({ type: MoMoChoice, props: { params: app.state.params, onBack() {}, onNavigate: app.navigate, onReplace() {} } });
  findButton(v61.tree, "Customer sends to my number").props.onClick();
  let picked;
  const v62 = render({ type: MoMoDirect, props: { params: app.state.params, onBack() {}, onConfirm() {}, onPick: (details) => { picked = details; } } });
  flushEffects(v62);
  for (let attempt = 0; attempt < 100 && findButton(v62.tree, "Money received").props.disabled; attempt += 1) {
    await settle();
    v62.rerender();
  }
  const asked = textOf(v62.tree);
  findButton(v62.tree, "Money received").props.onClick();
  await settle();
  app.returnFromPick(picked);
  return asked;
}
function openEditor(view, tileLabel) {
  tileOf(view.tree, tileLabel).props.onClick();
  view.rerender();
}
function typeAndSave(view, value) {
  editorInput(view.tree).props.onChange({ target: { value } });
  view.rerender();
  findButton(view.tree, "Save").props.onClick();
  view.rerender();
}

// ---- the editor comes first ---------------------------------------------------------------------

test("GH₵60: Cash 20, then MoMo opens the editor at GH₵40; 20 goes to 61 and 62; Owe then uses the new Left", async () => {
  const app = makeApp({ amountPesewas: 6000 });
  const mount = await mountFor(app);
  let view = mount();
  tileOf(view.tree, "Cash").props.onClick();
  view.rerender();
  rowOf(view.tree, "Cash").props.onClick();
  view.rerender();
  typeAndSave(view, "20.00");
  openEditor(view, "MoMo");
  assert.equal(app.state.current, POS_ROUTES.SplitPayment, "the tile does not go to 61 yet");
  assert.match(textOf(view.tree), /How much MoMo\?/);
  assert.equal(editorInput(view.tree).props.value, "40.00", "prefilled with Left to pay");
  typeAndSave(view, "20.00");
  assert.equal(app.state.current, POS_ROUTES.MoMoChoice);
  assert.equal(app.state.params.pendingMomoAmountPesewas, 2000);
  assert.match(await run61And62(app), /send GH₵20\.00/);
  assert.equal(app.state.current, POS_ROUTES.SplitPayment);
  view = mount();
  assert.match(textOf(view.tree), /MoMoCustomer sends to my numberGH₵20\.00/);
  assert.match(textOf(view.tree), /Left to payGH₵20\.00/);
  tileOf(view.tree, "Owe").props.onClick();
  assert.equal(app.state.current, POS_ROUTES.WhoOwesYou);
  assert.deepEqual(app.state.params.initialPaymentParts.map((part) => [part.paymentMethod, part.amountPesewas]), [["cash", 2000], ["momo", 2000], ["owe", 2000]]);
});

test("GH₵8.00: MoMo asks how much; 4.00 is what 62 asks for; Cash 4.00 completes it", async () => {
  const app = makeApp({ amountPesewas: 800 });
  const mount = await mountFor(app);
  let view = mount();
  openEditor(view, "MoMo");
  assert.equal(editorInput(view.tree).props.value, "8.00");
  typeAndSave(view, "4.00");
  assert.match(await run61And62(app), /send GH₵4\.00/);
  view = mount();
  tileOf(view.tree, "Cash").props.onClick();
  view.rerender();
  const done = findButton(view.tree, "Done");
  await done.props.onClick();
  await settle();
  assert.deepEqual(app.saved[0].parts.map((part) => [part.paymentMethod, part.amountPesewas, part.confirmedPesewas]), [["momo", 400, 400], ["cash", 400, undefined]]);
});

test("the editor refuses 0 and more than Left, and Cancel closes it without going to 61", async () => {
  const app = makeApp({ amountPesewas: 6000 });
  const view = (await mountFor(app))();
  openEditor(view, "MoMo");
  for (const value of ["0", "0.00", "60.01", ""]) {
    typeAndSave(view, value);
    assert.equal(app.state.current, POS_ROUTES.SplitPayment, `"${value}" stays`);
    assert.ok([...walk(view.tree)].some((node) => node.props?.role === "alert"), `"${value}" shows a message`);
  }
  findButton(view.tree, "Cancel").props.onClick();
  view.rerender();
  assert.equal(app.state.current, POS_ROUTES.SplitPayment);
  assert.ok(tileOf(view.tree, "MoMo"), "the tiles are back");
  assert.equal([...walk(view.tree)].filter((node) => node.type === "input").length, 0);
});

test("a second MoMo tap goes through the editor and grows the row", async () => {
  const app = makeApp({ amountPesewas: 6000, splitParts: [momoRow(2000)] });
  const mount = await mountFor(app);
  const view = mount();
  openEditor(view, "MoMo");
  assert.equal(editorInput(view.tree).props.value, "40.00");
  typeAndSave(view, "40.00");
  assert.equal(app.state.params.pendingMomoAmountPesewas, 4000);
  await run61And62(app);
  const momo = app.state.params.splitParts.filter((part) => part.paymentMethod === "momo");
  assert.deepEqual([momo.length, momo[0].amountPesewas, momo[0].confirmedPesewas], [1, 6000, 6000]);
});

// ---- raising and lowering a confirmed row --------------------------------------------------------

test("lowering a confirmed row keeps the confirmed amount; raising up to it needs no new confirmation", async () => {
  const app = makeApp({ amountPesewas: 800, splitParts: [momoRow(800)] });
  const mount = await mountFor(app);
  let view = mount();
  rowOf(view.tree, "MoMo").props.onClick();
  view.rerender();
  typeAndSave(view, "4.00");
  assert.deepEqual([app.state.params.splitParts[0].amountPesewas, app.state.params.splitParts[0].confirmedPesewas], [400, 800], "lowered, still confirmed 8.00");
  view = mount();
  rowOf(view.tree, "MoMo").props.onClick();
  view.rerender();
  typeAndSave(view, "7.00");
  assert.equal(app.state.current, POS_ROUTES.SplitPayment, "within the confirmed amount: no 62");
  assert.deepEqual([app.state.params.splitParts[0].amountPesewas, app.state.params.splitParts[0].confirmedPesewas], [700, 800]);
});

test("raising above the confirmed amount sends only the extra to 62; Back from there changes nothing", async () => {
  const app = makeApp({ amountPesewas: 6000, splitParts: [{ paymentMethod: "cash", amountPesewas: 2000 }, momoRow(2000)] });
  const mount = await mountFor(app);
  let view = mount();
  rowOf(view.tree, "MoMo").props.onClick();
  view.rerender();
  typeAndSave(view, "40.00");
  assert.equal(app.state.current, POS_ROUTES.MoMoChoice);
  assert.equal(app.state.params.pendingMomoAmountPesewas, 2000, "only the extra");
  assert.equal(app.state.params.momoRowAmountPesewas, 4000);
  // Back from 61: nothing changed.
  const before = JSON.stringify(app.state.params.splitParts);
  app.back();
  assert.equal(app.state.current, POS_ROUTES.SplitPayment);
  assert.equal(JSON.stringify(app.state.params.splitParts), before.replace(/"confirmedPesewas":2000\}\]$/, '"confirmedPesewas":2000}]'));
  assert.deepEqual(app.state.params.splitParts.find((part) => part.paymentMethod === "momo").amountPesewas, 2000);
  assert.equal("pendingMomoAmountPesewas" in app.state.params, false);
  // Again, and confirm on 62.
  view = mount();
  rowOf(view.tree, "MoMo").props.onClick();
  view.rerender();
  typeAndSave(view, "40.00");
  assert.match(await run61And62(app), /send GH₵20\.00/);
  const momo = app.state.params.splitParts.find((part) => part.paymentMethod === "momo");
  assert.deepEqual([momo.amountPesewas, momo.confirmedPesewas], [4000, 4000]);
  assert.equal("momoRowAmountPesewas" in app.state.params, false);
  assert.match(textOf(mount().tree), /Left to payGH₵0\.00/);
});

test("raising a lowered row above what was confirmed asks only for the difference to the confirmed amount", async () => {
  const app = makeApp({ amountPesewas: 6000, splitParts: [momoRow(1000, 3000)] });
  const mount = await mountFor(app);
  const view = mount();
  rowOf(view.tree, "MoMo").props.onClick();
  view.rerender();
  typeAndSave(view, "50.00");
  assert.equal(app.state.params.pendingMomoAmountPesewas, 2000, "5000 - 3000 confirmed");
  assert.match(await run61And62(app), /send GH₵20\.00/);
  const momo = app.state.params.splitParts[0];
  assert.deepEqual([momo.amountPesewas, momo.confirmedPesewas], [5000, 5000]);
});

test("applyMomoPick: a raise target sets the row amount and adds the extra to the confirmed amount", () => {
  const base = { amountPesewas: 6000, ...direct };
  assert.deepEqual(applyMomoPick({ ...base, splitParts: [momoRow(2000)], pendingMomoAmountPesewas: 2000, momoRowAmountPesewas: 4000 }), [momoRow(4000)]);
  assert.deepEqual(applyMomoPick({ ...base, splitParts: [momoRow(1000, 3000)], pendingMomoAmountPesewas: 2000, momoRowAmountPesewas: 5000 }), [momoRow(5000)]);
  const tooMuch = [momoRow(2000)];
  assert.deepEqual(applyMomoPick({ ...base, splitParts: tooMuch, pendingMomoAmountPesewas: 2000, momoRowAmountPesewas: 7000 }), tooMuch, "over the total is ignored");
});

// ---- a verified (phone request) row ---------------------------------------------------------------

const verifiedRow = { paymentMethod: "momo", amountPesewas: 2000, momoMethod: "paystack", verification: "verified", reference: "ref-1", confirmedPesewas: 2000 };

test("a verified MoMo row's amount cannot be edited and it cannot be removed; the MoMo tile is hidden", async () => {
  const app = makeApp({ amountPesewas: 6000, splitParts: [verifiedRow, { paymentMethod: "cash", amountPesewas: 1000 }] });
  const view = (await mountFor(app))();
  assert.equal(rowOf(view.tree, "MoMo").props.disabled, true, "amount button disabled");
  assert.equal(removeButton(view.tree, "MoMo"), undefined, "no remove button on the verified row");
  assert.ok(removeButton(view.tree, "Cash"), "other rows keep theirs");
  assert.equal(exactButtons(view.tree, "MoMo").length, 0, "no MoMo tile while a verified row exists");
  assert.ok(tileOf(view.tree, "Cash") && tileOf(view.tree, "Owe"));
  assert.equal(setPartAmount([verifiedRow], "momo", 1000, 6000), null, "the guard in setPartAmount");
});

test("a direct (you confirmed) MoMo row can still be edited and removed", async () => {
  const app = makeApp({ amountPesewas: 6000, splitParts: [momoRow(2000)] });
  const view = (await mountFor(app))();
  assert.equal(rowOf(view.tree, "MoMo").props.disabled, false);
  assert.ok(removeButton(view.tree, "MoMo"));
});

// ---- 27 and 27 from 19 -----------------------------------------------------------------------------

test("27: the MoMo tile opens the editor, then goes to 61 with the chosen amount", async () => {
  const { CollectSplitPayment } = await loadJsx("src/pos/DebtCollection.jsx");
  setLiveQuery(([id]) => (id === "d1" ? { id: "d1", amountPesewas: 6000, customerName: "Ama", status: "unpaid" } : undefined));
  const calls = [];
  const view = render({ type: CollectSplitPayment, props: { params: { debtId: "d1", amount: "60.00" }, onRecordCollection() {}, onBack() {}, onNavigate: (...args) => calls.push(args), onUpdateParams() {} } });
  openEditor(view, "MoMo");
  assert.equal(calls.length, 0, "not yet");
  assert.equal(editorInput(view.tree).props.value, "60.00");
  typeAndSave(view, "25.00");
  setLiveQuery(null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "MoMoChoice");
  assert.equal(calls[0][1].pendingMomoAmountPesewas, 2500);
  assert.deepEqual([calls[0][1].returnRoute, calls[0][1].pickOnly], ["SplitPayment", true]);
});

test("27 from 19: the MoMo tile opens the editor, then goes to 61 with the chosen amount", async () => {
  const { default: InstallmentSplitPayment } = await loadJsx("src/pos/InstallmentSplitPayment.jsx");
  const calls = [];
  const view = render({ type: InstallmentSplitPayment, props: { params: { splitTotalPesewas: 2000 }, onBack() {}, onNavigate: (...args) => calls.push(args), onReturnTo() {}, onUpdateParams() {} } });
  openEditor(view, "MoMo");
  assert.equal(calls.length, 0);
  assert.equal(editorInput(view.tree).props.value, "20.00");
  typeAndSave(view, "5.00");
  assert.equal(calls[0][0], "MoMoChoice");
  assert.equal(calls[0][1].pendingMomoAmountPesewas, 500);
  assert.equal(calls[0][1].returnRoute, "SplitPayment");
});

// ---- what the saved records say ----------------------------------------------------------------------

test("a sale with a lowered MoMo part records the saved amount and the confirmed amount", async () => {
  const sale = await recordCashSale({
    amountPesewas: 800, cashReceivedPesewas: 400, momoReceivedPesewas: 400,
    parts: [momoRow(400, 800), { paymentMethod: "cash", amountPesewas: 400 }]
  });
  assert.equal(sale.momoReceivedPesewas, 400);
  assert.equal(sale.momoConfirmedPesewas, 800);
  assert.equal(sale.momoVerification, "merchant_confirmed");
  const stored = await db.transactions.get(sale.id);
  assert.equal(stored.momoConfirmedPesewas, 800);
});

test("a MoMo sale without an edit records the confirmed amount equal to the saved amount; cash records none", async () => {
  const momoSale = await recordCashSale({ amountPesewas: 500, cashReceivedPesewas: 0, momoReceivedPesewas: 500, parts: [{ paymentMethod: "momo", amountPesewas: 500, ...direct }] });
  assert.equal(momoSale.momoConfirmedPesewas, 500);
  const cashSale = await recordCashSale({ amountPesewas: 500 });
  assert.equal("momoConfirmedPesewas" in cashSale, false);
});

test("a part confirmed for less than it is saved for is refused and nothing is written", async () => {
  await assert.rejects(recordCashSale({
    amountPesewas: 500, cashReceivedPesewas: 0, momoReceivedPesewas: 500,
    parts: [{ paymentMethod: "momo", amountPesewas: 500, ...direct, confirmedPesewas: 400 }]
  }), /confirmed/i);
  assert.equal(await db.transactions.count(), 0);
});

test("a collection with a lowered MoMo part records the confirmed amount on its payment and income rows", async () => {
  const { debt } = await recordManualDebt({ name: "Kofi", amountPesewas: 6000 });
  const result = await recordDebtCollection({ debtId: debt.id, parts: [momoRow(400, 800), { paymentMethod: "cash", amountPesewas: 400 }] });
  const payments = await db.payments.toArray();
  const momoPayment = payments.find((row) => row.paymentMethod === "momo");
  const cashPayment = payments.find((row) => row.paymentMethod === "cash");
  assert.equal(momoPayment.amountPesewas, 400);
  assert.equal(momoPayment.momoConfirmedPesewas, 800);
  assert.equal("momoConfirmedPesewas" in cashPayment, false);
  const income = (await db.transactions.toArray()).find((row) => row.type === "income" && row.payment_method === "momo");
  assert.equal(income.momoConfirmedPesewas, 800);
  assert.equal(result.momoConfirmedPesewas, 800);
});

test("a credit sale and a manual debt with a lowered MoMo first payment record the confirmed amount", async () => {
  const credit = await recordCreditSale({
    amountPesewas: 1000, name: "Ama", paymentMethod: "momo", initialPaymentPesewas: 300,
    initialPaymentParts: [momoRow(300, 500)]
  });
  assert.equal(credit.saleTransaction.momoReceivedPesewas, 300);
  assert.equal(credit.saleTransaction.momoConfirmedPesewas, 500);
  const manual = await recordManualDebt({
    name: "Yaw", amountPesewas: 2000, paymentMethod: "momo", initialPaymentPesewas: 300,
    initialPaymentParts: [momoRow(300, 500)]
  });
  const incomeRows = (await db.transactions.toArray()).filter((row) => row.type === "income" && row.payment_method === "momo" && row.customer_name === "Yaw");
  assert.equal(incomeRows.length, 1);
  assert.equal(incomeRows[0].momoConfirmedPesewas, 500);
  assert.ok(manual.debt.id);
});

test("a backup with a bad momoConfirmedPesewas is refused", () => {
  const backup = (value) => ({
    app: "StoreKeeper Light", formatVersion: 1, exportedAt: "2026-10-22T00:00:00.000Z",
    data: { transactions: [{ id: "t1", amountPesewas: 400, total_amount: 400, momoConfirmedPesewas: value }], customers: [], debts: [], products: [], payments: [], suppliers: [] }
  });
  assert.ok(validateBackupData(backup(800)));
  for (const bad of [-1, 1.5, "800"]) assert.throws(() => validateBackupData(backup(bad)), /invalid amount/, String(bad));
});