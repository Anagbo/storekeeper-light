import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../src/db/db.js";
import { appendPlanPayment, confirmPlanPayment, listPlanPayments } from "../src/pos/planPayments.js";

after(async () => {
  db.close();
  await db.delete();
});

test("plan payment confirmation is append-only", async () => {
  const waiting = await appendPlanPayment({ method: "cash", amountPesewas: 1500, reference: "ref-1" });
  const confirmed = await confirmPlanPayment(waiting.id, "test-agent");
  const events = await listPlanPayments();
  assert.equal(waiting.status, "waiting");
  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.confirmedBy, "test-agent");
  assert.equal(events.length, 2);
});
