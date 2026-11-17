import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { correctDebtBalance, recordManualDebt } from "../src/db/debtLedger.js";
import { signCreditEvent } from "../src/db/signatures.js";
import { getCreditEventAmountPesewas, getCreditReason } from "../src/lib/creditReason.js";
import {
  SIGNATURE_FIELDS,
  SIGNATURE_MAX_BYTES,
  SIGNATURE_MAX_POINTS,
  countSignaturePoints,
  isSignedEvent,
  isValidSignature,
  thinSignature
} from "../src/lib/signature.js";
import { createSyncPayload } from "../src/lib/syncPayload.js";
import { buildBackup, importDatabaseFromJson } from "../src/utils/backup.js";
import { loadCustomerHistory } from "../src/utils/loadCustomerDebtHistory.js";
import { posText as t } from "../src/pos/i18n.js";

// rules_global.customer_proof (16 Nov 2026): signature, signedAt, signedAmountPesewas and signedReason
// on the credit event's transactions row. No Dexie version bump; in backup and restore; never synced.

const STROKES = [[[100, 200], [150, 260], [220, 300]], [[400, 400], [500, 450]]];
const file = (backup) => ({ text: async () => JSON.stringify(backup) });

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
});

async function creditEvent(type = "sale") {
  const rows = await db.transactions.toArray();
  return rows.find((row) => (type === "manual_debt" ? row.type === "manual_debt" : row.paymentType === "credit"));
}

test("no Dexie version bump: the database stays at version 14", () => {
  assert.equal(db.verno, 14);
});

test("what for: items, the reason typed on 53, and generated words read as no reason", () => {
  assert.equal(getCreditReason({ type: "sale", paymentType: "credit", items_json: JSON.stringify([{ name: "Bread", quantity: 2 }, { name: "Sugar", quantity: 1 }]) }), "Bread × 2, Sugar");
  assert.equal(getCreditReason({ type: "sale", paymentType: "credit", items_json: JSON.stringify([{ name: "Other amount", quantity: 1 }, { name: "Rice", quantity: 1 }]) }), "Rice");
  assert.equal(getCreditReason({ type: "sale", paymentType: "credit", itemDescription: "Sale", items_json: JSON.stringify([{ name: "Sale", quantity: 1 }]) }), "");
  assert.equal(getCreditReason({ type: "sale", paymentType: "credit", itemDescription: "Other amount", items_json: JSON.stringify([{ name: "Other amount", quantity: 1 }]) }), "");
  assert.equal(getCreditReason({ type: "manual_debt", note: "School fees" }), "School fees");
  assert.equal(getCreditReason({ type: "manual_debt", note: "" }), "");
  assert.equal(getCreditReason({ type: "manual_debt", note: "  " }), "");
  assert.equal(getCreditReason({ type: "installment_sale", note: "Debt added · Ama" }), "");
});

test("the signed amount is ONE credit event: the Owe part of a sale, the amount added by hand", async () => {
  await recordCreditSale({ name: "Ama", amountPesewas: 3000, now: 1000 });
  // A split sale: GH₵20.00 paid today, GH₵60.00 owed. The Owe part is the credit; older debt is not counted.
  await recordCreditSale({ name: "Ama", amountPesewas: 8000, initialPaymentPesewas: 2000, initialPaymentParts: [{ paymentMethod: "cash", amountPesewas: 2000 }], now: 2000 });
  const rows = (await db.transactions.toArray()).filter((row) => row.paymentType === "credit").sort((a, b) => a.createdAt - b.createdAt);
  assert.equal(getCreditEventAmountPesewas(rows[0]), 3000, "older balance is not counted");
  assert.equal(getCreditEventAmountPesewas(rows[1]), 6000, "the Owe part");
  await recordManualDebt({ name: "Ama", amountPesewas: 7000, note: "Phone repair", now: 3000 });
  assert.equal(getCreditEventAmountPesewas(await creditEvent("manual_debt")), 7000, "the amount added, not the balance");
});

test("old events read as Not signed", async () => {
  await recordCreditSale({ name: "Kofi", amountPesewas: 6000, saleItems: [{ productId: 1, name: "Rice", quantity: 1, unitPricePesewas: 6000 }] });
  const event = await creditEvent();
  assert.equal(isSignedEvent(event), false);
  for (const field of SIGNATURE_FIELDS) assert.equal(event[field], undefined);
  const history = await loadCustomerHistory(event.customerId, "Kofi");
  const row = history.events.find((item) => item.type === "credit");
  assert.equal(row.signed, false);
  assert.equal(row.reason, "Rice");
  assert.equal(row.transactionId, event.id);
});

