import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, afterEach, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import initiate from "../api/subscription/initiate.js";
import verify from "../api/subscription/verify.js";
import * as planPayments from "../src/pos/planPayments.js";
import wiring from "../docs/handoff/journey-wiring.json" with { type: "json" };

after(async () => {
  db.close();
  await db.delete();
});

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const originalConsoleError = console.error;
const originalSecret = process.env.PAYSTACK_SECRET_KEY;
const originalPrice = process.env.SUBSCRIPTION_MONTHLY_AMOUNT_PESEWAS;

beforeEach(() => {
  process.env.PAYSTACK_SECRET_KEY = "server-test-secret";
  process.env.APP_URL = "https://storekeeper.example";
  process.env.SUBSCRIPTION_MONTHLY_AMOUNT_PESEWAS = "abc";
});
afterEach(() => {
  console.error = originalConsoleError;
  if (originalSecret === undefined) delete process.env.PAYSTACK_SECRET_KEY;
  else process.env.PAYSTACK_SECRET_KEY = originalSecret;
  if (originalPrice === undefined) delete process.env.SUBSCRIPTION_MONTHLY_AMOUNT_PESEWAS;
  else process.env.SUBSCRIPTION_MONTHLY_AMOUNT_PESEWAS = originalPrice;
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

// ---- B9 (rest): a pricing configuration error is logged, not sent to the client -------------

test("B9: a bad plan price setting does not send the setting's name to the merchant (checkout)", async () => {
  const logged = [];
  console.error = (...args) => logged.push(args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(" "));
  const response = makeResponse();
  await initiate({ method: "POST", body: { email: "buyer@example.com", planId: "monthly" } }, response);
  assert.equal(response.statusCode, 500);
  assert.equal(response.body.error, "Checkout is temporarily unavailable. Please try again.");
  assert.doesNotMatch(JSON.stringify(response.body), /SUBSCRIPTION_|pesewas/i);
  assert.ok(logged.some((line) => line.includes("SUBSCRIPTION_MONTHLY_AMOUNT_PESEWAS")), "the detail is still logged for the operator");
});

test("B9: a bad plan price setting does not send the setting's name to the merchant (verify)", async () => {
  const logged = [];
  console.error = (...args) => logged.push(args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(" "));
  const response = makeResponse();
  await verify({ method: "POST", body: { reference: "ref-1", planId: "monthly" } }, response);
  assert.equal(response.statusCode, 500);
  assert.equal(response.body.error, "Payment verification is temporarily unavailable. Please try again.");
  assert.doesNotMatch(JSON.stringify(response.body), /SUBSCRIPTION_|pesewas/i);
  assert.ok(logged.some((line) => line.includes("SUBSCRIPTION_MONTHLY_AMOUNT_PESEWAS")));
});

test("B9: no API handler passes error.message to a response", () => {
  const apiDirectory = fileURLToPath(new URL("../api/", import.meta.url));
  const walk = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => (
    entry.isDirectory() ? walk(`${directory}${entry.name}/`) : [{ path: `${directory}${entry.name}`, contents: readFileSync(`${directory}${entry.name}`, "utf8") }]
  ));
  for (const file of walk(apiDirectory).filter((entry) => entry.path.endsWith(".js"))) {
    assert.doesNotMatch(file.contents, /respond\([^;]*\berror\.message\b/, file.path);
  }
});

// ---- My plan shows plain method names, not stored codes -------------------------------------

test("My plan: stored method codes have plain labels, the same three names as the tiles on 65", () => {
  assert.equal(typeof planPayments.planMethodLabel, "function");
  const tiles = wiring.screens["65"].controls.map((control) => control.label).filter((label) => label !== "Back");
  assert.deepEqual(tiles, ["Cash", "Mobile money", "Phone request"]);
  assert.deepEqual(["cash", "momo_direct", "momo_paystack"].map(planPayments.planMethodLabel), tiles);
});

test("My plan: an unknown stored code never shows as a raw code", () => {
  for (const code of ["", undefined, null, "momo_future", "constructor", "__proto__"]) {
    assert.equal(planPayments.planMethodLabel(code), "Payment", String(code));
  }
});

test("My plan: the payment rows use the label, and the screen 69 line uses the same labels", () => {
  const screen = read("src/pos/PlanScreens.jsx");
  assert.match(screen, /\{planMethodLabel\(payment\.method\)\}/);
  assert.doesNotMatch(screen, /\{payment\.method\}/);
  assert.match(read("src/pos/planPayments.js"), /PLAN_METHOD_LABELS\[payment\.method\]/);
});
