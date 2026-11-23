import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";

beforeEach(async () => {
  resetBrowserBack();
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
  await db.settings.put({ key: "momoReceivingNumber", value: "0241234567" });
  await db.settings.put({ key: "momoReceivingNetwork", value: "MTN" });
});
after(async () => {
  db.close();
  await db.delete();
});

const shown = (app) => app.text().replace(/\s+/g, " ");

async function open16() {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Split payment");
  return app;
}

test("16: Left to pay is shown while something is left, hidden when the parts add up, back after a part is removed", async () => {
  const app = await open16();
  assert.match(shown(app), /Left to payGH₵8\.00/);
  await app.tap(/^Cash$/);
  assert.doesNotMatch(shown(app), /Left to pay/);
  await app.tap("Remove Cash");
  assert.match(shown(app), /Left to payGH₵8\.00/);
});

test("16: changing a part so something is left brings Left to pay back", async () => {
  const app = await open16();
  await app.tap(/^Cash$/);
  assert.doesNotMatch(shown(app), /Left to pay/);
  await app.tap("Edit Cash amount");
  await app.type("split-draft-amount", "3.00");
  await app.tap(/^Save$/);
  assert.match(shown(app), /Left to payGH₵5\.00/);
});
