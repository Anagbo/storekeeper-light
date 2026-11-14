import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import * as momoConfig from "../src/pos/momoConfig.js";

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  await db.settings.clear();
});

const momoSource = readFileSync(new URL("../src/pos/MoMoScreens.jsx", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../src/pos/SettingsScreens.jsx", import.meta.url), "utf8");
function section(start, end) {
  const from = momoSource.indexOf(`export function ${start}`);
  const to = momoSource.indexOf(`export function ${end}`);
  assert.ok(from >= 0 && to > from, `${start} not found`);
  return momoSource.slice(from, to);
}
async function log() {
  return JSON.parse((await db.settings.get("momoReceivingNumberLog"))?.value ?? "[]");
}

test("5b: the receiving number accepts Ghana mobile formats and stores them as 0XXXXXXXXX", () => {
  const { normalizeReceivingNumber } = momoConfig;
  assert.equal(typeof normalizeReceivingNumber, "function");
  assert.equal(normalizeReceivingNumber("024 123 4567"), "0241234567");
  assert.equal(normalizeReceivingNumber("+233 24 123 4567"), "0241234567");
  assert.equal(normalizeReceivingNumber("233241234567"), "0241234567");
  assert.equal(normalizeReceivingNumber("0551234567"), "0551234567");
  for (const bad of ["", "12345", "0301234567", "02412345678", "024-123-456x", "+44 7700 900123"]) {
    assert.equal(normalizeReceivingNumber(bad), null, bad);
  }
});

test("5b: the confirmation shows the number masked", () => {
  assert.equal(momoConfig.maskPhoneNumber("0241234567"), "024 ••• 4567");
});

test("5b: saving rejects an invalid number or network and writes nothing", async () => {
  await assert.rejects(momoConfig.saveReceivingNumber({ enabled: true, number: "12345", network: "MTN" }), /Ghana mobile number/);
  await assert.rejects(momoConfig.saveReceivingNumber({ enabled: true, number: "0241234567", network: "Vodafone" }), /network/);
  assert.equal(await db.settings.get("momoReceivingNumber"), undefined);
  assert.deepEqual(await log(), []);
});

test("5b: each change is recorded with old number, new number and time; an unchanged save adds nothing", async () => {
  await momoConfig.saveReceivingNumber({ enabled: true, number: "024 123 4567", network: "MTN" });
  assert.equal((await db.settings.get("momoReceivingNumber")).value, "0241234567");
  assert.equal((await db.settings.get("momoReceivingNetwork")).value, "MTN");
  await momoConfig.saveReceivingNumber({ enabled: true, number: "0241234567", network: "MTN" });
  await momoConfig.saveReceivingNumber({ enabled: true, number: "0551234567", network: "Telecel" });
  await momoConfig.saveReceivingNumber({ enabled: false, number: "", network: "Telecel" });
  const entries = await log();
  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map(({ oldNumber, newNumber, oldNetwork, newNetwork }) => ({ oldNumber, newNumber, oldNetwork, newNetwork })), [
    { oldNumber: "", newNumber: "0241234567", oldNetwork: "", newNetwork: "MTN" },
    { oldNumber: "0241234567", newNumber: "0551234567", oldNetwork: "MTN", newNetwork: "Telecel" },
    { oldNumber: "0551234567", newNumber: "", oldNetwork: "Telecel", newNetwork: "Telecel" }
  ]);
  assert.ok(entries.every((entry) => Number.isFinite(Date.parse(entry.changedAt))));
  assert.equal((await db.settings.get("momoReceivingNumber")).value, "");
});

test("5b: screen 63 has the My MoMo number input and the Network selector from the contract", () => {
  const settings = section("PaymentSettings", "MoMoSetup");
  assert.match(settings, /aria-label="My MoMo number"/);
  assert.match(settings, /type="tel"/);
  assert.match(settings, /RECEIVING_NETWORKS\.map/);
  assert.match(settings, /<legend[^>]*>Network<\/legend>/);
});

test("5b: screen 63 asks for a masked confirmation before saving a new number", () => {
  const settings = section("PaymentSettings", "MoMoSetup");
  assert.match(settings, /maskPhoneNumber\(/);
  assert.match(settings, /Yes, save/);
  assert.match(settings, /saveReceivingNumber\(/);
  assert.doesNotMatch(settings, /setPreference\("momoReceivingNumber"/, "the number must only be saved through saveReceivingNumber");
});

test("5b: screen 62 Money received stays disabled until a number is set", () => {
  const direct = section("MoMoDirect", "PaymentSettings");
  assert.match(direct, /disabled=\{saving \|\| !settings\.number\}/);
  assert.match(direct, /if \(savingRef\.current \|\| !settings\.number\) return;/);
  // 14 Nov 2026: no text path to Settings; a set-up card with a button that opens 63 instead.
  assert.match(direct, /Your MoMo number is not set up yet/);
  assert.match(direct, /Set up MoMo number/);
  assert.doesNotMatch(direct, /Set your MoMo number in Settings first|Menu ›/);
});

test("5b: Settings shows MoMo payments (63) without the subscription flag; My plan (64) stays behind it", () => {
  const block = settingsSource.slice(settingsSource.indexOf("{subscriptionEnabled && ("), settingsSource.indexOf("</section>", settingsSource.indexOf("{subscriptionEnabled && (")));
  assert.doesNotMatch(block, /onOpenMomoSettings/);
  assert.match(block, /onClick=\{onOpenPlan\}/);
  assert.match(settingsSource, /onClick=\{onOpenMomoSettings\}/);
});
