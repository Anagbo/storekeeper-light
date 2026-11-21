import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCreditSale } from "../src/db/debts.js";
import { setPreference } from "../src/db/preferences.js";
import { recordCashSale } from "../src/db/sales.js";
import { recordExpense } from "../src/db/suppliers.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { getLayout } from "../src/pos/layout.js";
import { getUrgentCustomerDebts } from "../src/pos/money.js";
import { createPosTransactionRows, describeHomeTableRow } from "../src/pos/transactionFeed.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// wide_layout.page_types.dashboard, screens "22 Home" (D1; D6 on the rail) and "33 My money" (D7),
// same_as_phone and approved_additions 3 (Collect first: up to two people, most late first, the phone's
// buttons; hidden when nobody owes). Layout only: every phone control is on the wide Home with the same
// label and accessible name, and nothing is stored or computed that the phone does not already have.

globalThis.HTMLElement ??= class {};
globalThis.localStorage ??= (() => {
  const store = new Map();
  return { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: (key) => store.delete(key), clear: () => store.clear() };
})();

// Live queries run for real (fake-indexeddb), once per query and deps, as in headerAlwaysVisible.test.js.
let liveResults = new Map();
const realLiveQuery = (deps, query) => {
  const key = `${String(query)}|${JSON.stringify(deps)}`;
  if (!liveResults.has(key)) {
    liveResults.set(key, undefined);
    Promise.resolve().then(query).then((value) => liveResults.set(key, value), () => liveResults.set(key, null));
  }
  return liveResults.get(key);
};

after(async () => {
  setLiveQuery(null);
  db.close();
  await db.delete();
});

beforeEach(async () => {
  resetBrowserBack();
  liveResults = new Map();
  setLiveQuery(realLiveQuery);
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings, db.suppliers, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
  await setPreference("hideAmounts", false);
});

const DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

// Three people owe: Sera late 3 days, Amoto late 1 day (both with a number), Kofi due next week; and
// today's sales: a cash sale, a part-paid sale (13.00, 5.00 owed) and money spent.
async function seedOwing() {
  const now = Date.now();
  await recordCreditSale({ name: "Sera", phone: "0241234567", amountPesewas: 2000, dueDate: iso(now - 3 * DAY), now: now - 5 * DAY });
  await recordCreditSale({ name: "Amoto", phone: "0207654321", amountPesewas: 1200, dueDate: iso(now - DAY), now: now - 4 * DAY });
  await recordCreditSale({ name: "Kofi", amountPesewas: 900, dueDate: iso(now + 7 * DAY), now: now - 2 * DAY });
  await seedToday();
}

async function seedToday() {
  await recordCashSale({ amountPesewas: 800 });
  await recordCreditSale({ name: "Yaw", amountPesewas: 1300, initialPaymentPesewas: 800, dueDate: iso(Date.now() + 14 * DAY) });
  await recordExpense({ amountPesewas: 1000, paidAmountPesewas: 1000, category: "transport", paymentMethod: "cash" });
}

async function open(width) {
  const app = await openPosApp(width === undefined ? {} : { width });
  after(() => app.restoreConsole());
  return app;
}

const homeNode = (app) => [...walk(app.view.tree)].find((node) => node.type?.name === "Home");
const within = (node, predicate) => [...walk(node)].filter(predicate);
const byData = (node, name) => within(node, (child) => child.props?.[name] !== undefined);
const buttonName = (button) => (button.props["aria-label"] ?? textOf(button)).replace(/\s+/g, " ").trim();
const buttons = (node) => within(node, (child) => child.type === "button");
// Buttons and links (Call is a tel: link).
const controls = (node) => within(node, (child) => child.type === "button" || child.type === "a");
const personRows = (node) => within(node, (child) => child.type?.name === "PersonRow");

test("Home D1 at 1280px: title, Money left with Sell and Spent money on row 1; Owed to you beside the small table on row 2", async () => {
  await seedOwing();
  const app = await open(1280);
  const home = homeNode(app);
  assert.equal(textOf(within(home, (node) => node.type === "h1")[0]), "Home");
  const row1 = byData(home, "data-home-row-1")[0];
  assert.match(row1.props.className, /grid-cols-\[minmax\(0,1\.9fr\)_minmax\(0,1fr\)\]/, "Money left, then Sell and Spent money in a column beside it");
  assert.equal(byData(row1, "data-block").length, 1, "Money left is on row 1");
  assert.ok(byData(row1, "data-home-sell").length === 1 && byData(row1, "data-home-spent").length === 1);
  const row2 = byData(home, "data-home-row-2")[0];
  assert.match(row2.props.className, /\bgrid-cols-2\b/, "Owed to you beside Today's transactions");
  assert.equal(byData(row2, "data-owed-card").length, 1);
  assert.equal(byData(row2, "data-home-transactions").length, 1);
});

