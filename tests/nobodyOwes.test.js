import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { correctDebtBalance } from "../src/db/debtLedger.js";
import { recordCreditSale, recordDebtPayment } from "../src/db/debts.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { getMostUrgentCustomerDebt, summarizeOwedPeople } from "../src/pos/money.js";
import { groupUnpaidDebts, loadAllUnpaidDebts, loadUnpaidDebtPage } from "../src/pos/owed.js";
import { appCss, browser, measureInFrames, toHtml } from "./helpers/browserLayout.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

globalThis.HTMLElement ??= class {};

// Wiring 22 "Nobody owes" and 32 (14 Nov 2026, from a phone test where a balance corrected to zero
// still showed "Owed to you GHS 0.00" and a Collect button): a person counts as owing only with a
// balance above zero. With nobody owing, Home has no Owed to you card at all (Spent money goes straight
// to the Today's transactions link). Collect first, the people count and the total use only people
// above zero. 32 lists only people above zero and shows its existing empty wording when nobody is left.

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
});

const DAY = 86_400_000;

async function owe(name, amountPesewas, daysAgo = 3) {
  await recordCreditSale({ name, amountPesewas, now: Date.now() - daysAgo * DAY });
  return (await db.debts.toArray()).find((debt) => debt.customerName === name && debt.status === "unpaid");
}

async function correctToZero(debt) {
  await correctDebtBalance({ debtId: debt.id, expectedUpdatedAt: debt.updatedAt, newBalancePesewas: 0, reasonCode: "wrong_amount" });
}

async function open() {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  return app;
}

const owedCard = (app) => [...walk(app.view.tree)].find((node) => node.type === "section" && "data-owed-card" in (node.props ?? {}));
const shown = (node) => textOf(node).replace(/\s+/g, " ");

async function goToOwedList(app) {
  const home = [...walk(app.view.tree)].find((node) => node.type?.name === "Home");
  home.props.onNavigate("PeopleWhoOweYou");
  await app.settle();
  assert.equal(app.route, "PeopleWhoOweYou");
}

function assertNoCard(app, where) {
  assert.equal(app.route, "Home");
  assert.equal(owedCard(app), undefined, `${where}: no Owed to you card`);
  const text = shown(app.view.tree);
  assert.doesNotMatch(text, /Owed to you|Collect first|GH₵0\.00 ?See all|Nobody owes you right now/, `${where}: nothing about owing on Home`);
  assert.equal([...walk(app.view.tree)].some((node) => node.props?.["aria-label"]?.startsWith?.("Collect payment from")), false, `${where}: no Collect button`);
  // Spent money goes straight to the Today's transactions link.
  const buttons = [...walk(app.view.tree)].filter((node) => node.type === "button").map((node) => shown(node).trim());
  const spent = buttons.findIndex((label) => /Spent money/.test(label));
  assert.ok(spent >= 0);
  assert.match(buttons[spent + 1], /Today.s transactions/, `${where}: Today's transactions comes right after Spent money`);
}

async function assertEmptyOwedList(app, where) {
  await goToOwedList(app);
  const text = shown(app.view.tree);
  assert.match(text, /No one owes you right now\./, `${where}: the existing empty wording on 32`);
  assert.doesNotMatch(text, /GH₵0\.00/, `${where}: no zero row on 32`);
}

test("balance corrected to zero: no Owed card on Home, and 32 shows its empty wording", async () => {
  const debt = await owe("Juju", 1000);
  await correctToZero(debt);
  const stored = await db.debts.get(debt.id);
  assert.equal(stored.amountPesewas, 0, "the correction stored a zero balance");
  const app = await open();
  assertNoCard(app, "corrected to zero");
  await assertEmptyOwedList(app, "corrected to zero");
});

test("fully paid: no Owed card on Home, and 32 shows its empty wording", async () => {
  const debt = await owe("Juju", 1000);
  await recordDebtPayment({ debtId: debt.id, amountPesewas: 1000, paymentMethod: "cash" });
  const app = await open();
  assertNoCard(app, "fully paid");
  await assertEmptyOwedList(app, "fully paid");
});

test("nobody ever owed: no Owed card on Home, and 32 shows its empty wording", async () => {
  const app = await open();
  assertNoCard(app, "nobody ever owed");
  await assertEmptyOwedList(app, "nobody ever owed");
});

for (const how of ["paid in full", "corrected to zero"]) {
  test(`one of two ${how}: the card, Collect first, the count and the total show only the other person; 32 lists only them`, async () => {
    const ama = await owe("Ama", 2500, 10); // the most late: Collect first before the fix
    await owe("Kofi", 1200, 1);
    if (how === "paid in full") await recordDebtPayment({ debtId: ama.id, amountPesewas: 2500, paymentMethod: "cash" });
    else await correctToZero(ama);
    const app = await open();
    const card = owedCard(app);
    assert.ok(card, "the card shows: Kofi still owes");
    const text = shown(card);
    assert.match(text, /GH₵12\.00/, "the total is Kofi's balance");
    assert.match(text, /1 person/, "one person");
    assert.match(text, /Kofi/, "Collect first is Kofi");
    assert.doesNotMatch(text, /Ama|GH₵25\.00|GH₵37\.00|2 people/);
    await goToOwedList(app);
    const list = shown(app.view.tree);
    assert.match(list, /Kofi/);
    assert.doesNotMatch(list, /Ama/, "Ama is not listed on 32");
  });
}

