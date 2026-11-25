import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Audit item 4: "what is still owed" agrees on every screen. The figure is the customer's balance
// after this sale and after today's payment. Kofi already owes GH₵10.00 (late), so a screen that shows
// only this sale's part would disagree and is caught.
// By the wiring, 24's pink chip ("{Name} owes GH₵x", 24 rule 2) and 30's line ("{Name} still owes
// GH₵x", 16 rule 1) are the owed part of that one sale, not the balance; they are checked against
// that contract figure and listed in the report as a design question.
// 27 opened from 26 or 19 shows a payment total and no balance, so it gets the quiet pink line
// "Still owed · {Name} GH₵{after this payment}" (same style as 19). 16 does not.

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
  await setPreference("momoReceivingNumber", "0241234567");
  await setPreference("momoReceivingNetwork", "MTN");
  await recordCreditSale({ name: "kofi", phone: "0241234567", amountPesewas: 1000, dueDate: new Date(Date.now() - 5 * DAY).toISOString().slice(0, 10), now: Date.now() - 10 * DAY });
});

async function open() {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  return app;
}

const nodes = (tree) => [...walk(tree)].filter((node) => node.props);
const cedis = (text) => Math.round(Number(String(text).replace(/[^0-9.]/g, "")) * 100);
const flat = (app) => app.text().replace(/\s+/g, " ");
function amountAfter(app, pattern, where) {
  const match = flat(app).match(pattern);
  assert.ok(match, `${where}: ${pattern} not found in ${flat(app).slice(0, 400)}`);
  return cedis(match[1]);
}
function stillOwedLine(app) {
  const row = nodes(app.view.tree).find((node) => node.props["data-still-owed"] !== undefined);
  return row ? { text: textOf(row).replace(/\s+/g, " ").trim(), pesewas: cedis(textOf(row).match(/GH₵[\d,.]+/g).at(-1)), className: row.props.className } : null;
}

async function go(app, route, params = {}) {
  if (!nodes(app.view.tree).find((node) => node.type?.name === "Home")) await app.goHome();
  nodes(app.view.tree).find((node) => node.type?.name === "Home").props.onNavigate(route, params);
  return app.settle();
}

// What the balance screens say afterwards: Home 22 card, 32 list, 43 balance card. null = Kofi not listed.
async function balanceScreens(app) {
  const debt = (await db.debts.toArray()).find((row) => (row.customerName ?? "").toLowerCase() === "kofi");
  await app.goHome();
  liveResults = new Map();
  await app.settle();
  const home = flat(app).match(/Collect first ?Kofi.*?(GH₵[\d,]+\.\d{2})/);
  await app.tap(/^Owed$/);
  // 32 draws Home's person row (chunk C): the due tag sits between the name and the amount in text order.
  const list = flat(app).match(/Kofi.*?(GH₵[\d,]+\.\d{2})/);
  await go(app, "DebtorDetail", { debtId: debt.id, customerName: debt.customerName });
  // 43 at zero reads "Nothing owed" (297db30), which counts as 0.
  const detail = amountAfter(app, /Kofi owes ?(GH₵[\d,]+\.\d{2}|Nothing owed)/, "43");
  await go(app, "TodaysTransactions");
  const chip = flat(app).match(/Kofi owes (GH₵[\d,]+\.\d{2})/);
  return { home22: home ? cedis(home[1]) : null, list32: list ? cedis(list[1]) : null, detail43: detail, chip24: chip ? cedis(chip[1]) : null };
}

async function to19(app) {
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Owe");
  await app.tap(/^KKofi/);
  await app.tap(/^Next/);
  await app.tap(/A little at a time/);
  await app.type("How much each time?", "2");
  await app.tap("Today");
  await app.type("Amount paid today", "3");
}

async function addPart(app, method, amount, firstCash = false) {
  await app.tap(new RegExp(`^${method}$`));
  if (firstCash) await app.tap("Edit Cash amount");
  await app.type("split-draft-amount", amount);
  await app.tap(/^Save$/);
}

// (a) plain credit sale GH₵8.00, GH₵3.00 paid today on 19: balance 10 + 8 - 3 = 15.
for (const how of ["cash", "momo", "split"]) {
  test(`(a) credit sale, payment today by ${how}: 19, 31, Home 22, 32 and 43 all say GH₵15.00; 24 chip is the sale's part GH₵5.00`, async () => {
    const app = await open();
    await to19(app);
    let paid19 = null;
    if (how === "momo") {
      await app.tap(/^MoMo$/);
      await app.tap(/Customer sends to my number/);
    } else if (how === "split") {
      await app.tap(/Split payment$/);
      await addPart(app, "Cash", "1.00", true);
      await addPart(app, "MoMo", "2.00");
      await app.tap(/^Customer sends to my number/);
      assert.equal(app.route, "SplitPayment");
      assert.equal(stillOwedLine(app)?.pesewas, 1500, "27 from 19: Still owed line");
      await app.tap(/^Done$/);
      paid19 = stillOwedLine(app);
      assert.equal(paid19?.pesewas, 1500, "19 pink row");
      assert.equal(paid19.text, "Still owed · KofiGH₵15.00");
    }
    // Cash or MoMo alone: 19 shows the one-row Paying today panel (12 Nov 2026) with the pink row.
    if (how !== "split") assert.equal(stillOwedLine(app)?.pesewas, 1500, "19 pink row, single method");
    await app.tap(/^Save plan$/);
    if (app.route === "MoMoDirect") await app.tap("Money received");
    assert.equal(app.route, "CreditSaved");
    const owes31 = amountAfter(app, /owes (GH₵[\d,]+\.\d{2})/, "31");
    assert.equal(owes31, 1500);
    const after = await balanceScreens(app);
    assert.deepEqual(after, { home22: 1500, list32: 1500, detail43: 1500, chip24: 500 });
  });
}

