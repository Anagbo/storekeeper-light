import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { setPreference } from "../src/db/preferences.js";
import { recordExpense } from "../src/db/suppliers.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Audit item 3 (rules_global.person_names): a customer stored "KOFI MENSAH" and a supplier stored
// "MTN WHOLESALE" are shown as "Kofi Mensah" and "Mtn Wholesale" on every real screen they reach:
// visible text, accessible names and the WhatsApp links. Never the raw upper case, never the old
// "Kofi mensah". The stored values do not change.

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

after(async () => {
  db.close();
  await db.delete();
});

const DAY = 86_400_000;

beforeEach(async () => {
  resetBrowserBack();
  liveResults = new Map();
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings, db.saveAttempts, db.suppliers].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
  await setPreference("momoReceivingNumber", "0241234567");
  await setPreference("momoReceivingNetwork", "MTN");
  // Late (Home's urgent card) and with a phone (WhatsApp, Call).
  await recordCreditSale({ name: "KOFI MENSAH", phone: "0241234567", amountPesewas: 1000, dueDate: new Date(Date.now() - 5 * DAY).toISOString().slice(0, 10), now: Date.now() - 10 * DAY });
  await recordExpense({ amountPesewas: 8000, paidAmountPesewas: 3000, category: "stock", newSupplier: { name: "MTN WHOLESALE", phone: "0241234567" } });
});

async function open() {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  return app;
}

const nodes = (tree) => [...walk(tree)].filter((node) => node.props);
const RAW = /KOFI MENSAH|Kofi mensah|MTN WHOLESALE|Mtn wholesale/;

// Text, accessible names, titles and link targets (decoded) of the screen.
function everythingShown(app) {
  const all = nodes(app.view.tree);
  const labels = all.flatMap((node) => [node.props["aria-label"], node.props.title, node.props.alt]).filter((value) => typeof value === "string");
  const links = all.map((node) => node.props.href).filter((href) => typeof href === "string").map((href) => {
    try { return decodeURIComponent(href); } catch { return href; }
  });
  return [app.text(), ...labels, ...links].join(" | ");
}

function check(app, where, expected = /Kofi Mensah/) {
  const shown = everythingShown(app);
  assert.doesNotMatch(shown, RAW, `${where}: a raw name is shown`);
  assert.match(shown, expected, `${where}: ${app.text().slice(0, 300)}`);
}

async function go(app, route, params = {}) {
  const home = nodes(app.view.tree).find((node) => node.type?.name === "Home");
  if (!home) await app.tap("Home");
  nodes(app.view.tree).find((node) => node.type?.name === "Home").props.onNavigate(route, params);
  return app.settle();
}

async function storedNames() {
  return {
    customers: (await db.customers.toArray()).map((row) => row.name),
    debts: [...new Set((await db.debts.toArray()).map((row) => row.customerName))],
    suppliers: (await db.suppliers.toArray()).map((row) => row.name)
  };
}

test("customer KOFI MENSAH: Home 22, 32, 43, 25, 26, 27, 28 and 24 show Kofi Mensah", async () => {
  const before = await storedNames();
  const app = await open();
  check(app, "Home 22 card");
  assert.match(everythingShown(app), /WhatsApp Kofi Mensah|Call Kofi Mensah|Collect.*Kofi Mensah/, "Home card buttons");

  await app.tap(/^Owed$/);
  check(app, "32 list");
  assert.match(everythingShown(app), /Collect from Kofi Mensah/);

  const debt = (await db.debts.toArray()).find((row) => row.status === "unpaid");
  await go(app, "DebtorDetail", { debtId: debt.id, customerName: debt.customerName });
  assert.equal(app.route, "DebtorDetail");
  check(app, "43");
  assert.match(app.text(), /Kofi Mensah owes/);

  await go(app, "CollectPayment", { debtId: debt.id, customerName: debt.customerName });
  check(app, "25");
  await app.tap(/^Pay part$/);
  assert.equal(app.route, "CollectPayPart");
  check(app, "26");
  await app.keys(["4"]); // 26 is typed on the keypad only (15 Nov 2026)
  await app.tap(/Split payment$/);
  assert.equal(app.route, "SplitPayment");
  check(app, "27 (collect)");
  await app.tap(/^Cash$/);
  await app.tap("Edit Cash amount");
  await app.type("split-draft-amount", "4.00");
  await app.tap(/^Save$/);
  await app.tap(/^Done$/);
  if (app.route === "MoMoDirect") await app.tap("Money received");
  assert.equal(app.route, "PaymentReceived");
  check(app, "28");

  await go(app, "TodaysTransactions");
  check(app, "24 chips");

  assert.deepEqual(await storedNames(), before, "stored names unchanged");
});

