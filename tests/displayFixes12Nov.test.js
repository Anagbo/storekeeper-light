import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { displayName } from "../src/lib/displayName.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Five display fixes (12 Nov 2026), no money logic: 19 single-method Paying today panel, 26 wording,
// 30 owed line and Total owed, hyphen Title Case, no GH₵0.00 payment parts on 28, 30 and 31.

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

beforeEach(async () => {
  resetBrowserBack();
  liveResults = new Map();
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
  await db.settings.put({ key: "momoReceivingNumber", value: "0241234567" });
  await db.settings.put({ key: "momoReceivingNetwork", value: "MTN" });
  await recordCreditSale({ name: "Juju", amountPesewas: 1000, now: Date.now() - 3 * 86_400_000 });
});

async function open() {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  return app;
}

const shown = (app) => app.text().replace(/\s+/g, " ");
const nodes = (tree) => [...walk(tree)].filter((node) => node.props);
const pinkRow = (app) => nodes(app.view.tree).find((node) => node.props["data-still-owed"] !== undefined);
const panel = (app) => nodes(app.view.tree).find((node) => node.props["data-single-method-panel"] !== undefined);

// Juju owes GH₵10.00; a GH₵8.00 sale on credit with a plan: 19 shows Owed GH₵18.00.
async function to19(app) {
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Owe");
  await app.tap(/^JJuju/);
  await app.tap(/^Next/);
  await app.tap(/A little at a time/);
  assert.equal(app.route, "ALittleAtATime");
  await app.type("How much each time?", "4");
}

// ---- 1. 19: Paying today panel for one method ----

test("19 Cash only: one Cash row, Total today and the pink Still owed row (18.00 - 3.00 = 15.00)", async () => {
  const app = await open();
  await to19(app);
  await app.tap("Today");
  await app.type("Amount paid today", "3");
  const box = panel(app);
  assert.ok(box, "panel shown");
  const text = textOf(box).replace(/\s+/g, " ");
  assert.match(text, /Paying today/);
  assert.match(text, /Cash.*GH₵3\.00/);
  assert.doesNotMatch(text, /MoMo/, "one row only");
  assert.match(text, /Total today.*GH₵3\.00/);
  assert.equal(textOf(pinkRow(app)), "Still owed · JujuGH₵15.00");
});

test("19 MoMo only: one MoMo row, Total today and the pink Still owed row", async () => {
  const app = await open();
  await to19(app);
  await app.tap("Today");
  await app.type("Amount paid today", "3");
  await app.tap(/^MoMo$/);
  await app.tap(/Customer sends to my number/);
  assert.equal(app.route, "ALittleAtATime");
  const text = textOf(panel(app) ?? pinkRow(app).parent ?? pinkRow(app)).replace(/\s+/g, " ");
  assert.match(shown(app), /Paying today/);
  assert.match(shown(app), /MoMo.*GH₵3\.00/);
  assert.match(shown(app), /Total today.*GH₵3\.00/);
  assert.equal(textOf(pinkRow(app)), "Still owed · JujuGH₵15.00");
  assert.ok(text);
});

test("19 Next cycle or nothing paid today: no Paying today panel", async () => {
  const app = await open();
  await to19(app);
  assert.doesNotMatch(shown(app), /Paying today/, "Next cycle (default)");
  await app.tap("Today");
  await app.type("Amount paid today", "3");
  assert.match(shown(app), /Paying today/);
  await app.type("Amount paid today", "0");
  assert.equal(panel(app), undefined, "amount zero");
  await app.type("Amount paid today", "3");
  await app.tap(/^Next/);
  assert.equal(panel(app), undefined, "back to Next cycle");
  assert.equal(pinkRow(app), undefined);
});

// ---- 2. 26 and 28 wording ----

async function to26(app, amount) {
  const debt = (await db.debts.toArray()).find((row) => row.status === "unpaid");
  const home = nodes(app.view.tree).find((node) => node.type?.name === "Home");
  home.props.onNavigate("CollectPayment", { debtId: debt.id, customerName: "Juju" });
  await app.settle();
  await app.tap(/^Pay part$/);
  assert.equal(app.route, "CollectPayPart");
  await app.keys(String(amount).split("")); // 26 is typed on the keypad only (15 Nov 2026)
}

test("26 says \"Still owed after this\", never \"Left to pay\"; 28 says \"Juju still owes\" with the same figure", async () => {
  const app = await open();
  await to26(app, "7");
  assert.match(shown(app), /Still owed after this: GH₵3\.00/);
  assert.doesNotMatch(shown(app), /Left to pay/);
  await app.tap(/^Cash$/);
  await app.tap(/^Received$/);
  assert.equal(app.route, "PaymentReceived");
  assert.match(shown(app), /Juju still owes ?GH₵3\.00/);
});

// ---- 5. 28: no zero payment part ----

