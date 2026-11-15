import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { displayName } from "../src/lib/displayName.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { setLiveQuery } from "./helpers/renderJsx.js";

// Wiring rules_global.person_names (12 Nov 2026): a name stored all lower case or all upper case is
// shown in Title Case; a mixed-case name is shown as typed with a capital first letter. The stored
// name never changes.

globalThis.HTMLElement ??= class {};

let liveResults = new Map();
setLiveQuery((deps, query) => {
  const key = `${String(query)}|${JSON.stringify(deps)}`;
  if (!liveResults.has(key)) {
    liveResults.set(key, undefined);
    Promise.resolve().then(query).then((value) => liveResults.set(key, value), () => liveResults.set(key, null));
  }
  return liveResults.get(key);
});

test("displayName: all lower or all upper case becomes Title Case", () => {
  assert.equal(displayName("KOFI MENSAH"), "Kofi Mensah");
  assert.equal(displayName("kofi mensah"), "Kofi Mensah");
  assert.equal(displayName("kofi wholesale"), "Kofi Wholesale");
  assert.equal(displayName("MTN WHOLESALE"), "Mtn Wholesale");
  assert.equal(displayName("juju"), "Juju");
  assert.equal(displayName("  AMA  "), "Ama");
  assert.equal(displayName("kofi   mensah"), "Kofi   Mensah", "spacing as typed");
  assert.equal(displayName("ÉSTHER ADJEI"), "Ésther Adjei");
});

test("displayName: a mixed-case name is shown as typed with a capital first letter", () => {
  assert.equal(displayName("Nana Yaa"), "Nana Yaa");
  assert.equal(displayName("Kofi McDonald"), "Kofi McDonald");
  assert.equal(displayName("kofi McDonald"), "Kofi McDonald");
  assert.equal(displayName("Kofi wholesale"), "Kofi wholesale");
});

test("displayName: empty and missing names", () => {
  assert.equal(displayName(""), "");
  assert.equal(displayName(undefined), "");
  assert.equal(displayName(null), "");
  assert.equal(displayName("123"), "123");
});

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  resetBrowserBack();
  liveResults = new Map();
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
});

test("a customer stored as KOFI MENSAH shows Kofi Mensah on 32 and 17; the database keeps KOFI MENSAH", async () => {
  await recordCreditSale({ name: "KOFI MENSAH", amountPesewas: 600, now: Date.now() - 86_400_000 });
  const app = await openPosApp();
  after(() => app.restoreConsole());
  await app.tap(/^Owed$/);
  assert.match(app.text(), /Kofi Mensah/);
  assert.doesNotMatch(app.text(), /KOFI MENSAH|Kofi mensah/);
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Owe");
  assert.match(app.text(), /KKofi Mensah/);
  const customers = await db.customers.toArray();
  assert.deepEqual(customers.map((row) => row.name), ["KOFI MENSAH"]);
  const debts = await db.debts.toArray();
  assert.deepEqual(debts.map((row) => row.customerName), ["KOFI MENSAH"]);
});
