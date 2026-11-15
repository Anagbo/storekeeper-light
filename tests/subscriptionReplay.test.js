import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { applyVerifiedSubscriptionPayment } from "../src/db/subscriptionPayments.js";

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  await db.settings.clear();
});

const paidAt = new Date("2026-11-01T10:00:00.000Z");

async function expiry() {
  return (await db.settings.get("subscriptionExpiry"))?.value;
}

test("B2: verifying the same reference twice extends the subscription only once", async () => {
  await applyVerifiedSubscriptionPayment({ reference: "ref-replay", paidAt, durationMonths: 1 });
  const afterFirst = await expiry();
  assert.equal(afterFirst, "2026-12-01T10:00:00.000Z");

  const second = await applyVerifiedSubscriptionPayment({ reference: "ref-replay", paidAt, durationMonths: 1 });
  assert.equal(second.applied, false);
  assert.equal(await expiry(), afterFirst);
});

test("D3: a reference saved by an older version as lastSubscriptionReference is not applied again", async () => {
  await db.settings.put({ key: "subscriptionExpiry", value: "2026-12-01T10:00:00.000Z" });
  await db.settings.put({ key: "lastSubscriptionReference", value: "ref-legacy" });
  const result = await applyVerifiedSubscriptionPayment({ reference: "ref-legacy", paidAt, durationMonths: 1 });
  assert.equal(result.applied, false);
  assert.equal(await expiry(), "2026-12-01T10:00:00.000Z");
});

test("a replayed reference still clears its own pending payment record", async () => {
  await applyVerifiedSubscriptionPayment({ reference: "ref-pending", paidAt, durationMonths: 1 });
  await db.settings.put({ key: "pendingSubscriptionPayment", value: JSON.stringify({ reference: "ref-pending", planId: "monthly" }) });
  await applyVerifiedSubscriptionPayment({ reference: "ref-pending", paidAt, durationMonths: 1 });
  assert.equal(await db.settings.get("pendingSubscriptionPayment"), undefined);
});

test("two different references both extend the subscription", async () => {
  await applyVerifiedSubscriptionPayment({ reference: "ref-a", paidAt, durationMonths: 1 });
  const result = await applyVerifiedSubscriptionPayment({ reference: "ref-b", paidAt, durationMonths: 1 });
  assert.equal(result.applied, true);
  assert.equal(await expiry(), "2027-01-01T10:00:00.000Z");
});

test("the used-reference list is capped so it cannot grow without limit", async () => {
  for (let index = 0; index < 60; index += 1) {
    await applyVerifiedSubscriptionPayment({ reference: `ref-cap-${index}`, paidAt, durationMonths: 1 });
  }
  const used = JSON.parse((await db.settings.get("usedSubscriptionReferences")).value);
  assert.equal(used.length, 50);
  assert.equal(used.at(-1), "ref-cap-59");
});
