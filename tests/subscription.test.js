import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import initiate from "../api/subscription/initiate.js";
import verify from "../api/subscription/verify.js";
import { FEATURE_FLAGS, FEATURE_SUBSCRIPTION_LOCKOUT } from "../src/config/features.js";
import { addSubscriptionMonths } from "../src/lib/subscriptionDates.js";
import { getEffectiveTrialNow, getTrialExpiry, normalizeTrialDays } from "../src/lib/subscriptionTrial.js";

const originalSecret = process.env.PAYSTACK_SECRET_KEY;
const originalAppUrl = process.env.APP_URL;
const originalFetch = global.fetch;
const legacyAppSource = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const backupModalSource = readFileSync(new URL("../src/components/BackupModal.jsx", import.meta.url), "utf8");
const subscriptionHookSource = readFileSync(new URL("../src/hooks/useSubscription.js", import.meta.url), "utf8");
const posAppSource = readFileSync(new URL("../src/pos/PosApp.jsx", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../src/pos/SettingsScreens.jsx", import.meta.url), "utf8");
const modalSource = readFileSync(new URL("../src/components/SubscriptionModal.jsx", import.meta.url), "utf8");

test("subscription UI and lockout are disabled by default", () => {
  assert.equal(FEATURE_FLAGS.SHOW_SUBSCRIPTION_FEATURE, false);
  assert.equal(FEATURE_SUBSCRIPTION_LOCKOUT, false);
});

test("legacy shell keeps the shared subscription lifecycle and backup entry point", () => {
  assert.match(legacyAppSource, /useSubscription/);
  assert.match(legacyAppSource, /subscriptionOpen \|\| subscriptionRequired/);
  assert.match(legacyAppSource, /lockout=\{subscriptionRequired\}/);
  assert.match(legacyAppSource, /showSubscription=\{FEATURE_FLAGS\.SHOW_SUBSCRIPTION_FEATURE\}/);
  assert.match(backupModalSource, /showSubscription = false/);
  assert.match(backupModalSource, /showSubscription && FEATURE_FLAGS\.SHOW_SUBSCRIPTION_FEATURE/);
});

test("subscription trial is initialized from configuration and bypasses lockout until expiry", () => {
  assert.match(subscriptionHookSource, /VITE_SUBSCRIPTION_TRIAL_DAYS/);
  assert.match(subscriptionHookSource, /subscriptionTrialStartedAt/);
  assert.match(subscriptionHookSource, /trialInitialized/);
  assert.match(subscriptionHookSource, /!trialActive/);
});

test("trial policy normalizes configuration and resists device clock rollback", () => {
  assert.equal(normalizeTrialDays("30"), 30);
  assert.equal(normalizeTrialDays("0"), 0);
  assert.equal(normalizeTrialDays("-1"), 0);
  assert.equal(normalizeTrialDays("not-a-number"), 0);
  assert.equal(
    getTrialExpiry("2026-11-06T10:00:00.000Z", 30),
    "2026-12-06T10:00:00.000Z"
  );
  assert.equal(
    getEffectiveTrialNow(Date.parse("2026-11-10T10:00:00.000Z"), "2026-11-20T10:00:00.000Z"),
    Date.parse("2026-11-20T10:00:00.000Z")
  );
});

test("payment recovery persists pending references and retries after reconnect", () => {
  assert.match(subscriptionHookSource, /pendingSubscriptionPayment/);
  assert.match(subscriptionHookSource, /retryPendingPayment/);
  assert.match(subscriptionHookSource, /addEventListener\("online"/);
  assert.match(modalSource, /Verify pending payment/);
  assert.match(modalSource, /db\.settings\.put/);
});

test("new POS subscription journey connects Settings to the shared plan checkout", () => {
  assert.match(posAppSource, /onOpenSubscription=\{\(\) => setSubscriptionOpen\(true\)\}/);
  assert.match(posAppSource, /isOpen=\{subscriptionOpen \|\| subscriptionRequired\}/);
  assert.match(settingsSource, /subscriptionEnabled &&/);
  assert.match(settingsSource, /onClick=\{onOpenSubscription\}/);
  assert.match(modalSource, /monthly/);
  assert.match(modalSource, /six_months/);
  assert.match(modalSource, /yearly/);
  assert.match(modalSource, /planId: selectedPlanId/);
});

function makeResponse() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

beforeEach(() => {
  process.env.PAYSTACK_SECRET_KEY = "server-test-secret";
  process.env.APP_URL = "https://storekeeper.example";
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.PAYSTACK_SECRET_KEY;
  else process.env.PAYSTACK_SECRET_KEY = originalSecret;
  if (originalAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalAppUrl;
  global.fetch = originalFetch;
});

test("initializes a fixed GHS 15 Mobile Money checkout without exposing the secret", async () => {
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ status: true, data: { authorization_url: "https://checkout.paystack.com/ref", reference: "monthly-reference" } })
    };
  };
  const response = makeResponse();

  await initiate({ method: "POST", body: { email: "buyer@example.com", amount: 1 } }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { success: true, authorization_url: "https://checkout.paystack.com/ref", reference: "monthly-reference" });
  assert.equal(request.url, "https://api.paystack.co/transaction/initialize");
  assert.equal(request.options.headers.Authorization, "Bearer server-test-secret");
  assert.deepEqual(JSON.parse(request.options.body), {
    email: "buyer@example.com",
    amount: 1500,
    currency: "GHS",
    channels: ["mobile_money"],
    callback_url: "https://storekeeper.example/?subscription=verify&plan=monthly"
  });
});

