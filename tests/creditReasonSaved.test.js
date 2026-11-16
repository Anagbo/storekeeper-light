import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { recordManualDebt } from "../src/db/debtLedger.js";
import { loadRecentCreditReasons } from "../src/db/recentReasons.js";
import { getCreditReason } from "../src/lib/creditReason.js";
import { buildBackup } from "../src/utils/backup.js";
import { getCreditReasonCase, getSaleCreditReason } from "../src/pos/creditDraft.js";
import { backRoute, createRouteState, POS_ROUTES, pushRoute } from "../src/pos/routes.js";

// rules_global.credit_reason (16 Nov 2026): the reason typed on 18 is saved in its own field
// creditReason on the credit event; the transaction note reads "{reason} · {Name}", the debt note is the
// reason; items_json and itemDescription stay "Sale". Optional, trimmed, at most 60 characters.

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
});

const saleRow = async (result) => db.transactions.get(result.saleTransaction.id);

test("a keypad sale on credit saves the reason in creditReason, the note and the debt note", async () => {
  const result = await recordCreditSale({ name: "Kofi", amountPesewas: 3500, creditReason: "  School fees  " });
  const row = await saleRow(result);
  assert.equal(row.creditReason, "School fees");
  assert.equal(row.note, "School fees · Kofi");
  assert.equal(row.itemDescription, "Sale");
  assert.deepEqual(JSON.parse(row.items_json).map((item) => item.name), ["Sale"]);
  const [debt] = await db.debts.toArray();
  assert.equal(debt.note, "School fees");
  assert.equal(getCreditReason(row), "School fees");
});

test("a reason with \" · \" in it is kept whole", async () => {
  const result = await recordCreditSale({ name: "Kofi", amountPesewas: 3500, creditReason: "Rice · beans" });
  const row = await saleRow(result);
  assert.equal(row.creditReason, "Rice · beans");
  assert.equal(row.note, "Rice · beans · Kofi");
  assert.equal(getCreditReason(row), "Rice · beans");
});

test("the reason is optional: empty saves with no creditReason and reads as no reason", async () => {
  const result = await recordCreditSale({ name: "Kofi", amountPesewas: 3500, creditReason: "   " });
  const row = await saleRow(result);
  assert.equal("creditReason" in row, false);
  assert.equal(row.note, "Sale · Kofi");
  assert.equal(getCreditReason(row), "");
});

test("the reason is cut to 60 characters", async () => {
  const result = await recordCreditSale({ name: "Kofi", amountPesewas: 3500, creditReason: "x".repeat(70) });
  assert.equal((await saleRow(result)).creditReason, "x".repeat(60));
});

test("a split with an Owe part saves the reason with the credit", async () => {
  const result = await recordCreditSale({
    name: "Kofi",
    amountPesewas: 5000,
    initialPaymentPesewas: 2000,
    initialPaymentParts: [{ paymentMethod: "cash", amountPesewas: 2000 }],
    creditReason: "Gas refill"
  });
  const row = await saleRow(result);
  assert.equal(row.creditReason, "Gas refill");
  assert.equal(row.creditExtendedPesewas, 3000);
});

test("older events without creditReason still read their note or items; the word Sale is empty", () => {
  assert.equal(getCreditReason({ type: "sale", paymentType: "credit", itemDescription: "Sale", note: "Sale · Kofi", items_json: JSON.stringify([{ name: "Sale", quantity: 1 }]) }), "");
  assert.equal(getCreditReason({ type: "sale", paymentType: "credit", itemDescription: "Rice", note: "Rice · Kofi", items_json: JSON.stringify([{ name: "Rice", quantity: 2 }]) }), "Rice × 2");
  assert.equal(getCreditReason({ type: "manual_debt", note: "Old fridge" }), "Old fridge");
  assert.equal(getCreditReason({ type: "sale", paymentType: "credit", creditReason: "Sale", itemDescription: "Sale", items_json: "[]" }), "");
});

