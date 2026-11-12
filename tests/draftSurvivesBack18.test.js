import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";

// Wiring 19 "Draft survives Back" (12 Nov 2026), 18 When will they pay: the chosen day survives
// A little at a time (19) and Back, and Back to 17 and Next again.

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  resetBrowserBack();
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
  await recordCreditSale({ name: "Juju", amountPesewas: 500, now: Date.now() - 86_400_000 });
});

async function open() {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  return app;
}

for (const [name, back] of [["on-screen Back", (app) => app.tap("Back")], ["phone back", (app) => app.phoneBack()]]) {
  test(`18: In 2 weeks survives 19 and ${name}, and ${name} to 17 and Next again`, async () => {
    const app = await open();
    await app.tap(/^Sell$/);
    await app.keys(["8"]);
    await app.tap("Owe");
    await app.tap(/^JJuju/);
    await app.tap(/^Next/);
    assert.equal(app.route, "WhenWillTheyPay");
    await app.tap("In 2 weeks");
    await app.tap(/^A little at a time/);
    await back(app);
    assert.equal(app.route, "WhenWillTheyPay");
    assert.equal(app.button("In 2 weeks").props["aria-pressed"], true);
    await back(app);
    assert.equal(app.route, "WhoOwesYou");
    await app.tap(/^Next/);
    assert.equal(app.button("In 2 weeks").props["aria-pressed"], true);
    assert.equal(app.button("In 1 week").props["aria-pressed"], false);
  });
}
