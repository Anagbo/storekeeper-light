import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, afterEach, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import initiate from "../api/subscription/initiate.js";
import verify from "../api/subscription/verify.js";
import * as trial from "../src/lib/subscriptionTrial.js";
import * as payments from "../src/db/subscriptionPayments.js";

after(async () => {
  db.close();
  await db.delete();
});

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const originalFetch = global.fetch;
const originalConsoleError = console.error;
const originalSecret = process.env.PAYSTACK_SECRET_KEY;

beforeEach(async () => {
  process.env.PAYSTACK_SECRET_KEY = "server-test-secret";
  process.env.APP_URL = "https://storekeeper.example";
  await db.settings.clear();
});
afterEach(() => {
  global.fetch = originalFetch;
  console.error = originalConsoleError;
  if (originalSecret === undefined) delete process.env.PAYSTACK_SECRET_KEY;
  else process.env.PAYSTACK_SECRET_KEY = originalSecret;
});

function makeResponse() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; return this; },
    json(body) { this.body = body; return this; }
  };
}

// ---- D9, D10: service worker ------------------------------------------------------------

test("D9: a new service worker waits instead of taking over (and reloading) in the middle of a sale", () => {
  const worker = read("src/sw.js");
  const installHandler = worker.match(/addEventListener\("install"[\s\S]*?\}\);/)?.[0] ?? "";
  assert.doesNotMatch(installHandler, /skipWaiting/, "install must not call skipWaiting");
  // The explicit message path stays, for a future "Update ready" prompt.
  assert.match(worker, /event\.data\?\.type === "SKIP_WAITING"/);
});

test("D9: the page reloads for an update only when the update was asked for", () => {
  const main = read("src/main.jsx");
  assert.match(main, /controllerchange/);
  assert.match(main, /hadController/);
});

test("D10: a navigation to /api is never answered with index.html", () => {
  assert.match(read("src/sw.js"), /new NavigationRoute\(createHandlerBoundToURL\("\/index\.html"\), \{ denylist: \[\/\^\\\/api\\\/\/\] \}\)/);
});

// ---- D12: subscription expiry and the device clock -----------------------------------------

test("D12: moving the device clock back does not bring an expired subscription back", () => {
  assert.equal(typeof trial.isSubscriptionActive, "function");
  const expiry = "2026-12-01T00:00:00.000Z";
  const now = Date.parse("2026-11-10T00:00:00.000Z");
  assert.equal(trial.isSubscriptionActive(expiry, now, "2026-11-09T00:00:00.000Z"), true);
  assert.equal(trial.isSubscriptionActive(expiry, now, ""), true, "no observed time yet");
  // The app last ran on 5 Dec (after expiry). The clock is now set back to 10 Nov.
  assert.equal(trial.isSubscriptionActive(expiry, now, "2026-12-05T00:00:00.000Z"), false);
  assert.equal(trial.isSubscriptionActive("", now, ""), false);
  assert.equal(trial.isSubscriptionActive("not a date", now, ""), false);
});

test("D12: the hook checks expiry against the last observed time, and records that time whenever subscriptions are on", () => {
  const hook = read("src/hooks/useSubscription.js");
  assert.match(hook, /isSubscriptionActive\(subscriptionExpiry, Date\.now\(\), trialLastObservedAt\)/);
  const observer = hook.slice(hook.indexOf("subscriptionTrialLastObservedAt\");") - 400, hook.indexOf("subscriptionTrialLastObservedAt\");") + 400);
  assert.doesNotMatch(hook.match(/useEffect\(\(\) => \{\s*if \(!FEATURE_FLAGS\.SHOW_SUBSCRIPTION_FEATURE[^\n]*\n/)?.[0] ?? "", /trialDays <= 0/, "the clock is recorded even when there is no trial");
  assert.ok(observer.length > 0);
});

// ---- L2: a payment Paystack says failed must not stay pending forever -----------------------

test("L2: the server tells the app when Paystack says the payment failed, was abandoned or reversed", async () => {
  for (const status of ["failed", "abandoned", "reversed"]) {
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ status: true, data: { reference: "ref-1", status, amount: 1500, currency: "GHS", channel: "mobile_money" } })
    });
    const response = makeResponse();
    await verify({ method: "POST", body: { reference: "ref-1", planId: "monthly" } }, response);
    assert.equal(response.statusCode, 402, status);
    assert.equal(response.body.paymentStatus, status);
    assert.equal(response.body.expiresAt, undefined);
  }
});

