import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Screens 28 (Payment received), 30 (Sale recorded) and 31 (Credit saved), real screens through the
// real PosApp: each paid part is its own row, an owed part is a separate row that is not part of any
// total, and on 31 "Total received" is the sum of the paid rows above it.

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

const nodes = (tree) => [...walk(tree)].filter((node) => node.props);
const AMOUNT_LINE = /^[^\d]*GH₵\s*[\d,]+\.\d{2}$/;
const squash = (node) => textOf(node).replace(/\s+/g, " ").trim();
const cedis = (text) => Number(/GH₵\s*([\d,]+\.\d{2})/.exec(text)?.[1].replace(/,/g, "") ?? NaN);

// Every "label amount" line on the screen: a div holding a label and one amount, with no other such
// line inside it. Returned in screen order.
function rowsOf(app) {
  const found = [];
  for (const node of nodes(app.view.tree)) {
    if (node.type !== "div") continue;
    const text = squash(node);
    if (!AMOUNT_LINE.test(text)) continue;
    if (nodes(node).some((child) => child !== node && child.type === "div" && AMOUNT_LINE.test(squash(child)))) continue;
    found.push({ label: text.replace(/GH₵.*$/, "").trim(), amount: cedis(text) });
  }
  return found;
}
const named = (rows, pattern) => rows.filter((row) => pattern.test(row.label));
const show = (rows) => JSON.stringify(rows);

async function to19(app, paidToday) {
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Owe");
  await app.tap(/^JJuju/);
  await app.tap(/^Next/);
  await app.tap(/A little at a time/);
  await app.type("How much each time?", "4");
  await app.tap("Today");
  await app.type("Amount paid today", paidToday);
}

async function splitPart(app, method, amount) {
  await app.tap(new RegExp(`^${method}$`));
  if (method === "Cash") await app.tap("Edit Cash amount");
  await app.type("split-draft-amount", amount);
  await app.tap(/^Save$/);
}

// rules_global.saved_credit_layout (25 Nov 2026): on 31 the payment taken today is ONE "Paid today" row
// (no sub-row per method, plain "Paid today" when two methods were used). What this protected stays: the
// paid figure is the sum of the parts (Cash 1.00 + MoMo 2.00), and the GH₵5.00 owed from this sale is not in it.
test("31: one Paid today row holds the sum of Cash and MoMo, the GH₵5.00 owed is not in it", async () => {
  const app = await open();
  await to19(app, "3");
  await app.tap(/Split payment$/);
  await splitPart(app, "Cash", "1.00");
  await splitPart(app, "MoMo", "2.00");
  await app.tap(/^Customer sends to my number/);
  await app.tap(/^Done$/);
  await app.tap(/^Save plan$/);
  await app.tap(/^Money received$/);
  assert.equal(app.route, "CreditSaved");
  const rows = rowsOf(app);
  const paid = named(rows, /^Paid today/);
  assert.equal(paid.length, 1, show(rows));
  assert.equal(paid[0].label.replace(/[−\s]+$/, ""), "Paid today", "two methods: the plain label");
  assert.equal(paid[0].amount, 1 + 2, "Paid today = Cash + MoMo");
  assert.equal(named(rows, /^(Cash|MoMo|Total received)/).length, 0, `no sub-row per method ${show(rows)}`);
  assert.deepEqual(rows.map((row) => row.label.replace(/[−\s]+$/, "")), ["Before", "This sale", "Paid today", "Now owes"], show(rows));
  assert.ok(paid[0].amount !== 5 && paid[0].amount !== 8, "the owed GH₵5.00 is not in the paid row");
});

test("30: Cash and MoMo are separate rows and the GH₵3.00 owed is its own row after them", async () => {
  const app = await open();
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Split payment");
  await splitPart(app, "Cash", "3.00");
  await splitPart(app, "MoMo", "2.00");
  await app.tap(/^Customer sends to my number/);
  await app.tap(/^Owe$/);
  await app.tap(/^JJuju/);
  await app.tap(/^Next/);
  await app.tap(/A little at a time/);
  await app.type("How much each time?", "60");
  await app.tap(/^Save plan$/);
  await app.tap(/^Done$/);
  if (app.route === "MoMoDirect") await app.tap("Money received");
  assert.equal(app.route, "SaleRecorded");
  const rows = rowsOf(app);
  const cash = named(rows, /^Cash/);
  const momo = named(rows, /^MoMo/);
  const owedText = app.text().replace(/\s+/g, " ");
  assert.equal(cash.length, 1, show(rows));
  assert.equal(momo.length, 1, show(rows));
  assert.match(owedText, /Juju owesfrom this saleGH₵3.00/, "the owed part is its own line");
  assert.equal(cash[0].amount, 3);
  assert.equal(momo[0].amount, 2);
  assert.ok(owedText.indexOf("Juju owes") > owedText.search(/MoMo/), "owed line comes after the paid rows");
});

test("28: Cash and MoMo are separate rows and what Juju still owes is its own row after them", async () => {
  const app = await open();
  const debt = (await db.debts.toArray()).find((row) => row.status === "unpaid");
  const home = nodes(app.view.tree).find((node) => node.type?.name === "Home");
  home.props.onNavigate("CollectPayment", { debtId: debt.id, customerName: "Juju" });
  await app.settle();
  await app.tap(/^Pay part$/);
  assert.equal(app.route, "CollectPayPart");
  await app.keys(["7"]); // 26 is typed on the keypad only (15 Nov 2026)
  await app.tap(/Split payment$/);
  await splitPart(app, "Cash", "4.00");
  await splitPart(app, "MoMo", "3.00");
  await app.tap(/^Customer sends to my number/);
  await app.tap(/^Done$/);
  if (app.route === "MoMoDirect") await app.tap("Money received");
  assert.equal(app.route, "PaymentReceived");
  const rows = rowsOf(app);
  const cash = named(rows, /^Cash/);
  const momo = named(rows, /^MoMo/);
  const owed = named(rows, /still owes/);
  assert.equal(cash.length, 1, show(rows));
  assert.equal(momo.length, 1, show(rows));
  assert.equal(owed.length, 1, show(rows));
  assert.equal(cash[0].amount, 4);
  assert.equal(momo[0].amount, 3);
  assert.equal(owed[0].amount, 3, "GH₵10.00 owed - GH₵7.00 paid");
  assert.ok(rows.indexOf(owed[0]) > rows.indexOf(momo[0]), "owed row comes after the paid rows");
});
