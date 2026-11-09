import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { db } from "../src/db/db.js";
import * as subscriptionPayments from "../src/db/subscriptionPayments.js";

after(async () => {
  db.close();
  await db.delete();
});

const hookSource = readFileSync(new URL("../src/hooks/useSubscription.js", import.meta.url), "utf8");
const PLAIN = "Could not check the payment. Try again when you are online.";

function fakeResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, text: async () => body };
}

test("D2: the pending payment record is parsed by one shared function", () => {
  const { parsePendingSubscriptionPayment } = subscriptionPayments;
  assert.equal(typeof parsePendingSubscriptionPayment, "function");
  assert.deepEqual(parsePendingSubscriptionPayment(JSON.stringify({ reference: "r1", planId: "monthly" })), { reference: "r1", planId: "monthly" });
  for (const bad of ["", "{", "null", JSON.stringify({ reference: 1, planId: "monthly" }), JSON.stringify({ reference: "r1" })]) {
    assert.equal(parsePendingSubscriptionPayment(bad), null, bad);
  }
});

test("D2: the hook keeps the same pending object between renders (memoised on the stored text)", () => {
  assert.match(hookSource, /const pendingPayment = useMemo\(\(\) => parsePendingSubscriptionPayment\(pendingRaw\), \[pendingRaw\]\);/);
});

test("D2: the automatic verify runs once per reference; retries only come from reconnect or the retry button", () => {
  // Anchor on callbackReference: "const callbackUrl" also appears inside verifyPayment.
  const start = hookSource.indexOf("const callbackReference");
  assert.ok(start >= 0, "auto-verify effect not found");
  const effect = hookSource.slice(start, hookSource.indexOf("useEffect(() => {", start));
  assert.match(effect, /attemptedPaymentReference\.current === reference/);
  assert.match(effect, /attemptedPaymentReference\.current = reference;/);
  assert.match(hookSource, /addEventListener\("online", onOnline\)/);
});

test("D17: a non-JSON or empty verify reply gives plain words, not a parser error", async () => {
  const { readVerifyResponse } = subscriptionPayments;
  assert.equal(typeof readVerifyResponse, "function");
  assert.deepEqual(await readVerifyResponse(fakeResponse(JSON.stringify({ success: true }))), { success: true });
  await assert.rejects(readVerifyResponse(fakeResponse("<html>Captive portal</html>")), (error) => error.message === PLAIN);
  await assert.rejects(readVerifyResponse(fakeResponse("", { ok: false, status: 502 })), (error) => error.message === PLAIN);
});

test("D17: the hook reads the verify reply through readVerifyResponse and maps network errors to plain words", () => {
  const verify = hookSource.slice(hookSource.indexOf("const verifyPayment = useCallback"), hookSource.indexOf("const retryPendingPayment"));
  assert.match(verify, /await readVerifyResponse\(response\)/);
  assert.doesNotMatch(verify, /response\.json\(\)/);
  assert.match(verify, /isNetworkError\(verificationError\)/);
});