test("the backup carries creditReason", async () => {
  await recordCreditSale({ name: "Kofi", amountPesewas: 3500, creditReason: "School fees" });
  const backup = await buildBackup();
  assert.ok(backup.data.transactions.some((row) => row.creditReason === "School fees"));
});

test("recent reasons: typed ones only, last 30 days, newest first, distinct ignoring case, three at most", async () => {
  const now = Date.now();
  const day = 86_400_000;
  await recordCreditSale({ name: "A", amountPesewas: 100, creditReason: "Too old", now: now - 31 * day });
  await recordCreditSale({ name: "B", amountPesewas: 100, creditReason: "Rice", now: now - 5 * day });
  await recordCreditSale({ name: "C", amountPesewas: 100, now: now - 4 * day });
  await recordCreditSale({ name: "D", amountPesewas: 300, saleItems: [{ productId: 1, name: "Water", quantity: 3, unitPricePesewas: 100 }], now: now - 3 * day });
  await recordManualDebt({ name: "E", amountPesewas: 100, note: "School fees", now: now - 2 * day });
  await recordCreditSale({ name: "F", amountPesewas: 100, creditReason: "rice", now: now - day });
  await recordCreditSale({ name: "G", amountPesewas: 100, creditReason: "Bread", now: now - 3_600_000 });
  await recordCreditSale({ name: "H", amountPesewas: 100, creditReason: "Gas", now: now - 7 * day });
  assert.deepEqual(await loadRecentCreditReasons({ now }), ["Bread", "rice", "School fees"]);
});

test("recent reasons: none gives an empty list", async () => {
  await recordCreditSale({ name: "A", amountPesewas: 100 });
  assert.deepEqual(await loadRecentCreditReasons(), []);
});

test("the three cases on 18: field for a keypad sale or an Other amount cart, items, the note from 53", () => {
  assert.deepEqual(getCreditReasonCase({ creditReason: " Rice " }), { kind: "field", text: "Rice" });
  assert.equal(getCreditReasonCase({ saleItems: [{ productId: null, name: "Other amount", subtitle: "From Sell", quantity: 1, unitPricePesewas: 500 }] }).kind, "field");
  assert.deepEqual(getCreditReasonCase({ saleItems: [
    { productId: null, name: "Other amount", subtitle: "From Sell", quantity: 1, unitPricePesewas: 500 },
    { productId: 3, name: "Rice", quantity: 2, unitPricePesewas: 500 },
    { productId: 4, name: "Water", quantity: 3, unitPricePesewas: 100 }
  ] }), { kind: "items", text: "Rice × 2, Water × 3" });
  assert.deepEqual(getCreditReasonCase({ manualDebt: true, note: "Old fridge", creditReason: "x" }), { kind: "note", text: "Old fridge" });
  assert.equal(getSaleCreditReason({ creditReason: "x", saleItems: [{ productId: 3, name: "Rice", quantity: 1, unitPricePesewas: 5 }] }), "");
});

test("Back from 18, 17 and 16 carries the reason to the screen below", () => {
  let state = createRouteState(POS_ROUTES.Sell, { amountPesewas: 500 });
  state = pushRoute(state, POS_ROUTES.SplitPayment, { amountPesewas: 500 });
  state = pushRoute(state, POS_ROUTES.WhoOwesYou, { amountPesewas: 500, flow: "split" });
  state = pushRoute(state, POS_ROUTES.WhenWillTheyPay, { amountPesewas: 500, flow: "split", customer: { name: "Kofi", nameLower: "kofi" }, creditReason: "Rice" });
  state = backRoute(state);
  assert.equal(state.current, POS_ROUTES.WhoOwesYou);
  assert.equal(state.params.creditReason, "Rice");
  state = backRoute(state);
  assert.equal(state.current, POS_ROUTES.SplitPayment);
  assert.equal(state.params.creditReason, "Rice");
  state = backRoute(state);
  assert.equal(state.current, POS_ROUTES.Sell);
  assert.equal(state.params.creditReason, "Rice");
});
