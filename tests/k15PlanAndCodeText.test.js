import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
// The tracked copy of the contract (tests/wiringContract.test.js proves it equals the handoff file).
import wiring from "../src/pos/wiring.json" with { type: "json" };
import * as planPayments from "../src/pos/planPayments.js";

after(async () => {
  db.close();
  await db.delete();
});
beforeEach(async () => {
  await db.settings.clear();
  await db.planPayments.clear();
});

const momoSource = readFileSync(new URL("../src/pos/MoMoScreens.jsx", import.meta.url), "utf8");
const planSource = readFileSync(new URL("../src/pos/PlanScreens.jsx", import.meta.url), "utf8");
const between = (source, start, end) => {
  const from = source.indexOf(`export function ${start}`);
  const to = end ? source.indexOf(`export function ${end}`) : source.length;
  assert.ok(from >= 0 && to > from, `${start} not found`);
  return source.slice(from, to);
};
// The wiring text without its notes in brackets.
const plain = (text) => text.replace(/\s*\([^)]*\)\s*/g, " ").trim();

test("K15: screen 58 shows both helper texts from the wiring file", () => {
  const code = between(momoSource, "MoMoCode", "MoMoNotCompleted");
  for (const text of wiring.screens["58"].helper_texts) assert.ok(code.includes(plain(text)), plain(text));
});

test("K15: screen 65 shows the helper texts and the Free and Fee tags from the wiring file", () => {
  const method = between(planSource, "PlanPayMethod", "PlanPayCash");
  for (const text of Object.values(wiring.screens["65"].helper_texts)) assert.ok(method.includes(text), text);
  assert.equal((method.match(/>Free</g) ?? []).length, 2, "Cash and Mobile money are tagged Free");
  assert.match(method, /Fee \$\{formatGhs\(MOMO_CONFIG\.phoneRequestFeePesewas\)\}/);
});

test("K15: screen 65 tags Last used only on the stored last-used method", async () => {
  assert.equal(typeof planPayments.getPlanLastUsedMethod, "function");
  assert.equal(await planPayments.getPlanLastUsedMethod(), "");
  await planPayments.appendPlanPayment({ method: "momo_direct", reference: "code-1" });
  assert.equal(await planPayments.getPlanLastUsedMethod(), "momo_direct");
  await planPayments.appendPlanPayment({ method: "cash", reference: "plan-123456" });
  assert.equal(await planPayments.getPlanLastUsedMethod(), "cash");
  const method = between(planSource, "PlanPayMethod", "PlanPayCash");
  assert.match(method, /lastUsed === "cash"/);
  assert.match(method, /lastUsed === "momo_direct"/);
});

test("K15: the 69 line is built from the stored plan payment, never fixed text", () => {
  const { describePlanPayment } = planPayments;
  assert.equal(typeof describePlanPayment, "function");
  const createdAt = new Date(2026, 10, 19, 10).getTime();
  assert.equal(describePlanPayment({ method: "momo_paystack", status: "confirmed", createdAt }), "Plan runs to 19 Dec · Phone request · MoMo · verified");
  assert.equal(describePlanPayment({ method: "cash", status: "confirmed", createdAt }), "Plan runs to 19 Dec · Cash");
  assert.equal(describePlanPayment({ method: "momo_direct", status: "confirmed", createdAt }), "Plan runs to 19 Dec · Mobile money");
  assert.equal(describePlanPayment({ method: "momo_paystack", status: "waiting", createdAt }), "", "a waiting payment has no plan period yet");
  assert.equal(describePlanPayment(undefined), "");
});

test("K15: screen 69 shows describePlanPayment and no fixed confirmation text", () => {
  const result = between(planSource, "PlanPaymentResult");
  assert.match(result, /describePlanPayment\(params\.payment\)/);
  assert.doesNotMatch(result, /Plan payment confirmed\./);
  assert.doesNotMatch(result, /Plan runs to 19 Dec|MoMo · verified/);
});