test("28 after a cash-only payment lists no MoMo GH₵0.00 row", async () => {
  const app = await open();
  await to26(app, "7");
  await app.tap(/^Cash$/);
  await app.tap(/^Received$/);
  assert.equal(app.route, "PaymentReceived");
  const text = shown(app);
  assert.match(text, /Cash ?GH₵7\.00/);
  assert.doesNotMatch(text, /MoMo[^G]{0,30}GH₵0\.00/);
  assert.doesNotMatch(text, /Cash[^G]{0,30}GH₵0\.00/);
});

// ---- 5. 31: no zero payment part ----

test("31 after a cash-only payment lists no MoMo GH₵0.00 row", async () => {
  const app = await open();
  await to19(app);
  await app.tap("Today");
  await app.type("Amount paid today", "3");
  await app.tap(/^Save plan$/);
  assert.equal(app.route, "CreditSaved");
  const text = shown(app);
  assert.match(text, /Cash ?GH₵3\.00/);
  assert.doesNotMatch(text, /(MoMo|Cash)[^G]{0,30}GH₵0\.00/);
});

// ---- 3 and 5. 30: owed line, Total owed, no zero parts ----

const sale = (extra = {}) => ({
  id: "t1", amountPesewas: 800, total_amount: 800, payment_method: "cash", cashReceivedPesewas: 300, momoReceivedPesewas: 0,
  paymentType: "credit", customer_name: "Juju", customerName: "Juju", creditExtendedPesewas: 500,
  items_json: JSON.stringify([{ name: "Sale", quantity: 1, total_amount: 800 }]), createdAt: Date.now(), timestamp: Date.now(), ...extra
});

async function screen30(props) {
  const { default: SaleRecorded } = await loadJsx("src/pos/SaleRecorded.jsx");
  const tree = render({ type: SaleRecorded, props: { shopName: "Shop", onDone() {}, onNewSale() {}, ...props } }).tree;
  return textOf(tree).replace(/\s+/g, " ");
}

test("30 without an earlier balance: \"Juju owes GH₵5.00 from this sale\", no Total owed line", async () => {
  const text = await screen30({ transaction: sale(), creditResult: { previousDebtPesewas: 0, totalDebtPesewas: 500 } });
  assert.match(text, /Juju owes GH₵5\.00 from this sale/);
  assert.doesNotMatch(text, /Total owed/);
  assert.doesNotMatch(text, /still owes/);
});

test("30 with an earlier balance: one quiet \"Total owed GH₵15.00\" line under it", async () => {
  const text = await screen30({ transaction: sale(), creditResult: { previousDebtPesewas: 1000, totalDebtPesewas: 1500 } });
  assert.match(text, /Juju owes GH₵5\.00 from this saleTotal owed GH₵15\.00/);
  assert.equal(text.match(/Total owed/g).length, 1);
});

test("30 after a cash-only part lists no MoMo GH₵0.00 row; a MoMo-only part lists no Cash GH₵0.00 row", async () => {
  const cash = await screen30({ transaction: sale(), creditResult: { previousDebtPesewas: 0, totalDebtPesewas: 500 } });
  assert.match(cash, /Cash ?GH₵3\.00/);
  assert.doesNotMatch(cash, /MoMo[^G]{0,30}GH₵0\.00/);
  const momo = await screen30({ transaction: sale({ payment_method: "momo", cashReceivedPesewas: 0, momoReceivedPesewas: 300 }) });
  assert.match(momo, /MoMo[^G]{0,30}GH₵3\.00/);
  assert.doesNotMatch(momo, /Cash ?GH₵0\.00/);
});

test("30 with a Cash + MoMo split paid in full shows both paid parts and no GH₵0.00 owed row", async () => {
  const text = await screen30({ transaction: sale({ payment_method: "split", cashReceivedPesewas: 500, momoReceivedPesewas: 300, creditExtendedPesewas: 0 }) });
  assert.match(text, /Cash ?GH₵5\.00/);
  assert.match(text, /MoMo[^G]{0,30}GH₵3\.00/);
  assert.doesNotMatch(text, /GH₵0\.00/);
});

// ---- 4. hyphen names ----

test("displayName: Title Case also capitalises the letter after a hyphen; stored names stay as they are", () => {
  assert.equal(displayName("FRIMPOMAA-BOATENG"), "Frimpomaa-Boateng");
  assert.equal(displayName("frimpomaa-boateng"), "Frimpomaa-Boateng");
  assert.equal(displayName("ama serwaa-mensah"), "Ama Serwaa-Mensah");
  assert.equal(displayName("Nana-yaa"), "Nana-yaa", "mixed case is shown as typed");
});

test("a hyphenated customer shows Title Case on 30 and the stored name is unchanged", async () => {
  const transaction = sale({ customer_name: "FRIMPOMAA-BOATENG", customerName: "FRIMPOMAA-BOATENG" });
  const text = await screen30({ transaction, creditResult: { previousDebtPesewas: 0, totalDebtPesewas: 500 } });
  assert.match(text, /Frimpomaa-Boateng owes GH₵5\.00 from this sale/);
  assert.equal(transaction.customer_name, "FRIMPOMAA-BOATENG");
});