test("signing stores the four fields, keeps updatedAt and sync state, and is written once", async () => {
  await recordCreditSale({ name: "Kofi", amountPesewas: 6000, saleItems: [{ productId: 1, name: "Rice", quantity: 1, unitPricePesewas: 6000 }], now: 5000 });
  const before = await creditEvent();
  await signCreditEvent({ transactionId: before.id, strokes: STROKES, now: 9000 });
  const after = await db.transactions.get(before.id);
  assert.deepEqual(after.signature, STROKES);
  assert.equal(after.signedAt, 9000);
  assert.equal(after.signedAmountPesewas, 6000);
  assert.equal(after.signedReason, "Rice");
  assert.equal(after.updatedAt, before.updatedAt, "signing never changes updatedAt");
  assert.equal(after.syncStatus, before.syncStatus);
  assert.equal(after.synced, before.synced);
  assert.deepEqual({ ...after, signature: undefined, signedAt: undefined, signedAmountPesewas: undefined, signedReason: undefined }, { ...before, signature: undefined, signedAt: undefined, signedAmountPesewas: undefined, signedReason: undefined });
  assert.equal(isSignedEvent(after), true);
  // Never replaced.
  await assert.rejects(signCreditEvent({ transactionId: before.id, strokes: [[[1, 1]]], now: 9999 }), /already signed/);
  assert.deepEqual((await db.transactions.get(before.id)).signature, STROKES);
  // No ink, no signature.
  await assert.rejects(signCreditEvent({ transactionId: before.id, strokes: [] }), /Draw a signature/);
});

test("a signature is refused on anything that is not a credit event", async () => {
  await db.transactions.add({ id: "cash1", type: "sale", paymentType: "cash", amountPesewas: 9000, createdAt: 1, updatedAt: 1 });
  await assert.rejects(signCreditEvent({ transactionId: "cash1", strokes: STROKES }), /could not be found/);
  await assert.rejects(signCreditEvent({ transactionId: "missing", strokes: STROKES }), /could not be found/);
});

test("signing does not mark a synced event pending", async () => {
  await recordCreditSale({ name: "Esi", amountPesewas: 6000 });
  const event = await creditEvent();
  await db.transactions.update(event.id, { syncStatus: "synced", synced: true });
  await signCreditEvent({ transactionId: event.id, strokes: STROKES });
  const after = await db.transactions.get(event.id);
  assert.equal(after.syncStatus, "synced");
  assert.equal(after.synced, true);
});

test("thinned on Done: whole numbers 0..1000, at most 1,500 points, under 20 KB", () => {
  const long = [Array.from({ length: 5000 }, (_, index) => [index % 1001 + 0.4, 1200 - (index % 50)])];
  const thinned = thinSignature(long);
  assert.ok(isValidSignature(thinned));
  assert.ok(countSignaturePoints(thinned) <= SIGNATURE_MAX_POINTS);
  assert.ok(JSON.stringify(thinned).length <= SIGNATURE_MAX_BYTES);
  for (const [x, y] of thinned.flat()) {
    assert.ok(Number.isInteger(x) && x >= 0 && x <= 1000);
    assert.ok(Number.isInteger(y) && y >= 0 && y <= 1000);
  }
  assert.deepEqual(thinned[0].at(-1), [Math.round((4999 % 1001) + 0.4), 1000], "the last point of a stroke is kept");
  // Many one-point strokes still fit the size limit.
  const dots = Array.from({ length: 1500 }, () => [[1000, 1000]]);
  assert.ok(isValidSignature(thinSignature(dots)));
  assert.deepEqual(thinSignature([[], [[Number.NaN, 2]]]), []);
  assert.equal(isValidSignature([[[1001, 0]]]), false);
  assert.equal(isValidSignature([[[1.5, 0]]]), false);
  assert.equal(isValidSignature([[]]), false);
  assert.equal(isValidSignature(Array.from({ length: 2 }, () => Array.from({ length: 800 }, () => [1, 1]))), false, "over 1,500 points");
});

test("the snapshot keeps the signed amount after a later correction; the correction is its own event", async () => {
  const { debt, event } = await recordManualDebt({ name: "Yaw", amountPesewas: 6000, note: "Cement", now: 1000 });
  await signCreditEvent({ transactionId: event.id, strokes: STROKES, now: 2000 });
  const current = await db.debts.get(debt.id);
  await correctDebtBalance({ debtId: debt.id, expectedUpdatedAt: current.updatedAt, newBalancePesewas: 4000, reasonCode: "other", reasonNote: "Wrong amount typed", now: 3000 });
  const signed = await db.transactions.get(event.id);
  assert.equal(signed.signedAmountPesewas, 6000);
  assert.equal(signed.signedReason, "Cement");
  assert.equal(signed.creditExtendedPesewas, 6000, "the credit event itself is not edited");
  const history = await loadCustomerHistory(debt.customerId, "Yaw");
  const credit = history.events.find((row) => row.type === "manual_debt");
  const correction = history.events.find((row) => row.type === "adjustment");
  assert.equal(credit.signed, true);
  assert.equal(credit.signedAmountPesewas, 6000);
  assert.deepEqual([correction.previousBalancePesewas, correction.newBalancePesewas, correction.reasonNote], [6000, 4000, "Wrong amount typed"]);
});

