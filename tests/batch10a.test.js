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

// Status rows on 16 (17 Nov 2026) replace the one-line status: label-value pairs from splitPartRows.
const pairs = (rows) => rows.map((row) => [row.label, row.value]);

test("K3: rows on 16 show the MoMo status and the Owe person and terms", () => {
  const { splitPartRows } = splitTender;
  assert.equal(typeof splitPartRows, "function");
  assert.deepEqual(pairs(splitPartRows({ paymentMethod: "momo", momoMethod: "direct" })), [["Status", "Not confirmed yet"]]);
  assert.deepEqual(pairs(splitPartRows({ paymentMethod: "momo", momoMethod: "direct", verification: "merchant_confirmed" })), [["Status", "Received ✓"]]);
  assert.deepEqual(pairs(splitPartRows({ paymentMethod: "momo", momoMethod: "paystack", verification: "verified" })), [["Status", "Received ✓"]]);
  assert.deepEqual(pairs(splitPartRows({ paymentMethod: "momo", momoMethod: "paystack" })), [["Status", "Not confirmed yet"]]);
  assert.deepEqual(splitPartRows({ paymentMethod: "momo" }), []);
  assert.deepEqual(splitPartRows({ paymentMethod: "cash" }), []);
  assert.deepEqual(splitPartRows({ paymentMethod: "owe" }, {}), []);
  assert.deepEqual(
    pairs(splitPartRows({ paymentMethod: "owe" }, { customer: { name: "Amoto" }, installmentPlan: { isInstallmentPlan: true, installmentAmount: 250, frequency: "weekly" }, firstPaymentDate: "2026-11-20" })),
    [["Person", "Amoto"], ["Payment", "GH₵2.50 weekly"], ["First payment", "20/11/2026"]]
  );
  assert.deepEqual(pairs(splitPartRows({ paymentMethod: "owe" }, { customer: { name: "Kofi" }, dueDate: "2099-03-07", payBackLabel: "In 1 week" })), [["Person", "Kofi"], ["Due", "07/03/2099"]]);
  // 19's Paying today panel keeps its one-line MoMo status.
  assert.equal(splitTender.describeSplitPart({ paymentMethod: "momo", momoMethod: "direct" }), "Customer sends · not confirmed yet");
});

test("K3: 16 passes the status rows to the shared split screen, which shows them under the method", () => {
  assert.match(read("SaleSplitPayment.jsx"), /partRows=\{\(part\) => splitPartRows\(part, params\)\}/);
  const split = read("SplitPayment.jsx");
  assert.match(split, /partRows = \(\) => \[\]/);
  assert.match(split, /const rows = partRows\(part\);/);
});

test("K6: the Split button on 19 is named Split payment; 27 opened from 19 says Done (12 Nov 2026)", () => {
  assert.match(read("CreditScreens.jsx"), /aria-label=\{method === "split" \? t\("split\.title"\) : undefined\}/);
  assert.match(read("InstallmentSplitPayment.jsx"), /doneLabel=\{t\("split\.done"\)\}/);
});

test("K12: an Always: customer sends setting on 63 skips 61 straight to 62", () => {
  const choice = section("MoMoChoice", "MoMoDirect");
  // chooseDirect(true) replaces 61 with 62. A pick from 16 (confirmAtDone) returns to 16 instead,
  // because there 62 comes after Done (MOMO16); 16's Always case is driven in splitDirectAtDone16.
  assert.ok(choice.includes(`if (settings.defaultMethod === "direct") chooseDirect(true);`));
  assert.ok(choice.includes(`else if (replace) onReplace("MoMoDirect", { ...params, momoMethod: "direct" });`));
  assert.match(read("PosApp.jsx"), /<MoMoChoice params=\{routeState\.params\} onBack=\{navigateBack\} onNavigate=\{navigate\} onReplace=\{replaceCurrentRoute\} onPick=/);
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
  // 47 Back goes back in history (to the page the Menu drawer was opened on; Home with nothing behind).
  assert.equal(POS_LINKS.find((link) => link.from === "SettingsProfitTools" && link.action === "back")?.via, "history", "47 Back goes back in history");
  assert.ok(!POS_LINKS.some((link) => link.to === "Menu" || link.from === "Menu"), "the Menu is a drawer, not a route");
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