test("L2: the server does not report the status of a different reference", async () => {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ status: true, data: { reference: "someone-elses", status: "failed", amount: 1500, currency: "GHS", channel: "mobile_money" } })
  });
  const response = makeResponse();
  await verify({ method: "POST", body: { reference: "ref-1", planId: "monthly" } }, response);
  assert.equal(response.statusCode, 402);
  assert.equal(response.body.paymentStatus, undefined);
});

test("L2: a pending payment still waiting at Paystack (ongoing, pending) is kept", () => {
  assert.equal(typeof payments.isFinalPaymentFailure, "function");
  for (const status of ["failed", "abandoned", "reversed"]) assert.equal(payments.isFinalPaymentFailure({ paymentStatus: status }), true, status);
  for (const status of ["ongoing", "pending", "processing", "queued", "success", "", undefined]) {
    assert.equal(payments.isFinalPaymentFailure({ paymentStatus: status }), false, String(status));
  }
  assert.equal(payments.isFinalPaymentFailure(undefined), false);
});

test("L2: a final failure clears only its own pending record", async () => {
  assert.equal(typeof payments.clearPendingSubscriptionPayment, "function");
  await db.settings.put({ key: "pendingSubscriptionPayment", value: JSON.stringify({ reference: "ref-1", planId: "monthly" }) });
  await payments.clearPendingSubscriptionPayment("other-ref");
  assert.ok(await db.settings.get("pendingSubscriptionPayment"), "a different reference leaves it alone");
  await payments.clearPendingSubscriptionPayment("ref-1");
  assert.equal(await db.settings.get("pendingSubscriptionPayment"), undefined);
});

test("L2: the hook clears the pending payment on a final failure and says so in plain words", () => {
  const hook = read("src/hooks/useSubscription.js");
  assert.match(hook, /if \(!response\.ok && isFinalPaymentFailure\(result\)\) \{[\s\S]*?await clearPendingSubscriptionPayment\(reference\);[\s\S]*?PAYMENT_NOT_COMPLETED_MESSAGE/);
  assert.equal(payments.PAYMENT_NOT_COMPLETED_MESSAGE, "This payment was not completed. You can try again.");
});

// ---- B9: no raw upstream or internal text in the checkout error ------------------------------

test("B9: a Paystack error is logged on the server but not sent to the merchant", async () => {
  const logged = [];
  console.error = (...args) => logged.push(args);
  global.fetch = async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ status: false, message: "Invalid key" }) });
  const response = makeResponse();
  await initiate({ method: "POST", body: { email: "buyer@example.com" } }, response);
  assert.equal(response.statusCode, 502);
  assert.equal(response.body.error, "Checkout could not be started. Please try again.");
  assert.doesNotMatch(JSON.stringify(response.body), /Invalid key/);
  assert.ok(logged.some((args) => JSON.stringify(args).includes("Invalid key")), "the detail is still logged");
});

test("B9: a network failure is logged on the server but its text is not sent to the merchant", async () => {
  const logged = [];
  console.error = (...args) => logged.push(args);
  global.fetch = async () => { throw new Error("connect ECONNREFUSED 10.0.0.5:443"); };
  const response = makeResponse();
  await initiate({ method: "POST", body: { email: "buyer@example.com" } }, response);
  assert.equal(response.statusCode, 502);
  assert.equal(response.body.error, "Could not reach Paystack. Please try again.");
  assert.doesNotMatch(JSON.stringify(response.body), /ECONNREFUSED|10\.0\.0\.5/);
  assert.ok(logged.length > 0);
});

test("B9: a timeout keeps its own plain message", async () => {
  console.error = () => {};
  global.fetch = async () => { throw Object.assign(new Error("aborted"), { name: "TimeoutError" }); };
  const response = makeResponse();
  await initiate({ method: "POST", body: { email: "buyer@example.com" } }, response);
  assert.equal(response.body.error, "Paystack request timed out. Please try again.");
});