test("customer KOFI MENSAH: 17, 18, 19, 16 Owe row, 31 and its contact sheet show Kofi Mensah", async () => {
  const before = await storedNames();
  const app = await open();
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Owe");
  check(app, "17 list");
  await app.type("Search name or phone", "kofi").catch(() => {});
  check(app, "17 search");
  await app.tap(/^KKofi Mensah/);
  await app.tap(/^Next/);
  assert.equal(app.route, "WhenWillTheyPay");
  check(app, "18");
  await app.tap(/A little at a time/);
  await app.type("How much each time?", "2");
  await app.tap("Today");
  await app.type("Amount paid today", "2");
  await app.tap(/Split payment$/);
  // 27 opened from 19 names nobody; only check that no raw name appears.
  assert.doesNotMatch(everythingShown(app), RAW, "27 (from 19)");
  await app.tap(/^Cash$/);
  await app.tap("Edit Cash amount");
  await app.type("split-draft-amount", "2.00");
  await app.tap(/^Save$/);
  await app.tap(/^Done$/);
  assert.equal(app.route, "ALittleAtATime");
  check(app, "19 pink row");
  await app.tap(/^Save plan$/);
  assert.equal(app.route, "CreditSaved");
  check(app, "31");
  assert.doesNotMatch(everythingShown(app), /WhatsApp Kofi Mensah/, "no reminder button on 31 (wiring, 14 Nov 2026)");
  // The contact sheet (54) is opened from 29/43's header now that 31 has no contact buttons.
  await app.tap(/See Kofi Mensah’s details/);
  assert.equal(app.route, "DebtorDetail");
  await app.tap("Edit contact");
  check(app, "54 contact sheet");
  await app.tap("Cancel");

  // 16: the Owe row of a split sale.
  await app.tap("Home");
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Split payment");
  await app.tap(/^Owe$/);
  await app.tap(/^KKofi Mensah/);
  await app.tap(/^Next/);
  await app.tap(/^Save/);
  assert.equal(app.route, "SplitPayment");
  check(app, "16 Owe row");

  assert.deepEqual(await storedNames(), before, "stored names unchanged");
});

test("supplier MTN WHOLESALE: 45 picker, 46 card and Pay sheet, 24 chip show Mtn Wholesale", async () => {
  const before = await storedNames();
  const app = await open();
  await go(app, "StockOnCredit", { amountPesewas: 5000 });
  assert.equal(app.route, "StockOnCredit");
  check(app, "45 picker", /Mtn Wholesale/);

  await go(app, "YouOweSuppliers");
  check(app, "46 card", /Mtn Wholesale/);
  assert.match(everythingShown(app), /Pay Mtn Wholesale/);
  assert.match(everythingShown(app), /Call Mtn Wholesale/);
  await app.tap("Pay Mtn Wholesale");
  check(app, "46 Pay sheet", /Pay Mtn Wholesale/);

  await go(app, "TodaysTransactions");
  check(app, "24 supplier chip", /You owe Mtn Wholesale/);
  assert.deepEqual(await storedNames(), before, "stored names unchanged");
});
