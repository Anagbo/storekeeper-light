import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import * as subscriptionPayments from "../src/db/subscriptionPayments.js";

after(async () => {
  db.close();
  await db.delete();
});

const hookSource = readFileSync(new URL("../src/hooks/useSubscription.js", import.meta.url), "utf8");
const HOUR = 3600000;
const NOW = Date.parse("2026-11-10T12:00:00.000Z");
const record = (hoursOld, extra = {}) => ({ reference: "ref-1", planId: "monthly", startedAt: new Date(NOW - hoursOld * HOUR).toISOString(), ...extra });

async function seed(pending) {
  await db.settings.clear();
  if (pending) await db.settings.put({ key: "pendingSubscriptionPayment", value: JSON.stringify(pending) });
}
const stored = async () => (await db.settings.get("pendingSubscriptionPayment"))?.value;

beforeEach(() => db.settings.clear());

test("stale rule: an active plan makes any pending record stale, old or fresh", () => {
  const { isStalePendingPayment } = subscriptionPayments;
  assert.equal(isStalePendingPayment(record(1), { planActive: true, now: NOW }), true);
  assert.equal(isStalePendingPayment(record(48), { planActive: true, now: NOW }), true);
});

test("stale rule: with no active plan, only a record more than 24 hours old is stale", () => {
  const { isStalePendingPayment } = subscriptionPayments;
  assert.equal(isStalePendingPayment(record(0), { planActive: false, now: NOW }), false);
  assert.equal(isStalePendingPayment(record(23.99), { planActive: false, now: NOW }), false);
  assert.equal(isStalePendingPayment(record(24), { planActive: false, now: NOW }), false, "exactly 24 hours is not more than 24 hours");
  assert.equal(isStalePendingPayment(record(24.01), { planActive: false, now: NOW }), true);
  assert.equal(isStalePendingPayment(record(72), { planActive: false, now: NOW }), true);
});

test("stale rule: no record is never stale; a record with no readable start time is stale", () => {
  const { isStalePendingPayment } = subscriptionPayments;
  assert.equal(isStalePendingPayment(null, { planActive: true, now: NOW }), false);
  assert.equal(isStalePendingPayment(record(1, { startedAt: "" }), { planActive: false, now: NOW }), true);
  assert.equal(isStalePendingPayment(record(1, { startedAt: undefined }), { planActive: false, now: NOW }), true);
});

test("startup clear: a genuine record (under 24 hours, plan not active) is kept", async () => {
  await seed(record(3));
  const cleared = await subscriptionPayments.clearStalePendingSubscriptionPayment({ planActive: false, now: NOW });
  assert.equal(cleared, false);
  assert.ok(await stored(), "record still there, so today's verify behaviour continues");
});

test("startup clear: an active plan clears the record", async () => {
  await seed(record(3));
  assert.equal(await subscriptionPayments.clearStalePendingSubscriptionPayment({ planActive: true, now: NOW }), true);
  assert.equal(await stored(), undefined);
});

test("startup clear: a record more than 24 hours old clears even with no plan", async () => {
  await seed(record(30));
  assert.equal(await subscriptionPayments.clearStalePendingSubscriptionPayment({ planActive: false, now: NOW }), true);
  assert.equal(await stored(), undefined);
});

test("startup clear: a record that the URL is returning from Paystack with is kept", async () => {
  await seed(record(30));
  const cleared = await subscriptionPayments.clearStalePendingSubscriptionPayment({ planActive: true, now: NOW, keepReference: "ref-1" });
  assert.equal(cleared, false);
  assert.ok(await stored());
});

test("startup clear: nothing to clear is quiet", async () => {
  assert.equal(await subscriptionPayments.clearStalePendingSubscriptionPayment({ planActive: true, now: NOW }), false);
});

test("hook: clears quietly on startup (no notice) and skips verifying a stale record", () => {
  const clearEffectStart = hookSource.indexOf("clearStalePendingSubscriptionPayment(");
  assert.ok(clearEffectStart >= 0, "the hook clears stale records");
  const clearEffect = hookSource.slice(clearEffectStart, hookSource.indexOf("useEffect(", clearEffectStart));
  assert.doesNotMatch(clearEffect, /setSubscriptionNotice/, "no notice when clearing");
  assert.match(hookSource, /isStalePendingPayment\(/);
  const verifyEffect = hookSource.slice(hookSource.indexOf("const callbackReference"), hookSource.indexOf("addEventListener(\"online\""));
  assert.match(verifyEffect, /stalePending|isStale/, "the automatic verify skips a stale record");
  assert.match(hookSource, /paymentPending: Boolean\(pendingPayment && !stalePending\)/);
});