test("Home D1: Collect first shows two people, most late first, from the same list as the phone tile", async () => {
  await seedOwing();
  const expected = getUrgentCustomerDebts(await db.debts.where("status").equals("unpaid").toArray()).slice(0, 2).map((debt) => debt.customerName);
  assert.deepEqual(expected, ["Sera", "Amoto"]);
  const wide = await open(1280);
  const people = personRows(homeNode(wide));
  assert.equal(people.length, 2);
  assert.deepEqual(people.map((row) => row.props.name), expected);
  wide.restoreConsole();
  resetBrowserBack();
  const phone = await open();
  const phonePeople = personRows(homeNode(phone));
  assert.deepEqual(phonePeople.map((row) => row.props.name), [expected[0]], "the phone keeps one: the first of the same list");
});

test("Home D1: each person has the phone tile's buttons; the name opens that person, Collect opens the Collect sheet", async () => {
  await seedOwing();
  const app = await open(1280);
  const card = byData(homeNode(app), "data-owed-card")[0];
  const names = controls(card).map(buttonName);
  for (const who of ["Sera", "Amoto"]) {
    assert.ok(names.some((name) => name.includes(`Open ${who}`)), `${who}: the top row opens the person`);
    assert.ok(names.some((name) => /Collect/.test(name) && name.includes(who)), `${who}: Collect`);
    assert.ok(names.some((name) => name === `WhatsApp ${who}`), `${who}: WhatsApp`);
    assert.ok(names.some((name) => name === `Call ${who}`), `${who}: Call`);
  }
  const openAmoto = buttons(card).find((button) => buttonName(button).includes("Open Amoto"));
  await openAmoto.props.onClick({ preventDefault() {}, stopPropagation() {} });
  await app.settle();
  assert.equal(app.route, "DebtorDetail");
  assert.equal(app.params.customerName, "Amoto");
});

test("Home D1: the small table has Time, What, Money in, Owed; a part-paid sale shows +GH₵8.00 and GH₵5.00; See all opens 24", async () => {
  await seedOwing();
  const app = await open(1280);
  const card = byData(homeNode(app), "data-home-transactions")[0];
  assert.deepEqual(within(card, (node) => node.type === "th").map((th) => textOf(th)), ["Time", "What", "Money in", "Owed"]);
  const rows = byData(card, "data-home-row");
  assert.ok(rows.length >= 3 && rows.length <= 5, `${rows.length} rows`);
  const partPaid = rows.find((row) => /Sale of GH₵13\.00/.test(textOf(row)));
  assert.ok(partPaid, "the part-paid sale");
  assert.equal(textOf(byData(partPaid, "data-cell").find((cell) => cell.props["data-cell"] === "money-in")), "+GH₵8.00");
  assert.equal(textOf(byData(partPaid, "data-cell").find((cell) => cell.props["data-cell"] === "owed")), "GH₵5.00");
  for (const row of rows) assert.match(textOf(within(row, (node) => node.type === "time")[0]), /^\d{2}:\d{2}$/, "24-hour time");
  const seeAll = buttons(card)[0];
  assert.equal(seeAll.props["aria-label"], "Today’s transactions");
  await seeAll.props.onClick();
  await app.settle();
  assert.equal(app.route, "TodaysTransactions");
});

test("Home D1 nobody owes: no Owed card; Today's transactions takes the full row", async () => {
  await seedToday();
  await db.debts.where("customerName").equals("Yaw").modify({ status: "paid" });
  const app = await open(1280);
  const home = homeNode(app);
  assert.equal(byData(home, "data-owed-card").length, 0);
  assert.doesNotMatch(app.text(), /Collect first/);
  const row2 = byData(home, "data-home-row-2")[0];
  assert.doesNotMatch(row2.props.className, /grid-cols-2/);
  const children = [row2.props.children].flat(Infinity).filter(Boolean);
  assert.equal(children.length, 1, "only the table card");
  assert.equal(byData(row2, "data-home-transactions").length, 1);
});

test("Home on the rail (768 to 1279, D6): the date beside the title, Money left across, Sell beside Spent money, the cards stacked", async () => {
  await seedOwing();
  const app = await open(1024);
  const home = homeNode(app);
  assert.ok(byData(home, "data-home-date").length === 1, "the date beside the title");
  assert.match(byData(home, "data-home-row-1")[0].props.className, /\bflex-col\b/);
  assert.match(byData(home, "data-home-row-2")[0].props.className, /\bflex-col\b/);
  assert.equal(personRows(home).length, 2);
});

for (const width of [768, 1280]) {
  test(`${width}px: every phone control on Home exists on the wide Home with the same label and accessible name`, async () => {
    await seedOwing();
    const phone = await open();
    const phoneNames = controls(homeNode(phone)).map(buttonName);
    phone.restoreConsole();
    resetBrowserBack();
    const wide = await open(width);
    const wideNames = new Set(controls(homeNode(wide)).map(buttonName));
    assert.ok(phoneNames.length >= 7, `the phone Home has its controls (${phoneNames.join(" | ")})`);
    for (const name of phoneNames) assert.ok(wideNames.has(name), `"${name}" is on the wide Home`);
  });
}

test("one strong green block on wide Home (Money left); Sell is a button", async () => {
  await seedOwing();
  const app = await open(1280);
  const green = within(homeNode(app), (node) => typeof node.type === "string" && node.type !== "button" && /(^|\s)bg-emerald-900(\s|$)/.test(node.props?.className ?? ""));
  assert.deepEqual(green.map((node) => node.props["data-block"]), ["money-left"]);
});

