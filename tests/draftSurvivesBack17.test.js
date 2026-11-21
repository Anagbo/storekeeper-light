import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";

// draft_survives_trip_away (12 Nov 2026), 17 Who owes you: the search text and the chosen person
// survive a trip to 34 (or 18) and Back, in the route params. A new task starts empty.

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  resetBrowserBack();
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
  await recordCreditSale({ name: "Juju", amountPesewas: 500, now: Date.now() - 86_400_000 });
  await recordCreditSale({ name: "Ama", amountPesewas: 900, now: Date.now() - 86_400_000 });
});

async function open() {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  return app;
}

const SEARCH = "Search by name or phone";

async function to17(app) {
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Owe");
  assert.equal(app.route, "WhoOwesYou");
}

for (const [name, back] of [["on-screen Back", (app) => app.tap("Back")], ["phone back", (app) => app.phoneBack()]]) {
  test(`17: the search text survives New person (34) and ${name}`, async () => {
    const app = await open();
    await to17(app);
    await app.type(SEARCH, "ju");
    await app.tap(/New person/);
    assert.equal(app.route, "NewPerson");
    await back(app);
    assert.equal(app.route, "WhoOwesYou");
    assert.equal(app.input(SEARCH).props.value, "ju");
    assert.match(app.text(), /Juju/);
    assert.doesNotMatch(app.text(), /Ama/, "the list is still filtered");
  });

  test(`17: the chosen person survives Next > 18 > ${name}`, async () => {
    const app = await open();
    await to17(app);
    await app.tap(/^JJuju/);
    await app.tap(/^Next/);
    assert.equal(app.route, "WhenWillTheyPay");
    await back(app);
    assert.equal(app.route, "WhoOwesYou");
    assert.equal(app.button(/^JJuju/).props["aria-pressed"], true);
  });
}

test("17: header Home clears the search; a new sale starts with an empty search", async () => {
  const app = await open();
  await to17(app);
  await app.type(SEARCH, "ju");
  await app.tap(/New person/);
  await app.goHome(); // header Home: Menu > Home on the phone (the hidden side menu is gone)
  await to17(app);
  assert.equal(app.input(SEARCH).props.value, "");
});

test("17: typing 024 and 24 shows the same person; 0 alone hides nobody (phone search, 4b)", async () => {
  await db.customers.clear();
  await db.debts.clear();
  await recordCreditSale({ name: "Ama", phone: "+233241234567", amountPesewas: 900, now: Date.now() - 86_400_000 });
  await recordCreditSale({ name: "Juju", phone: "0551112222", amountPesewas: 500, now: Date.now() - 86_400_000 });
  const app = await open();
  await to17(app);
  for (const typed of ["024", "24", "024 123 4567", "+233 24 123"]) {
    await app.type(SEARCH, typed);
    assert.match(app.text(), /Ama/, typed);
    assert.doesNotMatch(app.text(), /Juju/, typed);
  }
  await app.type(SEARCH, "0");
  assert.match(app.text(), /Ama/);
  assert.match(app.text(), /Juju/);
});
