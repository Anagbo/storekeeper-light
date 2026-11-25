import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale, recordDebtCollection } from "../src/db/debts.js";
import { correctDebtBalance, recordManualDebt } from "../src/db/debtLedger.js";
import { saveHideAmounts, setPreference } from "../src/db/preferences.js";
import { signCreditEvent } from "../src/db/signatures.js";
import { formatDate, formatTime } from "../src/lib/formatDate.js";
import { formatGhs } from "../src/lib/formatGhs.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Wiring 73 "Show {Name} the record" (rules_global.customer_proof, 16 Nov 2026): look-only, opened from
// 29 and 43. "You owe", then What happened newest first: Paid, Took on credit (what for, Signed ✓ or
// Not signed) and every correction as its own Balance corrected card (old → new, reason).

globalThis.HTMLElement ??= class {};
let liveResults = new Map();
setLiveQuery((deps, query) => {
  const key = `${String(query)}|${JSON.stringify(deps)}`;
  if (!liveResults.has(key)) {
    liveResults.set(key, undefined);
    Promise.resolve().then(query).then((value) => liveResults.set(key, value), (error) => { console.log(error); liveResults.set(key, null); });
  }
  return liveResults.get(key);
});

after(async () => {
  db.close();
  await db.delete();
});

const DAY = 86_400_000;
const T0 = new Date(2026, 10, 2, 9, 15).getTime();
let kofi;

beforeEach(async () => {
  resetBrowserBack();
  liveResults = new Map();
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
  // Another customer with a phone: nothing of theirs may show on Kofi's record.
  await recordCreditSale({ name: "Ama Serwaa", phone: "0201112222", amountPesewas: 99900, now: T0 });
  // Kofi: a signed sale of Rice, a debt added by hand with a reason, one with none, a payment in two
  // parts, and a correction made after the signature.
  const sale = await recordCreditSale({ name: "Kofi", phone: "0241234567", amountPesewas: 6000, saleItems: [{ productId: 1, name: "Rice", quantity: 1, unitPricePesewas: 6000 }], now: T0 + DAY });
  await signCreditEvent({ transactionId: sale.transactionId, strokes: [[[1, 1], [2, 2]]], now: T0 + DAY + 1000 });
  await recordManualDebt({ name: "Kofi", amountPesewas: 3000, note: "School fees", now: T0 + 2 * DAY });
  await recordManualDebt({ name: "Kofi", amountPesewas: 1000, note: "", now: T0 + 3 * DAY });
  const debt = (await db.debts.toArray()).find((row) => row.customerName === "Kofi" && row.status === "unpaid");
  await recordDebtCollection({ debtId: debt.id, parts: [{ paymentMethod: "cash", amountPesewas: 600 }, { paymentMethod: "momo", amountPesewas: 400 }], now: T0 + 4 * DAY });
  const current = await db.debts.get(debt.id);
  await correctDebtBalance({ debtId: debt.id, expectedUpdatedAt: current.updatedAt, newBalancePesewas: 8000, reasonCode: "other", reasonNote: "Wrong amount typed", now: T0 + 5 * DAY });
  kofi = await db.customers.where("nameLower").equals("kofi").first();
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 2));
async function renderRecord(env = {}) {
  const { default: CustomerRecordView } = await loadJsx("src/pos/CustomerRecordView.jsx", env);
  const backs = [];
  const view = render({ type: CustomerRecordView, props: { params: { customerId: kofi.id, customerName: "Kofi" }, onBack: () => backs.push(1) } });
  // Wait for the record to load (up to about 10 seconds: the full suite runs many files at once).
  for (let index = 0; index < 5000 && /Loading/.test(textOf(view.tree)); index += 1) {
    await tick();
    view.rerender();
  }
  return { view, backs, text: textOf(view.tree).replace(/\s+/g, " ") };
}

const rows = (view) => [...walk(view.tree)].filter((node) => node.props?.["data-record-row"]).map((node) => ({ kind: node.props["data-record-row"], text: textOf(node), dashed: /border-dashed/.test(node.props.className) }));
// The Time row (decision (1), 16 Nov 2026): these days are in the past, so "dd/mm/yyyy HH:mm".
const when = (time) => `${formatDate(time)} ${formatTime(time)}`;

