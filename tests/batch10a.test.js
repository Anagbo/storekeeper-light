import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { setPreference } from "../src/db/preferences.js";
import * as momoConfig from "../src/pos/momoConfig.js";
import * as splitTender from "../src/pos/splitTender.js";
import { POS_LINKS, returnToMomoOrigin } from "../src/pos/routes.js";

after(async () => {
  db.close();
  await db.delete();
});
beforeEach(async () => {
  await db.settings.clear();
});

const read = (file) => readFileSync(new URL(`../src/pos/${file}`, import.meta.url), "utf8");
const momoSource = read("MoMoScreens.jsx");
const section = (start, end) => {
  const from = momoSource.indexOf(`export function ${start}`);
  const to = momoSource.indexOf(`export function ${end}`);
  assert.ok(from >= 0 && to > from, `${start} not found`);
  return momoSource.slice(from, to);
};
const hasLink = (from, action, to) => POS_LINKS.some((link) => link.from === from && link.action === action && link.to === to);

test("K3: rows on 16 show the MoMo method and the Owe person and terms", () => {
  const { describeSplitPart } = splitTender;
  assert.equal(typeof describeSplitPart, "function");
  assert.equal(describeSplitPart({ paymentMethod: "momo", momoMethod: "direct" }), "Customer sends to my number");
  assert.equal(describeSplitPart({ paymentMethod: "momo", momoMethod: "paystack" }), "Phone request");
  assert.equal(describeSplitPart({ paymentMethod: "momo" }), "");
  assert.equal(describeSplitPart({ paymentMethod: "cash" }), "");
  assert.equal(describeSplitPart({ paymentMethod: "owe" }, {}), "");
  assert.equal(
    describeSplitPart({ paymentMethod: "owe" }, { customer: { name: "Amoto" }, installmentPlan: { isInstallmentPlan: true, installmentAmount: 250, frequency: "weekly" }, payBackLabel: "First payment today" }),
    "Amoto · GH₵2.50 · Every week · First payment today"
  );
  assert.equal(describeSplitPart({ paymentMethod: "owe" }, { customer: { name: "Kofi" }, payBackLabel: "In 1 week" }), "Kofi · In 1 week");
});

test("K3: 16 passes the row detail to the shared split screen, which shows it under the method", () => {
  assert.match(read("SaleSplitPayment.jsx"), /partDetail=\{\(part\) => describeSplitPart\(part, params\)\}/);
  const split = read("SplitPayment.jsx");
  assert.match(split, /partDetail = \(\) => ""/);
  assert.match(split, /const detail = partDetail\(part\);/);
});

test("K6: the Split button on 19 is named Split payment; 27 opened from 19 says Received", () => {
  assert.match(read("CreditScreens.jsx"), /aria-label=\{method === "split" \? t\("split\.title"\) : undefined\}/);
  assert.match(read("InstallmentSplitPayment.jsx"), /doneLabel=\{t\("collect\.received"\)\}/);
});

test("K12: an Always: customer sends setting on 63 skips 61 straight to 62", () => {
  const choice = section("MoMoChoice", "MoMoDirect");
  assert.match(choice, /if \(settings\.defaultMethod === "direct"\) onReplace\("MoMoDirect", \{ \.\.\.params, momoMethod: "direct" \}\);/);
  assert.match(read("PosApp.jsx"), /<MoMoChoice params=\{routeState\.params\} onBack=\{navigateBack\} onNavigate=\{navigate\} onReplace=\{replaceCurrentRoute\} \/>/);
});

test("K12: Always: phone request falls back to Ask while Phone request is off", async () => {
  await setPreference("momoDefault", "phone");
  assert.equal((await momoConfig.getMerchantMomoSettings()).defaultMethod, "ask");
});