test("wide Home stores nothing and changes no stored value", async () => {
  await seedOwing();
  const tables = ["debts", "customers", "transactions", "payments", "settings", "suppliers"];
  const snapshot = async () => JSON.stringify(await Promise.all(tables.map((name) => db.table(name).toArray())));
  const before = await snapshot();
  const app = await open(1280);
  await app.settle();
  assert.equal(await snapshot(), before);
});

test("describeHomeTableRow reads the 24 rows: received under Money in, the unpaid part under Owed, dashes otherwise", () => {
  const at = Date.now();
  const rows = createPosTransactionRows([
    { id: "a", type: "installment_sale", paymentType: "credit", amountPesewas: 1300, total_amount: 1300, payment_method: "cash", cashReceivedPesewas: 800, momoReceivedPesewas: 0, creditExtendedPesewas: 500, createdAt: at, customer_name: "Yaw" },
    { id: "b", type: "credit_sale", amountPesewas: 1200, total_amount: 1200, payment_method: "cash", createdAt: at - 1, customer_name: "Kofi" },
    { id: "c", type: "expense", category: "transport", amountPesewas: 1000, total_amount: 1000, paidAmountPesewas: 1000, owedAmountPesewas: 0, payment_method: "cash", createdAt: at - 2 },
    { id: "d", type: "sale", amountPesewas: 600, total_amount: 600, payment_method: "cash", cashReceivedPesewas: 600, momoReceivedPesewas: 0, createdAt: at - 3 }
  ]);
  const cells = Object.fromEntries(rows.map((row) => [row.id, describeHomeTableRow(row)]));
  assert.deepEqual(cells.a, { title: "Sale of GH₵13.00", moneyInPesewas: 800, owedPesewas: 500 });
  assert.equal(cells.b.moneyInPesewas, 0);
  assert.equal(cells.b.owedPesewas, 1200);
  assert.deepEqual([cells.c.moneyInPesewas, cells.c.owedPesewas], [0, 0], "spent: dashes");
  assert.deepEqual([cells.d.moneyInPesewas, cells.d.owedPesewas], [600, 0]);
});

// ---- My money (33) ---------------------------------------------------------------------------------------

async function myMoney(layout) {
  const { default: MyMoney } = await loadJsx("src/pos/MyMoney.jsx");
  setLiveQuery(() => ({
    summary: { moneyIn: 6000, cashIn: 3500, momoIn: 2500, collectedIn: 0, givenOnCredit: 0, moneySpent: 1800, spentStock: 0, spentOther: 1800, spentCash: 1000, spentMomo: 800, spentUnrecorded: 0, cashShouldHave: 2500, momoShouldHave: 1700, moneyLeft: 4200, sales: 5000, stockBought: 0, otherCosts: 1800, profit: 3200 },
    comparison: null, uncounted: { sales: 0, other: 0 }, hideAmounts: false, showProfit: true, averageProfitPesewas: null, debtPesewas: 9300, supplierBalancePesewas: 28000
  }));
  const view = render({ type: MyMoney, props: { onNavigate() {}, layout } });
  setLiveQuery(null);
  return view;
}

test("33: Back on the phone only; the phone arrangement up to 1023px, D7 from 1024px (one decision: getLayout)", async () => {
  const backOf = (view) => [...walk(view.tree)].find((node) => node.type === "button" && node.props?.["aria-label"] === "Back");
  const gridOf = (view) => [...walk(view.tree)].find((node) => node.type === "main").props.className;
  const phone = await myMoney(getLayout(360));
  assert.ok(backOf(phone), "the phone keeps Back");
  assert.match(gridOf(phone), /\bflex-col\b/);
  const rail = await myMoney(getLayout(768));
  assert.equal(backOf(rail), undefined, "no Back on a wide screen: the sidebar reaches My money");
  assert.match(gridOf(rail), /\bflex-col\b/, "768: the phone arrangement");
  for (const width of [1024, 1280, 1440]) {
    const view = await myMoney(getLayout(width));
    assert.equal(backOf(view), undefined);
    assert.match(gridOf(view), /(^|\s)grid-cols-2(\s|$)/, `${width}: D7`);
    assert.match(gridOf(view), /\btabular-nums\b/, `${width}: equal-width digits`);
  }
});

test("Home and My money take the layout from PosApp and have no CSS breakpoint of their own", () => {
  for (const file of ["src/pos/Home.jsx", "src/pos/MyMoney.jsx"]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\b(md|lg|xl|2xl):/, file);
    assert.match(source, /layout = PHONE_LAYOUT/, `${file}: the phone unless PosApp says otherwise`);
  }
  const app = readFileSync(new URL("../src/pos/PosApp.jsx", import.meta.url), "utf8");
  assert.match(app, /<MyMoney [^>]*layout=\{layout\}/);
  assert.equal(app.match(/<Home\s[^>]*?layout=\{layout\}/g)?.length, 2, "both Homes (also behind the Collect sheet)");
});