test("73 shows You owe, then every event newest first with its own card", async () => {
  const { view, text } = await renderRecord();
  assert.match(text, /You owe/);
  assert.match(text, /GH₵80\.00/);
  assert.deepEqual(rows(view).map((row) => row.kind), ["corrected", "paid", "credit", "credit", "credit"]);
  const [corrected, paid, noReason, schoolFees, rice] = rows(view);
  assert.equal(corrected.dashed, true, "Balance corrected is a dashed card");
  assert.equal(corrected.text, `Balance correctedWas${formatGhs(9000)}New balance${formatGhs(8000)}Time${when(T0 + 5 * DAY)}ReasonWrong amount typed`);
  assert.equal(paid.text, `Paid${formatGhs(1000)}Time${when(T0 + 4 * DAY)}Paid withCash ${formatGhs(600)}MoMo ${formatGhs(400)}`);
  assert.equal(noReason.text, `Took on credit${formatGhs(1000)}Time${when(T0 + 3 * DAY)}ReasonNo reason written`, "GH₵10.00, never signed: no Signature row (threshold_scope)");
  assert.equal(schoolFees.text, `Took on credit${formatGhs(3000)}Time${when(T0 + 2 * DAY)}ReasonSchool fees`, "GH₵30.00, never signed: no Signature row");
  assert.equal(rice.text, `Took on credit${formatGhs(6000)}Time${when(T0 + DAY)}ReasonRiceSignatureSigned ✓`);
  assert.match(text, /You owe ?GH₵80\.00 ?Nothing can be changed here\./, "the notice is right under You owe");
  assert.doesNotMatch(text, /read only|hand the phone back/i);
});

test("the signed amount stays GH₵60.00 after a later correction, and 73 shows the correction", async () => {
  const sale = (await db.transactions.toArray()).find((row) => row.customerName === "Kofi" && row.paymentType === "credit");
  assert.equal(sale.signedAmountPesewas, 6000);
  const { text } = await renderRecord();
  assert.match(text, /ReasonRiceSignatureSigned ✓/);
  assert.match(text, /Balance corrected/);
});

test("73 has no write controls: only Back and Back to shop", async () => {
  const { view, backs } = await renderRecord();
  const controls = [...walk(view.tree)].filter((node) => ["button", "a", "input", "textarea", "select", "form"].includes(node.type) || (typeof node.type === "function" && /Button$/.test(node.type.name)));
  const labels = controls.filter((node) => node.type === "button").map((node) => node.props["aria-label"] ?? textOf(node).trim());
  assert.deepEqual(labels, ["Back", "Back to shop"]);
  assert.equal(controls.filter((node) => node.type !== "button" && typeof node.type === "string").length, 0, "no links, inputs or forms");
  for (const node of controls.filter((item) => item.type === "button")) node.props.onClick();
  assert.equal(backs.length, 2, "both go back");
  assert.doesNotMatch(textOf(view.tree), /Collect|Correct|Edit|Remind|WhatsApp|Delete|Call|Add to debt|Get signature/);
});

test("73 shows no shop-wide figures, no other customers, no phone numbers", async () => {
  const { text } = await renderRecord();
  assert.doesNotMatch(text, /Ama|Serwaa|999\.00|1,079/, "no other customer");
  assert.doesNotMatch(text, /024|0241234567|020|233/, "no phone numbers");
  assert.doesNotMatch(text, /profit|cost|total|money in|sales|owed to you/i, "no shop figures or totals");
  assert.doesNotMatch(text, /legal|proof|guaranteed/i);
});

test("Hide amounts never hides 73: it is about one person", async () => {
  await saveHideAmounts(true);
  const { text } = await renderRecord();
  assert.match(text, /GH₵80\.00/);
  assert.doesNotMatch(text, /••••/);
});

test("29 opens 73 with Show {Name} the record; Back and Back to shop return to 29", async () => {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  await app.tap(/^Owed$/);
  await app.tap(/^Kofi/);
  assert.equal(app.route, "DebtorDetail");
  const show = app.button("Show Kofi the record");
  assert.equal(textOf(show).replace(/\s+/g, " "), "Show Kofi the record");
  await app.tap("Show Kofi the record");
  assert.equal(app.route, "CustomerRecordView");
  assert.equal(app.params.customerId, kofi.id);
  assert.match(app.text(), /You owe/);
  assert.equal([...walk(app.view.tree)].some((node) => node.props?.["aria-label"] === "Open menu"), false, "no Menu on 73");
  await app.tap("Back to shop");
  assert.equal(app.route, "DebtorDetail");
  await app.tap("Show Kofi the record");
  await app.tap("Back");
  assert.equal(app.route, "DebtorDetail");
  await app.tap("Show Kofi the record");
  await app.phoneBack();
  assert.equal(app.route, "DebtorDetail");
});

test("a Paid row lists Cash first, then MoMo, whatever order the parts were stored in", async () => {
  const { paidParts } = await import("../src/pos/historyRows.js");
  const momoFirst = { collectionParts: [{ method: "MoMo", amountPesewas: 400 }, { method: "Cash", amountPesewas: 600 }] };
  assert.equal(paidParts(momoFirst), `Cash ${formatGhs(600)}, MoMo ${formatGhs(400)}`);
  assert.equal(paidParts({ method: "MoMo", amountPesewas: 400 }), `MoMo ${formatGhs(400)}`);
});
