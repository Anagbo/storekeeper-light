import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { db } from "../src/db/db.js";
import { setPreference } from "../src/db/preferences.js";
import { FEATURE_FLAGS } from "../src/config/features.js";
import { getMerchantMomoSettings } from "../src/pos/momoConfig.js";
import { flushEffects, loadJsx, render, textOf, walk } from "./helpers/renderJsx.js";

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

// Screen 63 rendered with the flag off and on (behaviour, not markup): off shows the "Coming soon" tag,
// no "Set up" button and no "Always: phone request" choice; on shows "Set up" (it opens 60) and no tag.
async function render63(env) {
  const { PaymentSettings } = await loadJsx("src/pos/MoMoScreens.jsx", env);
  const navigated = [];
  const view = render({ type: PaymentSettings, props: { onBack() {}, onNavigate: (...args) => navigated.push(args) } });
  flushEffects(view);
  await new Promise((resolve) => setTimeout(resolve, 80));
  view.rerender();
  flushEffects(view);
  const nodes = [...walk(view.tree)];
  const buttons = nodes.filter((node) => node.type === "button" || (typeof node.type === "function" && /Button$/.test(node.type.name)));
  const setUp = buttons.find((node) => textOf(node).trim() === "Set up");
  return { text: textOf(view.tree), setUp, navigated };
}

test("screen 63 shows Coming soon instead of Set up, and hides Always: phone request, while Phone request is off", async () => {
  const off = await render63({});
  assert.match(off.text, /Coming soon/, "flag off: the Coming soon tag");
  assert.equal(off.setUp, undefined, "flag off: no Set up button");
  assert.doesNotMatch(off.text, /Always: phone request/, "flag off: no Always: phone request choice");

  const on = await render63({ VITE_ENABLE_MOMO_PHONE_REQUEST: "true" });
  assert.ok(on.setUp, "flag on: a Set up button");
  assert.doesNotMatch(on.text, /Coming soon/, "flag on: no Coming soon tag");
  on.setUp.props.onClick();
  assert.deepEqual(on.navigated.at(-1)?.[0], "MoMoSetup", "flag on: Set up opens 60");
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