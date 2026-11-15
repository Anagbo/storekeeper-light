import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { db } from "../src/db/db.js";
import { setPreference } from "../src/db/preferences.js";
import { FEATURE_FLAGS } from "../src/config/features.js";
import { getMerchantMomoSettings } from "../src/pos/momoConfig.js";

after(async () => {
  db.close();
  await db.delete();
});

const momoSource = readFileSync(new URL("../src/pos/MoMoScreens.jsx", import.meta.url), "utf8");
const planSource = readFileSync(new URL("../src/pos/PlanScreens.jsx", import.meta.url), "utf8");
function section(source, start, end) {
  const from = source.indexOf(`export function ${start}`);
  const to = end ? source.indexOf(`export function ${end}`) : source.length;
  assert.ok(from >= 0 && to > from, `${start} not found`);
  return source.slice(from, to);
}

test("Phone request is off unless VITE_ENABLE_MOMO_PHONE_REQUEST is true", () => {
  assert.equal(FEATURE_FLAGS.ENABLE_MOMO_PHONE_REQUEST, false);
});

test("a saved 'Always: phone request' default falls back to Ask while Phone request is off", async () => {
  await setPreference("momoDefault", "phone");
  const settings = await getMerchantMomoSettings();
  assert.equal(settings.defaultMethod, "ask");
});

test("screen 61 shows the Phone request tile disabled with Not available yet", () => {
  const choice = section(momoSource, "MoMoChoice", "MoMoDirect");
  assert.match(choice, /title="Phone request"[\s\S]*?disabled=\{!PHONE_REQUEST_ENABLED\}/);
  assert.match(choice, /PHONE_REQUEST_ENABLED \?[\s\S]+: "Not available yet"/);
});

test("screen 63 shows Coming soon instead of Set up, and hides Always: phone request, while Phone request is off", () => {
  const settings = section(momoSource, "PaymentSettings", "MoMoSetup");
  assert.match(settings, /PHONE_REQUEST_ENABLED\s*\?\s*<button[^>]*onClick=\{\(\) => onNavigate\("MoMoSetup"\)\}[^>]*>Set up ›<\/button>\s*:\s*<PosStatusTag>Coming soon<\/PosStatusTag>/);
  assert.match(settings, /\.\.\.\(PHONE_REQUEST_ENABLED \? \[\["phone", "Always: phone request"\]\] : \[\]\)/);
});

test("screens 56 and 68 cannot send a request while Phone request is off", () => {
  assert.match(section(momoSource, "MoMoPayment", "MoMoWaiting"), /disabled=\{!PHONE_REQUEST_ENABLED\} onClick=\{\(\) => onNavigate\(network === "Telecel"/);
  assert.match(section(planSource, "PlanPayPhone", "PlanPaymentResult"), /disabled=\{!PHONE_REQUEST_ENABLED \|\| !number\.trim\(\)( \|\| saving)?\}/);
});

test("screen 65 shows the Phone request tile disabled with Not available yet", () => {
  const method = section(planSource, "PlanPayMethod", "PlanPayCash");
  assert.match(method, /title="Phone request" detail=\{PHONE_REQUEST_ENABLED \?[^:]+: "Not available yet"\} disabled=\{!PHONE_REQUEST_ENABLED\}/s);
});

test("screen 68 never records a plan payment as confirmed and never stores the phone number as the reference", () => {
  const phone = section(planSource, "PlanPayPhone", "PlanPaymentResult");
  assert.doesNotMatch(phone, /status:\s*"confirmed"/);
  assert.doesNotMatch(phone, /reference:\s*`\$\{network\}:\$\{number\}`/);
  // 68 saves through the shared guard, which always goes to the Waiting to confirm result.
  assert.match(phone, /useSavePlanPayment\(onNavigate\)/);
  const guard = planSource.slice(planSource.indexOf("function useSavePlanPayment"), planSource.indexOf("export function PlanPayCash"));
  assert.match(guard, /onNavigate\("PlanPaymentResult", \{ state: "waiting", payment \}\)/);
  assert.doesNotMatch(guard, /state: "paid"/);
});