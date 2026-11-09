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
  assert.match(choice, /title="Phone request"[^>]*disabled=\{!PHONE_REQUEST_ENABLED\}/s);
  assert.match(choice, /PHONE_REQUEST_ENABLED \?[^:]+: "Not available yet"/s);
});

test("screen 63 disables Phone request set up and the Always: phone request option", () => {
  const settings = section(momoSource, "PaymentSettings", "MoMoSetup");
  assert.match(settings, /disabled=\{!PHONE_REQUEST_ENABLED\} onClick=\{\(\) => onNavigate\("MoMoSetup"\)\} className="mt-2">\{PHONE_REQUEST_ENABLED \? "Phone request: set up ›" : "Not available yet"\}/);
  assert.match(settings, /disabled=\{value === "phone" && !PHONE_REQUEST_ENABLED\}/);
});

test("screens 56 and 68 cannot send a request while Phone request is off", () => {
  assert.match(section(momoSource, "MoMoPayment", "MoMoWaiting"), /disabled=\{!PHONE_REQUEST_ENABLED\} onClick=\{\(\) => onNavigate\(network === "Telecel"/);
  assert.match(section(planSource, "PlanPayPhone", "PlanPaymentResult"), /disabled=\{!PHONE_REQUEST_ENABLED \|\| !number\.trim\(\)\}/);
});

test("screen 65 shows the Phone request tile disabled with Not available yet", () => {
  const method = section(planSource, "PlanPayMethod", "PlanPayCash");
  assert.match(method, /title="Phone request" detail=\{PHONE_REQUEST_ENABLED \?[^:]+: "Not available yet"\} disabled=\{!PHONE_REQUEST_ENABLED\}/s);
});

test("screen 68 never records a plan payment as confirmed and never stores the phone number as the reference", () => {
  const phone = section(planSource, "PlanPayPhone", "PlanPaymentResult");
  assert.doesNotMatch(phone, /status:\s*"confirmed"/);
  assert.doesNotMatch(phone, /reference:\s*`\$\{network\}:\$\{number\}`/);
  assert.match(phone, /state: "waiting"/);
});