import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const momoSource = readFileSync(new URL("../src/pos/MoMoScreens.jsx", import.meta.url), "utf8");
const setup = momoSource.slice(momoSource.indexOf("export function MoMoSetup"), momoSource.indexOf("export function MoMoPayment"));

test("E1/B6: screen 60 never overwrites the direct-receive number customers send to", () => {
  assert.ok(setup.length > 0, "MoMoSetup not found");
  assert.doesNotMatch(setup, /setPreference\("momoReceivingNumber"/);
  assert.doesNotMatch(setup, /setPreference\("momoReceivingNetwork"/);
  assert.match(setup, /setPreference\("paystackPayoutNumber", number\)/);
  assert.match(setup, /setPreference\("paystackPayoutNetwork", network\)/);
});

test("K11: screen 60 continues to 56 only when reached by tapping MoMo, otherwise goes back (SAVEMOMO)", () => {
  assert.match(setup, /if \(params\.returnToMomo\) onNavigate\("MoMoPayment", \{ \.\.\.params, paystackSetUp: true \}\);\s*else onBack\(\);/);
});