test("uses a trusted request origin for the Paystack callback", async () => {
  let payload;
  global.fetch = async (_url, options) => {
    payload = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        status: true,
        data: { authorization_url: "https://checkout.paystack.com/ref", reference: "monthly-reference" }
      })
    };
  };
  const response = makeResponse();

  await initiate({
    method: "POST",
    headers: { origin: "https://storekeeper.example" },
    body: { email: "buyer@example.com" }
  }, response);

  assert.equal(payload.callback_url, "https://storekeeper.example/?subscription=verify&plan=monthly");
  assert.equal(response.statusCode, 200);
});

test("returns Paystack's error message for a failed API response", async () => {
  global.fetch = async () => ({
    ok: false,
    status: 400,
    text: async () => JSON.stringify({ status: false, message: "Invalid key" })
  });
  const response = makeResponse();

  await initiate({ method: "POST", body: { email: "buyer@example.com" } }, response);

  assert.equal(response.statusCode, 502);
  assert.equal(response.body.error, "Invalid key");
});

test("reports status when Paystack returns an empty or non-JSON response", async () => {
  for (const text of ["", "<html>gateway error</html>"]) {
    global.fetch = async () => ({
      ok: false,
      status: 502,
      text: async () => text
    });
    const response = makeResponse();

    await initiate({ method: "POST", body: { email: "buyer@example.com" } }, response);

    assert.equal(response.statusCode, 502);
    assert.match(response.body.error, /HTTP 502/);
  }
});

test("rejects invalid checkout emails and unsupported methods", async () => {
  const invalidEmailResponse = makeResponse();
  await initiate({ method: "POST", body: { email: "not-an-email" } }, invalidEmailResponse);
  assert.equal(invalidEmailResponse.statusCode, 400);

  const methodResponse = makeResponse();
  await initiate({ method: "GET" }, methodResponse);
  assert.equal(methodResponse.statusCode, 405);
  assert.equal(methodResponse.headers.Allow, "POST");
});

test("grants an expiry only after verifying successful GHS 15 Mobile Money payment", async () => {
  let requestedUrl;
  global.fetch = async (url, options) => {
    requestedUrl = url;
    assert.equal(options.headers.Authorization, "Bearer server-test-secret");
    return {
      ok: true,
      json: async () => ({
        status: true,
        data: {
          reference: "paid-reference",
          status: "success",
          amount: 1500,
          currency: "GHS",
          channel: "mobile_money",
          paid_at: "2026-10-24T10:00:00.000Z"
        }
      })
    };
  };
  const response = makeResponse();

  await verify({ method: "POST", body: { reference: "paid-reference" } }, response);

  assert.equal(requestedUrl, "https://api.paystack.co/transaction/verify/paid-reference");
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.reference, "paid-reference");
  assert.equal(response.body.expiresAt, "2026-11-24T10:00:00.000Z");
  assert.equal(response.body.paidAt, "2026-10-24T10:00:00.000Z");
  assert.equal(response.body.durationMonths, 1);
});

test("clamps calendar subscription dates at month end", () => {
  assert.equal(
    addSubscriptionMonths("2024-01-31T10:00:00.000Z", 1).toISOString(),
    "2024-02-29T10:00:00.000Z"
  );
  assert.equal(
    addSubscriptionMonths("2023-08-31T10:00:00.000Z", 6).toISOString(),
    "2024-02-29T10:00:00.000Z"
  );
});

test("initializes and verifies a configured six-month plan", async () => {
  process.env.SUBSCRIPTION_SIX_MONTHS_AMOUNT_PESEWAS = "7000";
  let initializePayload;
  global.fetch = async (url, options) => {
    if (url.includes("/transaction/initialize")) {
      initializePayload = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: true,         data: { authorization_url: "https://checkout.paystack.com/ref", reference: "six-month-reference" } })
      };
    }
    return {
      ok: true,
      json: async () => ({
        status: true,
        data: {
          reference: "six-month-reference",
          status: "success",
          amount: 7000,
          currency: "GHS",
          channel: "mobile_money",
          paid_at: "2026-10-24T10:00:00.000Z"
        }
      })
    };
  };

  const initiateResponse = makeResponse();
  await initiate({ method: "POST", body: { email: "buyer@example.com", planId: "six_months" } }, initiateResponse);
  assert.equal(initiateResponse.statusCode, 200);
  assert.equal(initializePayload.amount, 7000);
  assert.match(initializePayload.callback_url, /plan=six_months$/);

  const verifyResponse = makeResponse();
  await verify({ method: "POST", body: { reference: "six-month-reference", planId: "six_months" } }, verifyResponse);
  assert.equal(verifyResponse.statusCode, 200);
  assert.equal(verifyResponse.body.expiresAt, "2027-04-24T10:00:00.000Z");
  delete process.env.SUBSCRIPTION_SIX_MONTHS_AMOUNT_PESEWAS;
});

test("does not grant expiry for unsuccessful or mismatched payment details", async () => {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      status: true,
      data: {
        reference: "wrong-reference",
        status: "success",
        amount: 1500,
        currency: "GHS",
        channel: "mobile_money",
        paid_at: "2026-10-24T10:00:00.000Z"
      }
    })
  });
  const response = makeResponse();

  await verify({ method: "POST", body: { reference: "expected-reference" } }, response);

  assert.equal(response.statusCode, 402);
  assert.equal(response.body.success, undefined);
  assert.equal(response.body.expiresAt, undefined);
});
