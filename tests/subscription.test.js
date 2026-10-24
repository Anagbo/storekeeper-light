import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import initiate from "../api/subscription/initiate.js";
import verify from "../api/subscription/verify.js";
import { FEATURE_SUBSCRIPTION_LOCKOUT } from "../src/config/features.js";

const originalSecret = process.env.PAYSTACK_SECRET_KEY;
const originalAppUrl = process.env.APP_URL;
const originalFetch = global.fetch;

test("subscription lockout is disabled by default", () => {
  assert.equal(FEATURE_SUBSCRIPTION_LOCKOUT, false);
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
      json: async () => ({ status: true, data: { authorization_url: "https://checkout.paystack.com/ref" } })
    };
  };
  const response = makeResponse();

  await initiate({ method: "POST", body: { email: "buyer@example.com", amount: 1 } }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { success: true, authorization_url: "https://checkout.paystack.com/ref" });
  assert.equal(request.url, "https://api.paystack.co/transaction/initialize");
  assert.equal(request.options.headers.Authorization, "Bearer server-test-secret");
  assert.deepEqual(JSON.parse(request.options.body), {
    email: "buyer@example.com",
    amount: 1500,
    currency: "GHS",
    channels: ["mobile_money"],
    callback_url: "https://storekeeper.example/?subscription=verify"
  });
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
  assert.equal(response.body.expiresAt, "2026-11-23T10:00:00.000Z");
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