test("K12: with 61 skipped, Cancel and Pay another way still find the origin", () => {
  const entry = (current, params = {}) => ({ current, params });
  const state = { current: "MoMoWaiting", params: {}, history: [entry("Home"), entry("Sell", { amountPesewas: 300 }), entry("MoMoSetup"), entry("MoMoPayment")] };
  const next = returnToMomoOrigin(state);
  assert.equal(next.current, "Sell");
  assert.deepEqual(next.history, [entry("Home")]);
});

test("A5: Last used is empty until a method is actually used, then it is stored", async () => {
  assert.equal((await momoConfig.getMerchantMomoSettings()).lastUsed, "");
  assert.equal(typeof momoConfig.recordMomoLastUsed, "function");
  await momoConfig.recordMomoLastUsed("direct");
  assert.equal((await momoConfig.getMerchantMomoSettings()).lastUsed, "direct");
  await momoConfig.recordMomoLastUsed("phone");
  assert.equal((await momoConfig.getMerchantMomoSettings()).lastUsed, "", "phone is not a valid last used while Phone request is off");
});

test("A5/E10: 61 shows Last used only from the stored value, and its tiles are links, not toggles", () => {
  const choice = section("MoMoChoice", "MoMoDirect");
  assert.match(choice, /const lastUsed = settings\.lastUsed;/);
  assert.match(choice, /recordMomoLastUsed\("direct"\)/);
  assert.doesNotMatch(momoSource.slice(momoSource.indexOf("function ChoiceTile"), momoSource.indexOf("export function MoMoChoice")), /aria-pressed/);
});

test("E11: Resend on 57 looks and acts disabled only while it is disabled, and restarts the wait", () => {
  const waiting = section("MoMoWaiting", "MoMoCode");
  assert.match(waiting, /disabled=\{secondsRemaining > 0 \|\| !PHONE_REQUEST_ENABLED\}/);
  // Resend restarts the wait: a new end time (E5 made the wait an end time, not a tick count).
  assert.match(waiting, /onClick=\{\(\) => \{ setExpiresAt\(Date\.now\(\) \+ MOMO_WAIT_SECONDS \* 1000\); setNow\(Date\.now\(\)\); \}\}/);
  assert.doesNotMatch(waiting, /disabled:opacity-100/);
});

test("K16: POS_LINKS describe the real MoMo and split behaviour", () => {
  assert.ok(!hasLink("MoMoWaiting", "cancel", "MoMoPayment"), "57 Cancel no longer goes to 56");
  assert.ok(!hasLink("SettingsProfitTools", "back", "Home"), "47 Back goes back in history");
  assert.ok(hasLink("SettingsProfitTools", "back", "Menu"));
  assert.ok(hasLink("MoMoWaiting", "cancel", "Sell"));
  assert.ok(hasLink("MoMoChoice", "phone", "MoMoSetup"));
  assert.ok(hasLink("MoMoSetup", "save", "MoMoPayment"));
  assert.ok(hasLink("MoMoSetup", "saveFromSettings", "PaymentSettings"));
  assert.ok(hasLink("MoMoChoice", "always", "MoMoDirect"));
  assert.ok(hasLink("MoMoDirect", "collectionConfirmed", "PaymentReceived"));
  assert.ok(hasLink("MoMoDirect", "picked", "SplitPayment"));
  assert.ok(hasLink("MoMoDirect", "picked", "ALittleAtATime"));
  assert.ok(hasLink("MoMoNotCompleted", "payAnotherWay", "Sell"));
  assert.ok(hasLink("MoMoNotCompleted", "cancelSale", "Home"));
  assert.ok(hasLink("WhenWillTheyPay", "saveSplit", "SplitPayment"));
  assert.ok(hasLink("ALittleAtATime", "saveSplit", "SplitPayment"));
  assert.ok(hasLink("ALittleAtATime", "split", "SplitPayment"));
  assert.ok(hasLink("SplitPayment", "installmentReceived", "ALittleAtATime"));
  const failure = POS_LINKS.find((link) => link.from === "MoMoWaiting" && link.to === "MoMoNotCompleted");
  assert.equal(failure?.planned, true, "57 → 59 needs the Paystack backend");
});