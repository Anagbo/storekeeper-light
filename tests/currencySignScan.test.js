import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { createProduct } from "../src/db/products.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { correctDebtBalance } from "../src/db/debtLedger.js";
import { setLiveQuery, walk } from "./helpers/renderJsx.js";

// Wiring rules_global.currency and 55 "Amounts on Review and pay" (decided 16 Nov 2026): every
// rendered amount carries GH₵ ("a rendered amount without GH₵ is a bug"). This walks the real app
// through the screens that list amounts (20, 55, 24, 28, 30, 31, 33, 19, 16, 27) and fails on any
// text (or accessible name) with an amount like 8.00 or 1,234.50 that is not written GH₵8.00.

globalThis.HTMLElement ??= class {};
let liveResults = new Map();

after(async () => {
  setLiveQuery(null);
  db.close();
  await db.delete();
});

beforeEach(async () => {
  resetBrowserBack();
  liveResults = new Map();
  setLiveQuery((deps, query) => {
    // A timestamp in the deps (33 passes now.getTime()) would make every render a new query.
    const key = `${String(query)}|${JSON.stringify(deps.map((dep) => (typeof dep === "number" && dep > 1e12 ? "now" : dep)))}`;
    if (!liveResults.has(key)) {
      liveResults.set(key, undefined);
      Promise.resolve().then(query).then((value) => liveResults.set(key, value), () => liveResults.set(key, null));
    }
    return liveResults.get(key);
  });
  await Promise.all([db.products, db.debts, db.customers, db.transactions, db.payments, db.settings, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
  await setPreference("momoReceivingNumber", "0241234567");
  await setPreference("momoReceivingNetwork", "MTN");
});

const AMOUNT = /(\d{1,3}(?:,\d{3})+|\d+)\.\d{2}(?!\d)/g;

// Every visible text piece and accessible name, in order.
function pieces(tree) {
  const out = [];
  for (const node of walk(tree)) {
    const children = [node.props?.children].flat(Infinity);
    for (const child of children) if (typeof child === "string" || typeof child === "number") out.push(String(child));
    for (const name of ["aria-label", "title"]) if (typeof node.props?.[name] === "string") out.push(node.props[name]);
  }
  return out;
}

// Amounts without the sign: in the same piece "GH₵" must sit right before the number (after an
// optional + or −); a number at the very start of a piece may follow a piece that ends with "GH₵".
export function bareAmounts(tree) {
  const found = [];
  const list = pieces(tree);
  list.forEach((piece, index) => {
    for (const match of piece.matchAll(AMOUNT)) {
      const before = piece.slice(0, match.index);
      if (/GH₵$/.test(before)) continue;
      if (match.index === 0 && /GH₵\s*$/.test(list[index - 1] ?? "")) continue;
      found.push(`"${piece}"`);
    }
  });
  return found;
}

function assertSigned(app, screen) {
  assert.deepEqual(bareAmounts(app.view.tree), [], `${screen} (${app.route}): every amount has GH₵`);
}

test("the scan itself: finds 8.00 and 1,234.50 without the sign, passes GH₵8.00 and −GH₵2.00", () => {
  const tree = (...texts) => ({ type: "div", props: { children: texts.map((text) => ({ type: "span", props: { children: text } })) } });
  assert.deepEqual(bareAmounts(tree("Bread × 1", "8.00")), ['"8.00"']);
  assert.deepEqual(bareAmounts(tree("Total 1,234.50")), ['"Total 1,234.50"']);
  assert.deepEqual(bareAmounts(tree("GH₵8.00", "−GH₵2.00", "GH₵10.00 → GH₵8.00")), []);
  assert.deepEqual(bareAmounts(tree("GH₵10.00 → 8.00")), ['"GH₵10.00 → 8.00"']);
  assert.deepEqual(bareAmounts(tree("GH₵", "4.00")), [], "a GH₵ label right before the number");
  assert.deepEqual(bareAmounts(tree("12/11/2026 14:30", "024 123 4567")), [], "dates, times and phones are not amounts");
});

test("20, 55, 16 and 30: a sale with items shows every amount with GH₵", async () => {
  await createProduct({ name: "Bread", pricePesewas: 200 });
  await createProduct({ name: "Rice", pricePesewas: 600 });
  const app = await openPosApp();
  after(() => app.restoreConsole());
  await app.tap(/^Sell$/);
  await app.tap(/Add items/);
  await app.tap(/^BBread/);
  await app.tap(/^Add 1/);
  await app.tap(/^RRice/);
  await app.tap(/^Add 1/);
  assert.equal(app.route, "SellWithItems");
  assertSigned(app, "20");
  await app.tap(/^Next/);
  assert.equal(app.route, "ReviewAndPay");
  assertSigned(app, "55");
  await app.tap(/Split payment/);
  assert.equal(app.route, "SplitPayment");
  assertSigned(app, "16");
  await app.tap("Back");
  await app.tap(/Done/);
  assert.equal(app.route, "SaleRecorded");
  assertSigned(app, "30");
});

test("19, 27 and 31: a credit sale paid a little at a time shows every amount with GH₵", async () => {
  await recordCreditSale({ name: "juju", amountPesewas: 1000, now: Date.now() - 3 * 86_400_000 });
  const app = await openPosApp();
  after(() => app.restoreConsole());
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Owe");
  await app.tap(/^JJuju/);
  await app.tap(/^Next/);
  await app.tap(/A little at a time/);
  assert.equal(app.route, "ALittleAtATime");
  await app.type("How much each time?", "5");
  await app.tap("Today");
  await app.tap(/^Cash$/);
  assertSigned(app, "19");
  await app.tap("Split payment");
  assert.equal(app.route, "SplitPayment");
  assertSigned(app, "27");
  await app.tap("Back");
  await app.tap(/^Save plan/);
  assert.equal(app.route, "CreditSaved");
  assertSigned(app, "31");
});

test("28, 24 and 33: a collection, today's transactions and My money show every amount with GH₵", async () => {
  await recordCreditSale({ name: "juju", amountPesewas: 1000, now: Date.now() - 3 * 86_400_000 });
  await createProduct({ name: "Bread", pricePesewas: 200 });
  const app = await openPosApp();
  after(() => app.restoreConsole());
  const debt = (await db.debts.toArray())[0];
  [...walk(app.view.tree)].find((node) => node.type?.name === "Home").props.onNavigate("DebtorDetail", { debtId: debt.id, customerName: "juju" });
  await app.settle();
  await app.tap(/^Collect$/);
  await app.tap("Pay part");
  await app.keys(["2"]);
  await app.tap(/^Cash$/);
  await app.tap(/^Received$/);
  assert.equal(app.route, "PaymentReceived");
  assertSigned(app, "28");
  await app.goHome();
  await app.menu("Today");
  assert.equal(app.route, "TodaysTransactions");
  assertSigned(app, "24");
  await app.goHome();
  await app.menu("My money");
  assert.equal(app.route, "MyMoney");
  liveResults = new Map();
  await app.settle();
  assert.match(app.text(), /Estimated profit/, "33 is loaded with its profit card");
  assertSigned(app, "33");
});

test("29/43 history: a correction row shows both balances with GH₵ (GH₵10.00 → GH₵8.00)", async () => {
  await recordCreditSale({ name: "juju", amountPesewas: 1000, now: Date.now() - 3 * 86_400_000 });
  const debt = (await db.debts.toArray())[0];
  await correctDebtBalance({ debtId: debt.id, expectedUpdatedAt: debt.updatedAt, newBalancePesewas: 800, reasonCode: "wrong_amount", reasonNote: "" });
  const app = await openPosApp();
  after(() => app.restoreConsole());
  [...walk(app.view.tree)].find((node) => node.type?.name === "Home").props.onNavigate("DebtorDetail", { debtId: debt.id, customerName: "juju" });
  await app.settle();
  assert.equal(app.route, "DebtorDetail");
  assert.match(app.text(), /GH₵10\.00 → GH₵8\.00/);
  assertSigned(app, "29/43");
});
