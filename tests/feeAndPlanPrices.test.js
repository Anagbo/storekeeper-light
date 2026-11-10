import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { db } from "../src/db/db.js";
import * as momoConfig from "../src/pos/momoConfig.js";
import { PLAN_CONFIG } from "../src/pos/planPayments.js";
import { posText } from "../src/pos/i18n.js";

after(async () => {
  db.close();
  await db.delete();
});

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("F3: the Phone request fee must be a whole number of pesewas", () => {
  const { parseFeePesewas } = momoConfig;
  assert.equal(typeof parseFeePesewas, "function");
  for (const [raw, expected] of [[undefined, 0], ["", 0], ["0", 0], ["25", 25], ["59", 59]]) {
    assert.equal(parseFeePesewas(raw), expected, String(raw));
  }
  for (const bad of ["0.25", "2.5", "-1", "abc", "1e3", " 25", "25 ", "GH₵0.25", "9007199254740993", "NaN", "Infinity"]) {
    assert.throws(() => parseFeePesewas(bad), /whole number of pesewas/, bad);
  }
});

test("F3: a bad fee setting gives fee 0, is marked invalid, and keeps Phone request off", () => {
  const { readPhoneRequestFee } = momoConfig;
  assert.equal(typeof readPhoneRequestFee, "function");
  assert.deepEqual(readPhoneRequestFee("25"), { feePesewas: 25, feeValid: true });
  assert.deepEqual(readPhoneRequestFee(undefined), { feePesewas: 0, feeValid: true });
  assert.deepEqual(readPhoneRequestFee("0.25"), { feePesewas: 0, feeValid: false });
  assert.equal(typeof momoConfig.MOMO_CONFIG.phoneRequestFeeValid, "boolean");
  assert.ok(Number.isSafeInteger(momoConfig.MOMO_CONFIG.phoneRequestFeePesewas));
  const source = read("src/pos/momoConfig.js");
  assert.match(source, /PHONE_REQUEST_ENABLED = FEATURE_FLAGS\.ENABLE_MOMO_PHONE_REQUEST && MOMO_CONFIG\.phoneRequestFeeValid/);
});

test("F3: the fee is still read from configuration, not from a component", () => {
  assert.match(read("src/pos/momoConfig.js"), /VITE_MOMO_PHONE_REQUEST_FEE_PESEWAS/);
  for (const file of ["MoMoScreens.jsx", "PlanScreens.jsx"]) {
    assert.doesNotMatch(read(`src/pos/${file}`), /VITE_MOMO_PHONE_REQUEST_FEE/, file);
  }
});

test("F2: one client price table in pesewas, with defaults equal to the server defaults", async () => {
  const plans = await import("../src/config/plans.js");
  assert.deepEqual(plans.PLAN_DEFAULTS_PESEWAS, { monthly: 1500, six_months: 7500, yearly: 15000 });
  assert.deepEqual(plans.SUBSCRIPTION_PLANS.map(({ id, months }) => [id, months]), [["monthly", 1], ["six_months", 6], ["yearly", 12]]);
  for (const plan of plans.SUBSCRIPTION_PLANS) assert.ok(Number.isSafeInteger(plan.amountPesewas) && plan.amountPesewas > 0, plan.id);
  // The server defaults (api/subscription/plans.js) must agree, with no override set.
  const saved = ["SUBSCRIPTION_MONTHLY_AMOUNT_PESEWAS", "SUBSCRIPTION_SIX_MONTHS_AMOUNT_PESEWAS", "SUBSCRIPTION_YEARLY_AMOUNT_PESEWAS"].map((key) => [key, process.env[key]]);
  saved.forEach(([key]) => delete process.env[key]);
  try {
    const { getSubscriptionPlan } = await import("../api/subscription/plans.js");
    for (const id of Object.keys(plans.PLAN_DEFAULTS_PESEWAS)) {
      assert.equal(getSubscriptionPlan(id).amountPesewas, plans.PLAN_DEFAULTS_PESEWAS[id], id);
    }
  } finally {
    saved.forEach(([key, value]) => { if (value !== undefined) process.env[key] = value; });
  }
});

test("F2: prices come from VITE_SUBSCRIPTION_*_AMOUNT_PESEWAS; a bad value falls back to the default and is reported", async () => {
  const { readPlanPrices, PLAN_DEFAULTS_PESEWAS } = await import("../src/config/plans.js");
  assert.deepEqual(readPlanPrices({}), { prices: PLAN_DEFAULTS_PESEWAS, invalid: [] });
  assert.deepEqual(readPlanPrices({ VITE_SUBSCRIPTION_MONTHLY_AMOUNT_PESEWAS: "3000" }).prices.monthly, 3000);
  const bad = readPlanPrices({ VITE_SUBSCRIPTION_MONTHLY_AMOUNT_PESEWAS: "15.00", VITE_SUBSCRIPTION_SIX_MONTHS_AMOUNT_PESEWAS: "0", VITE_SUBSCRIPTION_YEARLY_AMOUNT_PESEWAS: "abc" });
  assert.deepEqual(bad.prices, PLAN_DEFAULTS_PESEWAS);
  assert.deepEqual(bad.invalid, ["monthly", "six_months", "yearly"]);
});

test("F2: the plan screens read the same price table, not a second one", async () => {
  const plans = await import("../src/config/plans.js");
  assert.equal(PLAN_CONFIG.amountPesewas, plans.PLAN_PRICES_PESEWAS.monthly);
  const planPayments = read("src/pos/planPayments.js");
  assert.match(planPayments, /amountPesewas: PLAN_PRICES_PESEWAS\.monthly/);
  assert.doesNotMatch(planPayments, /VITE_SUBSCRIPTION_MONTHLY_AMOUNT/);
});

test("F2: the subscription modal shows prices in pesewas through the formatter", () => {
  const modal = read("src/components/SubscriptionModal.jsx");
  assert.match(modal, /from "\.\.\/config\/plans\.js"/);
  assert.doesNotMatch(modal, /_AMOUNT_GHS|import\.meta\.env/);
  assert.match(modal, /\{formatGhs\(plan\.amountPesewas\)\}/);
  assert.match(modal, /Pay \$\{formatGhs\(selectedPlan\.amountPesewas\)\} \//);
});

test("F2: the 64 plan price comes from the plan table, not fixed text", () => {
  assert.match(read("src/pos/PlanScreens.jsx"), /formatGhs\(PLAN_CONFIG\.amountPesewas\)/);
  assert.match(read("src/pos/planPayments.js"), /amountPesewas: PLAN_PRICES_PESEWAS\.monthly/);
});

test(".env.example documents the client prices in pesewas and no longer the cedi variables", () => {
  const example = read(".env.example");
  for (const key of ["VITE_SUBSCRIPTION_MONTHLY_AMOUNT_PESEWAS=1500", "VITE_SUBSCRIPTION_SIX_MONTHS_AMOUNT_PESEWAS=7500", "VITE_SUBSCRIPTION_YEARLY_AMOUNT_PESEWAS=15000"]) {
    assert.ok(example.includes(key), key);
  }
  // A setting line, not the comment that explains the change.
  assert.doesNotMatch(example, /^VITE_SUBSCRIPTION_\w*_AMOUNT_GHS=/m);
  assert.match(example, /VITE_MOMO_PHONE_REQUEST_FEE_PESEWAS/);
});