test("the owed helpers count only balances above zero", () => {
  const today = new Date("2026-11-14T12:00:00");
  const debts = [
    { id: "a1", customerName: "Ama", amountPesewas: 0, status: "unpaid", dueDate: "2026-11-01" },
    { id: "a2", customerName: "Ama", amountPesewas: 500, status: "unpaid", dueDate: "2026-11-20" },
    { id: "z", customerName: "Zero", amountPesewas: 0, status: "unpaid", dueDate: "2026-10-01" },
    { id: "k", customerName: "Kofi", amountPesewas: 900, status: "unpaid", dueDate: "2026-11-30" }
  ];
  const urgent = getMostUrgentCustomerDebt(debts, today);
  assert.equal(urgent.customerName, "Ama");
  assert.equal(urgent.debtId, "a2", "Collect first never points at a zero-balance debt");
  assert.equal(urgent.amountPesewas, 500);
  assert.equal(urgent.dueDate, "2026-11-20", "the zero debt's late date does not make Ama late");
  assert.equal(getMostUrgentCustomerDebt([debts[2]], today), null, "only a zero balance: nobody to collect from");
  assert.deepEqual(summarizeOwedPeople(debts, today), { people: 2, late: 0 });
  const grouped = groupUnpaidDebts(debts);
  assert.deepEqual(grouped.map((person) => [person.customerName, person.balancePesewas, person.debtIds]), [["Kofi", 900, ["k"]], ["Ama", 500, ["a2"]]]);
});

test("32 loaders skip unpaid debts with a zero balance", async () => {
  await owe("Kofi", 1200);
  const juju = await owe("Juju", 1000);
  await correctToZero(juju);
  assert.deepEqual((await loadAllUnpaidDebts()).map((debt) => debt.customerName), ["Kofi"]);
  const page = await loadUnpaidDebtPage({ pageSize: 1 });
  assert.deepEqual(page.debts.map((debt) => debt.customerName), ["Kofi"]);
  assert.equal(page.hasMore, false, "the zero debt does not make a second page");
});

// ---- a real browser at 340, 360 and 393px --------------------------------------------------------------

const WIDTHS = [340, 360, 393];
const MEASURE = `(frame, win, doc) => {
  const card = doc.querySelector("[data-owed-card]");
  const buttons = [...doc.querySelectorAll("button")];
  const spent = buttons.find((b) => /Spent money/.test(b.textContent));
  const link = buttons.find((b) => /Today.s transactions/.test(b.textContent));
  const r = card && card.getBoundingClientRect();
  const overflowing = card ? [...card.querySelectorAll("*")].filter((el) => { const e = el.getBoundingClientRect(); return e.width > 0 && (e.right > r.right + 0.5 || e.left < r.left - 0.5); }).map((el) => el.tagName + ":" + el.textContent.trim().slice(0, 20)) : [];
  return {
    hasCard: Boolean(card),
    cardText: card ? card.textContent.replace(/\\s+/g, " ") : "",
    cardLeft: r ? r.left : null, cardRight: r ? r.right : null,
    overflowing,
    spentBottom: spent.getBoundingClientRect().bottom,
    linkTop: link.getBoundingClientRect().top,
    gapSpentToLink: link.getBoundingClientRect().top - spent.getBoundingClientRect().bottom,
    pageOverflow: doc.scrollingElement.scrollWidth > win.innerWidth
  };
}`;

test("Home with and without the Owed card at 340, 360 and 393px", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)" }, async () => {
  const pages = [];
  let app = await open();
  pages.push({ name: "nobody", html: toHtml(app.view.tree) });
  await owe("Kofi", 1200, 1);
  const juju = await owe("Juju", 1000, 5);
  await correctToZero(juju);
  liveResults = new Map();
  app = await open();
  pages.push({ name: "one owes", html: toHtml(app.view.tree) });
  const results = measureInFrames({ pages, css: await appCss(), widths: WIDTHS, measure: MEASURE });
  assert.equal(results.length, pages.length * WIDTHS.length);
  for (const result of results) {
    const where = `${result.page} at ${result.width}px`;
    assert.equal(result.innerWidth, result.width, `${where}: the frame is that wide`);
    assert.equal(result.pageOverflow, false, `${where}: no horizontal page scroll`);
    if (result.page === "nobody") {
      assert.equal(result.hasCard, false, `${where}: no card`);
      assert.ok(result.gapSpentToLink >= 0 && result.gapSpentToLink <= 20, `${where}: the Today's transactions link follows Spent money (${result.gapSpentToLink}px)`);
    } else {
      assert.equal(result.hasCard, true, `${where}: the card shows`);
      assert.match(result.cardText, /GH₵12\.00/);
      assert.match(result.cardText, /1 person/);
      assert.doesNotMatch(result.cardText, /Juju|GH₵0\.00/);
      assert.ok(result.cardLeft >= 0 && result.cardRight <= result.width, `${where}: the card fits the screen`);
      assert.deepEqual(result.overflowing, [], `${where}: nothing sticks out of the card`);
      assert.ok(result.linkTop > result.spentBottom + 40, `${where}: the card sits between Spent money and the link`);
    }
  }
});