test("backup carries the signature and restore brings it back", async () => {
  await recordCreditSale({ name: "Kofi", amountPesewas: 6000 });
  const event = await creditEvent();
  await signCreditEvent({ transactionId: event.id, strokes: STROKES, now: 7000 });
  const backup = await buildBackup();
  const saved = backup.data.transactions.find((row) => row.id === event.id);
  assert.deepEqual(saved.signature, STROKES);
  await Promise.all([db.debts, db.customers, db.transactions, db.payments].map((table) => table.clear()));
  const result = await importDatabaseFromJson(file(backup));
  assert.equal(result.signaturesLeftOut, 0);
  const restored = await db.transactions.get(event.id);
  assert.deepEqual(restored.signature, STROKES);
  assert.equal(restored.signedAt, 7000);
  assert.equal(restored.signedAmountPesewas, 6000);
});

test("restore onto the same event unsigned adds ONLY the signature fields and never replaces one", async () => {
  await recordCreditSale({ name: "Kofi", amountPesewas: 6000 });
  const event = await creditEvent();
  const unsigned = await db.transactions.get(event.id);
  const backup = await buildBackup();
  const row = backup.data.transactions.find((item) => item.id === event.id);
  Object.assign(row, { signature: STROKES, signedAt: 7000, signedAmountPesewas: 6000, signedReason: "", note: "changed in the file", amountPesewas: 1 });
  await importDatabaseFromJson(file(backup));
  const merged = await db.transactions.get(event.id);
  assert.deepEqual(merged.signature, STROKES);
  assert.equal(merged.signedAt, 7000);
  assert.equal(merged.note, unsigned.note, "nothing else from the file");
  assert.equal(merged.amountPesewas, unsigned.amountPesewas);
  assert.equal(merged.updatedAt, unsigned.updatedAt);
  // A second backup with another signature does not replace it.
  row.signature = [[[9, 9]]];
  row.signedAt = 8000;
  await importDatabaseFromJson(file(backup));
  const kept = await db.transactions.get(event.id);
  assert.deepEqual(kept.signature, STROKES);
  assert.equal(kept.signedAt, 7000);
});

test("an oversized or malformed signature is left out; the event restores as Not signed and the rest restores", async () => {
  await recordCreditSale({ name: "Kofi", amountPesewas: 6000 });
  await recordCreditSale({ name: "Ama", amountPesewas: 7000 });
  const backup = await buildBackup();
  const [first, second] = backup.data.transactions.filter((row) => row.paymentType === "credit");
  Object.assign(first, { signature: [Array.from({ length: 2000 }, () => [500, 500])], signedAt: 1, signedAmountPesewas: 6000, signedReason: "" });
  Object.assign(second, { signature: [[[1001, 5]]], signedAt: 1, signedAmountPesewas: 7000, signedReason: "" });
  assert.ok(JSON.stringify(first.signature).length > SIGNATURE_MAX_BYTES, "the first one is oversized");
  await Promise.all([db.debts, db.customers, db.transactions, db.payments].map((table) => table.clear()));
  const result = await importDatabaseFromJson(file(backup));
  assert.equal(result.signaturesLeftOut, 2);
  for (const id of [first.id, second.id]) {
    const restored = await db.transactions.get(id);
    assert.ok(restored, "the event itself restores");
    assert.equal(isSignedEvent(restored), false);
    for (const field of SIGNATURE_FIELDS) assert.equal(restored[field], undefined);
  }
  assert.equal(await db.debts.count(), backup.data.debts.length, "the rest of the file restores");
  assert.equal(await db.customers.count(), backup.data.customers.length);
});

test("the restore screen's sentence for signatures left out (wiring 71)", () => {
  assert.equal(t("backup.signaturesLeftOutOne"), "1 signature in the file could not be read and was left out.");
  assert.equal(t("backup.signaturesLeftOutMany", { count: 3 }), "3 signatures in the file could not be read and were left out.");
});

test("signature fields are stripped from the sync payload", () => {
  const signed = { id: "t1", type: "sale", paymentType: "credit", signature: STROKES, signedAt: 1, signedAmountPesewas: 6000, signedReason: "Rice", updatedAt: 2 };
  const { body, serializedBody } = createSyncPayload({ transactions: [signed], debts: [], products: [] });
  assert.deepEqual(body.records.transactions, [{ id: "t1", type: "sale", paymentType: "credit", updatedAt: 2 }]);
  assert.doesNotMatch(serializedBody, /signature|signedAt|signedAmount|signedReason/);
  assert.deepEqual(signed.signature, STROKES, "the stored record is not changed");
});
