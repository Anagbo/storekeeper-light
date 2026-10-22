import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import handler from "../api/whatsapp/reminder.js";

const environmentKeys = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "WHATSAPP_ALLOWED_USER_IDS",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_GRAPH_API_VERSION",
  "WHATSAPP_DEBT_TEMPLATE",
  "WHATSAPP_TEMPLATE_LANGUAGE"
];
const savedEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
const originalFetch = global.fetch;

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

function makeRequest({ method = "POST", token, body } = {}) {
  return {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body
  };
}

function configureEnvironment() {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "public-anon-key";
  process.env.WHATSAPP_ALLOWED_USER_IDS = "allowed-user-id";
  process.env.WHATSAPP_ACCESS_TOKEN = "server-only-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-number-id";
  process.env.WHATSAPP_GRAPH_API_VERSION = "v99.0";
  process.env.WHATSAPP_DEBT_TEMPLATE = "approved_debt_template";
  process.env.WHATSAPP_TEMPLATE_LANGUAGE = "en";
}

beforeEach(configureEnvironment);
afterEach(() => {
  for (const [key, value] of savedEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  global.fetch = originalFetch;
});

test("requires POST and a signed-in user", async () => {
  const getResponse = makeResponse();
  await handler(makeRequest({ method: "GET" }), getResponse);
  assert.equal(getResponse.statusCode, 405);

  const unauthorizedResponse = makeResponse();
  await handler(makeRequest(), unauthorizedResponse);
  assert.equal(unauthorizedResponse.statusCode, 401);
});

test("does not send for an authenticated user outside the sender allowlist", async () => {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ id: "other-user-id" })
  });
  const response = makeResponse();
  await handler(makeRequest({ token: "valid-token", body: {} }), response);
  assert.equal(response.statusCode, 403);
});

test("rejects an invalid Ghana number without calling Meta", async () => {
  let fetchCount = 0;
  global.fetch = async () => {
    fetchCount += 1;
    return { ok: true, json: async () => ({ id: "allowed-user-id" }) };
  };
  const response = makeResponse();
  await handler(makeRequest({
    token: "valid-token",
    body: { phone: "123", customerName: "Ama", shopName: "Shop", amountPesewas: 100 }
  }), response);
  assert.equal(response.statusCode, 400);
  assert.equal(fetchCount, 1);
});

test("sends the approved template using server credentials and normalized phone", async () => {
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/auth/v1/user")) {
      return { ok: true, json: async () => ({ id: "allowed-user-id" }) };
    }
    return { ok: true, json: async () => ({ messages: [{ id: "wamid.example" }] }) };
  };
  const response = makeResponse();
  await handler(makeRequest({
    token: "valid-token",
    body: {
      phone: "024 123 4567",
      customerName: "Ama",
      shopName: "Market Shop",
      amountPesewas: 1250
    }
  }), response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.messageId, "wamid.example");
  assert.equal(calls[0].options.headers.Authorization, "Bearer valid-token");
  assert.equal(calls[0].options.headers.apikey, "public-anon-key");
  assert.equal(calls[1].url, "https://graph.facebook.com/v99.0/phone-number-id/messages");
  assert.equal(calls[1].options.headers.Authorization, "Bearer server-only-token");
  const payload = JSON.parse(calls[1].options.body);
  assert.equal(payload.to, "233241234567");
  assert.equal(payload.template.name, "approved_debt_template");
  assert.deepEqual(payload.template.components[0].parameters.map(({ text }) => text), [
    "Ama",
    "GHS 12.50",
    "Market Shop"
  ]);
});
