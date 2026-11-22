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

test("Home D1 at 1280px: title, Money left with Sell and Spent money on row 1; Owed to you on row 2, the table full width below", async () => {
  await seedOwing();
  const app = await open(1280);
  const home = homeNode(app);
  assert.equal(textOf(within(home, (node) => node.type === "h1")[0]), "Home");
  const row1 = byData(home, "data-home-row-1")[0];
  assert.match(row1.props.className, /grid-cols-\[minmax\(0,1fr\)_240px\]/, "Money left, then Sell and Spent money in a column beside it");
  assert.equal(byData(row1, "data-block").length, 1, "Money left is on row 1");
  assert.ok(byData(row1, "data-home-sell").length === 1 && byData(row1, "data-home-spent").filter((n) => n.type === "button").length === 1);
  const row2 = byData(home, "data-home-row-2")[0];
  // Wiring 22 Home row 3 (21 Nov 2026): five-digit amounts do not fit beside the Owed card, so the table
  // is full width below it on every wide screen.
  assert.match(row2.props.className, /\bflex-col\b/, "Owed to you, then Today's transactions below it");
  assert.doesNotMatch(row2.props.className, /grid-cols-2/);
  const cards = [row2.props.children].flat(Infinity).filter(Boolean);
  assert.equal(cards.length, 2);
  assert.equal(byData(row2, "data-owed-card").length, 1);
  assert.equal(byData(row2, "data-home-transactions").length, 1);
});

test("rail only (768 to 1279): page side padding 20px and table card padding 12px; 1280 and up keep 32px and 20px; the phone is unchanged", async () => {
  await seedOwing();
  const classesAt = async (width) => {
    resetBrowserBack();
    const app = await open(width);
    const home = homeNode(app);
    const page = within(home, (node) => node.type === "main")[0].props.className.split(/\s+/);
    const card = byData(home, "data-home-transactions")[0]?.props.className.split(/\s+/) ?? [];
    app.restoreConsole();
    return { page, card };
  };
  for (const width of [768, 1024, 1279]) {
    const { page, card } = await classesAt(width);
    assert.ok(page.includes("px-5") && !page.includes("px-8"), `${width}: page 20px`);
    assert.ok(card.includes("px-3") && !card.includes("px-5"), `${width}: table card 12px`);
  }
  for (const width of [1280, 1440]) {
    const { page, card } = await classesAt(width);
    assert.ok(page.includes("px-8") && !page.includes("px-5"), `${width}: page 32px`);
    assert.ok(card.includes("px-5") && !card.includes("px-3"), `${width}: table card 20px`);
  }
  const phone = await classesAt(undefined);
  for (const cls of ["px-4", "sm:px-6", "pb-28", "pt-5"]) assert.ok(phone.page.includes(cls), `phone page keeps ${cls}`);
  assert.ok(!phone.page.includes("px-5") && !phone.page.includes("px-8"));
});

