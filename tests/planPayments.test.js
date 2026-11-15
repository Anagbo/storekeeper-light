import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../src/db/db.js";
import * as planPayments from "../src/pos/planPayments.js";

const { appendPlanPayment, listPlanPayments } = planPayments;

after(async () => {
  db.close();
  await db.delete();
});

test("plan payments are always saved as waiting, whatever the caller asks for", async () => {
  for (const method of ["cash", "momo_direct", "momo_paystack"]) {
    const payment = await appendPlanPayment({ method, amountPesewas: 1500, reference: `ref-${method}`, status: "confirmed" });
    assert.equal(payment.status, "waiting");
    assert.equal(payment.confirmedBy, "");
  }
  const stored = await listPlanPayments();
  assert.ok(stored.length >= 3);
  assert.ok(stored.every((payment) => payment.status === "waiting"));
});

test("the app cannot confirm a plan payment itself (confirmation is server-only)", () => {
  assert.equal("confirmPlanPayment" in planPayments, false);
});