// (b) split on 16: Cash 3.00 + Owe 5.00. 18 and the balance screens say 15.00. 16's Owe row and Left
// to pay, 30's "still owes" and 24's chip are the owed part of this sale (5.00) by the wiring.
test("(b) split from 16 with an Owe part: 18, Home 22, 32 and 43 say GH₵15.00; 16, 30 and 24 the sale's part GH₵5.00", async () => {
  const app = await open();
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Split payment");
  await addPart(app, "Cash", "3.00", true);
  assert.equal(amountAfter(app, /Left to pay ?(GH₵[\d,]+\.\d{2})/, "16"), 500);
  await app.tap(/^Owe$/);
  await app.tap(/^KKofi/);
  await app.tap(/^Next/);
  assert.equal(amountAfter(app, /Kofi owes (GH₵[\d,]+\.\d{2})/, "18 Save button"), 1500);
  await app.tap(/^Save/);
  assert.equal(app.route, "SplitPayment");
  assert.equal(amountAfter(app, /Owe ?(GH₵[\d,]+\.\d{2})/, "16 Owe row"), 500);
  assert.equal(stillOwedLine(app), null, "16 has no Still owed line");
  await app.tap(/^Done$/);
  assert.equal(app.route, "SaleRecorded");
  assert.equal(amountAfter(app, /Kofi owesfrom this sale(GH₵[\d,]+\.\d{2})/, "30"), 500);
  const after = await balanceScreens(app);
  assert.deepEqual(after, { home22: 1500, list32: 1500, detail43: 1500, chip24: 500 });
});

// (c) collect GH₵4.00 of 10.00: 26, 27, 28, Home 22, 32 and 43 all say 6.00.
test("(c) collect part of a debt on 25/26/27: 26 Left to pay, 27 Still owed line, 28, Home 22, 32 and 43 all say GH₵6.00", async () => {
  const app = await open();
  const debt = (await db.debts.toArray())[0];
  await go(app, "CollectPayment", { debtId: debt.id, customerName: debt.customerName });
  assert.equal(stillOwedLine(app), null, "25 shows no payment total");
  await app.tap(/^Pay part$/);
  await app.keys(["4"]); // 26 is typed on the keypad only (15 Nov 2026)
  assert.equal(amountAfter(app, /Still owed after this: (GH₵[\d,]+\.\d{2})/, "26"), 600);
  await app.tap(/Split payment$/);
  assert.equal(app.route, "SplitPayment");
  const line27 = stillOwedLine(app);
  assert.ok(line27, "27 from 26: Still owed line");
  assert.equal(line27.text, "Still owed · KofiGH₵6.00");
  // Phone sweep (24 Nov 2026): the soft fill and neutral dark text, no pink.
  assert.match(line27.className, /bg-\[#F1F5F9\]/);
  assert.match(line27.className, /text-\[#0F172A\]/);
  assert.doesNotMatch(line27.className, /rose/);
  await addPart(app, "Cash", "2.00", true);
  await addPart(app, "MoMo", "2.00");
  await app.tap(/^Customer sends to my number/);
  assert.equal(stillOwedLine(app)?.pesewas, 600, "the line does not move while the parts change");
  await app.tap(/^Done$/);
  if (app.route === "MoMoDirect") await app.tap("Money received");
  assert.equal(app.route, "PaymentReceived");
  assert.equal(amountAfter(app, /Kofi still owes ?(GH₵[\d,]+\.\d{2})/, "28"), 600);
  const after = await balanceScreens(app);
  assert.deepEqual(after, { home22: 600, list32: 600, detail43: 600, chip24: null });
});

// (d) paid in full: 27 has no Still owed line, 28 says 0.00, 43 says Nothing owed, Kofi leaves Home and 32.
test("(d) a debt paid in full: no Still owed line on 27, 28 says GH₵0.00 and 43 Nothing owed, Kofi is gone from Home 22 and 32", async () => {
  const app = await open();
  const debt = (await db.debts.toArray())[0];
  await go(app, "CollectPayment", { debtId: debt.id, customerName: debt.customerName });
  await app.tap("Pay all");
  await app.tap(/Split payment$/);
  assert.equal(app.route, "SplitPayment");
  assert.equal(stillOwedLine(app), null, "27: nothing left after this payment");
  await app.tap("Back");
  await app.tap(/^Cash$/);
  await app.tap("Received");
  assert.equal(app.route, "PaymentReceived");
  assert.equal(amountAfter(app, /Kofi still owes ?(GH₵[\d,]+\.\d{2})/, "28"), 0);
  const after = await balanceScreens(app);
  assert.deepEqual(after, { home22: null, list32: null, detail43: 0, chip24: null });
});