test("Home table: What wraps (no ellipsis), an amount in it is one unbreakable piece, cells padded 8px", async () => {
  await seedOwing();
  const app = await open(1280);
  const card = byData(homeNode(app), "data-home-transactions")[0];
  const whats = byData(card, "data-cell").filter((cell) => cell.props["data-cell"] === "what");
  assert.ok(whats.length > 0);
  for (const cell of whats) assert.doesNotMatch(cell.props.className, /\b(truncate|text-ellipsis|max-w-0|whitespace-nowrap)\b/, "What wraps");
  const amounts = byData(card, "data-what-amount");
  assert.deepEqual(amounts.map((span) => textOf(span)), ["GH₵13.00"], "the amount in Sale of GH₵13.00");
  for (const span of amounts) assert.match(span.props.className, /\bwhitespace-nowrap\b/);
  for (const cell of within(card, (node) => node.type === "td" || node.type === "th")) assert.ok(cell.props.className.split(/\s+/).includes("p-2"), `8px padding: ${textOf(cell)}`);
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

test("Home D1: the small table has Time, What, Money in, Spent, On credit; a part-paid sale shows +GH₵8.00 and GH₵5.00; See all opens 24", async () => {
  await seedOwing();
  const app = await open(1280);
  const card = byData(homeNode(app), "data-home-transactions")[0];
  assert.deepEqual(within(card, (node) => node.type === "th").map((th) => textOf(th)), ["Time", "What", "Person", "Money in", "Spent", "On credit"]);
  const spentRow = byData(card, "data-home-row").find((row) => textOf(byData(row, "data-cell").find((cell) => cell.props["data-cell"] === "what")) === "Spent");
  assert.equal(textOf(byData(spentRow, "data-cell").find((cell) => cell.props["data-cell"] === "spent")), "−GH₵10.00", "the spent row shows its amount, as on 24");
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

test("Home D1 with Hide amounts on: no customer amount digit in Collect first or the table (aria-labels included)", async () => {
  await seedOwing();
  await setPreference("hideAmounts", true);
  const app = await open(1280);
  const home = homeNode(app);
  const rows = [...byData(home, "data-urgent-debtor"), ...byData(home, "data-home-row")];
  assert.ok(rows.length >= 4);
  const cellText = (n) => textOf(n) + " " + within(n, (c) => typeof c.props?.["aria-label"] === "string").map((c) => c.props["aria-label"]).join(" ");
  for (const row of rows) assert.doesNotMatch(cellText(row).replace(/Late *[0-9]+ *days?|[0-9]{2}:[0-9]{2}/g, ""), /[0-9]/, "no digit in " + textOf(row));
  assert.ok(/Collect/.test(textOf(rows[0])) && /Sera|Amoto/.test(textOf(rows[0])));
});

test("Spent money is the shared outlined dark other button on the phone and on wide, never amber; Sell stays the only solid green", async () => {
  await seedOwing();
  for (const width of [393, 1280]) {
    const app = await open(width);
    const spent = byData(homeNode(app), "data-home-spent").find((n) => n.type === "button");
    assert.equal(spent.props["data-look"], "other", String(width));
    assert.match(spent.props.className, /0F172A/);
    assert.doesNotMatch(spent.props.className, /amber|bg-emerald/);
    assert.equal(buttonName(spent), "Spent money");
  }
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
  // Audit FAIL 1 (21 Nov 2026): at 768px a 2fr/1fr split wrapped "Spent money"; the two share the row.
  assert.match(byData(home, "data-home-actions")[0].props.className, /(^|\s)grid-cols-2(\s|$)/);
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

test("describeHomeTableRow reads the 24 rows: received under Money in, the unpaid part under Owed, spent under Spent", () => {
  const at = Date.now();
  const rows = createPosTransactionRows([
    { id: "a", type: "installment_sale", paymentType: "credit", amountPesewas: 1300, total_amount: 1300, payment_method: "cash", cashReceivedPesewas: 800, momoReceivedPesewas: 0, creditExtendedPesewas: 500, createdAt: at, customer_name: "Yaw" },
    { id: "b", type: "credit_sale", amountPesewas: 1200, total_amount: 1200, payment_method: "cash", createdAt: at - 1, customer_name: "Kofi" },
    { id: "c", type: "expense", category: "transport", amountPesewas: 1000, total_amount: 1000, paidAmountPesewas: 1000, owedAmountPesewas: 0, payment_method: "cash", createdAt: at - 2 },
    { id: "d", type: "sale", amountPesewas: 600, total_amount: 600, payment_method: "cash", cashReceivedPesewas: 600, momoReceivedPesewas: 0, createdAt: at - 3 }
  ]);
  const cells = Object.fromEntries(rows.map((row) => [row.id, describeHomeTableRow(row)]));
  assert.deepEqual(cells.a, { title: "Sale of GH₵13.00", moneyInPesewas: 800, owedPesewas: 500, owedTone: "credit", spentPesewas: 0, spentTone: "spent" });
  assert.equal(cells.b.moneyInPesewas, 0);
  assert.equal(cells.b.owedPesewas, 1200);
  // Wiring 22 Home row 3 (21 Nov 2026): spent rows show their amount under Spent, as on 24 (− amber-brown).
  assert.deepEqual([cells.c.moneyInPesewas, cells.c.owedPesewas, cells.c.spentPesewas, cells.c.spentTone], [0, 0, 1000, "spent"]);
  assert.deepEqual([cells.d.moneyInPesewas, cells.d.owedPesewas, cells.d.spentPesewas], [600, 0, 0]);
});

test("describeHomeTableRow: a correction under Owed, plain dark; stock on credit under Spent, dark red; no row is only dashes", () => {
  const at = Date.now();
  const rows = createPosTransactionRows([
    { id: "fix", type: "debt_adjustment", amountPesewas: 300, total_amount: 300, deltaPesewas: -300, previousBalancePesewas: 1300, newBalancePesewas: 1000, reasonCode: "mistake", payment_method: null, createdAt: at, customer_name: "Kofi" },
    { id: "stock-credit", type: "expense", category: "stock", supplierId: "s1", amountPesewas: 5000, total_amount: 5000, paidAmountPesewas: 0, owedAmountPesewas: 5000, payment_method: "cash", createdAt: at - 1 },
    { id: "stock-part", type: "expense", category: "stock", supplierId: "s1", amountPesewas: 5000, total_amount: 5000, paidAmountPesewas: 2000, owedAmountPesewas: 3000, payment_method: "cash", createdAt: at - 2 },
    { id: "added", type: "manual_debt", amountPesewas: 700, total_amount: 700, creditExtendedPesewas: 700, payment_method: null, createdAt: at - 3, customer_name: "Ama" },
    { id: "paid", type: "debt_payment", amountPesewas: 400, total_amount: 400, payment_method: "momo", createdAt: at - 4, customer_name: "Ama" },
    { id: "supplier", type: "supplier_payment", supplierId: "s1", amountPesewas: 900, total_amount: 900, payment_method: "cash", createdAt: at - 5 }
  ], new Map([["s1", "Kofi wholesale"]]));
  const cells = Object.fromEntries(rows.map((row) => [row.id, describeHomeTableRow(row)]));
  assert.deepEqual([cells.fix.title, cells.fix.owedPesewas, cells.fix.owedTone], ["Balance corrected", 300, "neutral"]);
  assert.deepEqual([cells["stock-credit"].title, cells["stock-credit"].spentPesewas, cells["stock-credit"].spentTone], ["Stock on credit", 5000, "credit"]);
  assert.deepEqual([cells["stock-part"].title, cells["stock-part"].spentPesewas, cells["stock-part"].spentTone], ["Stock", 2000, "spent"]);
  assert.deepEqual([cells.added.owedPesewas, cells.added.owedTone], [700, "credit"]);
  assert.equal(cells.paid.moneyInPesewas, 400);
  assert.deepEqual([cells.supplier.spentPesewas, cells.supplier.spentTone], [900, "spent"]);
  for (const [id, cell] of Object.entries(cells)) assert.ok(cell.moneyInPesewas + cell.owedPesewas + cell.spentPesewas > 0, `${id}: shows its amount`);
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
