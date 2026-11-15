import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";

// Wiring 16 (MOMO16, 12 Nov 2026): when the MoMo method resolves without a question (saved "Always:
// customer sends", or Phone request is not on), Save on "How much MoMo?" applies Direct on 16 at once.
// 61 is never rendered, and no history entry is added. 61 still opens when the owner must choose.
// Real PosApp: real screens, route state and fake browser history.

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  resetBrowserBack();
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
  await db.settings.put({ key: "momoReceivingNumber", value: "0241234567" });
  await db.settings.put({ key: "momoReceivingNetwork", value: "MTN" });
});

// Every render is recorded, so a screen that flashes for one render still shows up.
async function open(options) {
  const app = await openPosApp(options);
  after(() => app.restoreConsole());
  const visited = [];
  const rerender = app.view.rerender.bind(app.view);
  app.view.rerender = (...args) => { const result = rerender(...args); visited.push(app.route); return result; };
  return { app, visited };
}

async function toMomoEditor(app) {
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Split payment");
  await app.tap(/^MoMo$/);
}

const momoPart = (app) => app.params.splitParts.find((part) => part.paymentMethod === "momo");

test("16: with \"Always: customer sends\", Save on the MoMo editor ends on 16 and 61 is never rendered", async () => {
  await setPreference("momoDefault", "direct");
  const { app, visited } = await open();
  await toMomoEditor(app);
  const stackBefore = app.state.history.length;
  const browserBefore = window.history.entries.length;
  visited.length = 0;
  await app.tap(/^Save$/);
  assert.equal(app.route, "SplitPayment");
  assert.ok(!visited.includes("MoMoChoice"), `61 was rendered: ${visited.join(" > ")}`);
  assert.equal(momoPart(app).momoMethod, "direct");
  assert.equal(momoPart(app).verification, undefined, "not confirmed yet");
  assert.equal(momoPart(app).amountPesewas, 800);
  for (const key of ["pendingMomoAmountPesewas", "momoMethod", "verification", "pickOnly", "returnRoute"]) {
    assert.equal(app.params[key], undefined, `${key} is not left on 16`);
  }
  assert.equal(app.state.history.length, stackBefore, "no in-app history entry");
  assert.equal(window.history.entries.length, browserBefore, "no browser history entry");
  await app.phoneBack();
  assert.equal(app.route, "Sell", "phone back from 16 goes to 15, as without any MoMo");
});

test("16: with \"Ask me each time\" and Phone request available, 61 is shown", async () => {
  await setPreference("momoDefault", "ask");
  await setPreference("paystackPayoutNumber", "0241234567");
  const { app, visited } = await open();
  await toMomoEditor(app);
  await app.tap(/^Save$/);
  assert.equal(app.route, "MoMoChoice");
  assert.ok(visited.includes("MoMoChoice"));
  assert.match(app.text(), /How will they pay\?/);
});

test("16: with Phone request unavailable, 61 is not shown; Direct is applied on 16", async () => {
  await setPreference("momoDefault", "ask");
  const { app, visited } = await open({ env: {} });
  await toMomoEditor(app);
  const stackBefore = app.state.history.length;
  visited.length = 0;
  await app.tap(/^Save$/);
  assert.equal(app.route, "SplitPayment");
  assert.ok(!visited.includes("MoMoChoice"), `61 was rendered: ${visited.join(" > ")}`);
  assert.equal(momoPart(app).momoMethod, "direct");
  assert.equal(app.state.history.length, stackBefore);
  await app.phoneBack();
  assert.equal(app.route, "Sell");
});
