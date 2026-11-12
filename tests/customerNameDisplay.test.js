import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { buildCollectionReceiptMessage } from "../src/pos/collectionReceipt.js";
import { buildCustomerBalanceReceipt } from "../src/pos/receiptTemplates.js";
import { describeSplitPart } from "../src/pos/splitTender.js";
import { createPosTransactionRows, describeTransactionRow } from "../src/pos/transactionFeed.js";
import { createInstallmentReminderLink } from "../src/utils/installments.js";
import { generateWhatsAppLink } from "../src/utils/whatsapp.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Wiring rules_global.person_names (decided 12 Nov 2026): person names are shown with a capital
// first letter everywhere, through the one shared displayName helper. The stored name is not
// changed. Customers stored as "juju" and "junior" show as "Juju" and "Junior".

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
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
  // juju is late (Home's urgent card, 43) and has a phone (WhatsApp, Edit contact); junior has neither.
  await recordCreditSale({ name: "juju", phone: "0241234567", amountPesewas: 1000, dueDate: new Date(Date.now() - 5 * DAY).toISOString().slice(0, 10), now: Date.now() - 10 * DAY });
  await recordCreditSale({ name: "junior", amountPesewas: 700, now: Date.now() - 3 * DAY });
});

async function open() {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  return app;
}

const shown = (app) => app.text().replace(/\s+/g, " ");
// Lowercase names must not appear anywhere on a screen (the visible text and accessible names).
function assertNoLowercaseNames(app, where) {
  const labels = [...walk(app.view.tree)].map((node) => node.props?.["aria-label"]).filter(Boolean).join(" | ");
  assert.doesNotMatch(shown(app), /\bjuju\b|\bjunior\b/, `${where}: visible text`);
  assert.doesNotMatch(labels, /\bjuju\b|\bjunior\b/, `${where}: accessible names`);
}

async function storedNames() {
  const customers = (await db.customers.toArray()).map((row) => row.name).sort();
  const debts = (await db.debts.toArray()).map((row) => row.customerName ?? row.customer_name).sort();
  return { customers, debts };
}

test("Home, 32 Owed, 17, 18, 31, the contact sheet and 43 show Juju and Junior; the stored names stay lowercase", async () => {
  const before = await storedNames();
  assert.deepEqual(before.customers, ["juju", "junior"]);
  const app = await open();

  assert.match(shown(app), /Juju/, "Home urgent card");
  assertNoLowercaseNames(app, "Home");

  await app.tap(/^Owed$/);
  assert.match(shown(app), /Juju/);
  assert.match(shown(app), /Junior/);
  assertNoLowercaseNames(app, "32");

  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Owe");
  assert.equal(app.route, "WhoOwesYou");
  assert.match(shown(app), /JJuju/, "17: initial and name");
  assert.match(shown(app), /JJunior/);
  assertNoLowercaseNames(app, "17");

  await app.tap(/^JJuju/);
  await app.tap(/^Next/);
  assert.equal(app.route, "WhenWillTheyPay");
  assert.match(shown(app), /When will Juju pay\?/);
  assertNoLowercaseNames(app, "18");

  await app.tap(/^Save/);
  assert.equal(app.route, "CreditSaved");
  const saved = shown(app);
  assert.match(saved, /Juju/);
  assert.match(saved, /WhatsApp Juju/);
  assert.match(saved, /See Juju’s details/);
  assertNoLowercaseNames(app, "31");
  const whatsapp = [...walk(app.view.tree)].find((node) => node.type === "a" && textOf(node).trim() === "WhatsApp Juju");
  assert.match(decodeURIComponent(whatsapp.props.href), /Hello \*Juju\*/, "WhatsApp text");

  await app.tap("Edit contact");
  assert.match(shown(app), /Contact details for Juju/);
  assertNoLowercaseNames(app, "31 Edit contact sheet");
  await app.tap("Cancel");

  await app.tap(/See Juju’s details/);
  assert.equal(app.route, "DebtorDetail");
  assert.match(shown(app), /Juju owes/);
  assertNoLowercaseNames(app, "43");

  assert.deepEqual(await storedNames(), before, "stored names are not changed");
});

test("16 and 27: the Owe row names the person with a capital", () => {
  const params = { customer: { name: "junior" }, installmentPlan: { isInstallmentPlan: true, installmentAmount: 500, frequency: "weekly", nextDueDate: "2026-11-19" } };
  assert.equal(describeSplitPart({ paymentMethod: "owe", amountPesewas: 700 }, params), "Junior · GH₵5.00 · Every week · first payment 19/11/2026");
  assert.equal(params.customer.name, "junior");
});

test("30: \"Junior still owes\"", async () => {
  const { default: SaleRecorded } = await loadJsx("src/pos/SaleRecorded.jsx");
  const transaction = {
    id: "t1", amountPesewas: 800, total_amount: 800, payment_method: "momo", cashReceivedPesewas: 0, momoReceivedPesewas: 300,
    paymentType: "credit", customer_name: "junior", customerName: "junior", creditExtendedPesewas: 500,
    items_json: JSON.stringify([{ name: "Sale", quantity: 1, total_amount: 800 }]), createdAt: Date.now(), timestamp: Date.now()
  };
  const text = textOf(render({ type: SaleRecorded, props: { transaction, shopName: "Shop", onDone() {}, onNewSale() {} } }).tree);
  assert.match(text, /Junior still owes/);
  assert.doesNotMatch(text, /\bjunior\b/);
  assert.equal(transaction.customer_name, "junior");
});

test("24: the transaction chip names the person with a capital", () => {
  const rows = createPosTransactionRows([{
    id: "t1", type: "sale", paymentType: "credit", amountPesewas: 800, total_amount: 800, creditExtendedPesewas: 800,
    customer_name: "juju", customerName: "juju", createdAt: Date.now(), timestamp: Date.now()
  }], new Map());
  const text = JSON.stringify(rows.map(describeTransactionRow));
  assert.match(text, /"label":"Juju"/);
  assert.doesNotMatch(text, /"label":"juju"/);
});

test("WhatsApp and receipt text name the person with a capital", () => {
  assert.match(decodeURIComponent(generateWhatsAppLink("0241234567", "juju", 1000, "Shop")), /Hello \*Juju\*/);
  assert.match(decodeURIComponent(createInstallmentReminderLink("0241234567", "junior", 500, { type: "overdue", days: 2 })), /Hi Junior,/);
  assert.match(buildCollectionReceiptMessage({ customerName: "juju", createdAt: Date.now(), amountPesewas: 500, parts: [{ paymentMethod: "cash", amountPesewas: 500 }], remainingPesewas: 0 }, "Shop"), /From: Juju/);
  assert.match(buildCustomerBalanceReceipt({ shopName: "Shop", customerName: "junior", balancePesewas: 700 }), /Junior/);
  assert.doesNotMatch(buildCustomerBalanceReceipt({ shopName: "Shop", customerName: "junior", balancePesewas: 700 }), /\bjunior\b/);
});
