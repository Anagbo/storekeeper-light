import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Wiring 34 "No amount field on 34" (decided 15 Nov 2026, found on a real phone): 34 has only Name,
// Phone number and Ghana Card number. Add debt (flow=add_debt): no amount line at all, Next opens 53.
// Sale on credit (15 > 17 > 34 > 18): one read-only line "Owes from this sale: GH₵x", Next opens 18.
// Name, Phone and Ghana Card survive Back from 53 and from 18 (draft rule).

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
  setLiveQuery(null);
  db.close();
  await db.delete();
});

beforeEach(async () => {
  resetBrowserBack();
  liveResults = new Map();
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
});

async function open() {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  return app;
}

const NAME = "e.g. Kofi Mensah";
const PHONE = "024 000 0000";
const CARD = "GHA-000000000-0";
const shown = (app) => app.text().replace(/\s+/g, " ");
const inputsOf = (tree) => [...walk(tree)].filter((node) => node.type === "input");
const byPlaceholder = (app, placeholder) => inputsOf(app.view.tree).find((node) => node.props?.placeholder === placeholder);
const owesLine = (tree) => [...walk(tree)].find((node) => node.props?.["data-owes-from-sale"] !== undefined);
async function change(app, input, value) {
  input.props.onChange({ target: { value } });
  return app.settle();
}
async function submit34(app) {
  [...walk(app.view.tree)].find((node) => node.type === "form").props.onSubmit({ preventDefault() {} });
  return app.settle();
}
async function fill34(app) {
  await change(app, byPlaceholder(app, NAME), "KOFI MENSAH");
  await change(app, byPlaceholder(app, PHONE), "0241112223");
  await change(app, byPlaceholder(app, CARD), "GHA-123456789-0");
}
function assertOnlyPersonInputs(tree) {
  assert.deepEqual(inputsOf(tree).map((node) => node.props.placeholder), [NAME, PHONE, CARD], "only Name, Phone number and Ghana Card number");
  assert.equal(inputsOf(tree).some((node) => node.props.type === "number" || node.props.inputMode === "decimal"), false, "no typed amount input");
}
function assert34Filled(app) {
  assert.equal(app.route, "NewPerson");
  assert.equal(byPlaceholder(app, NAME).props.value, "KOFI MENSAH");
  assert.equal(byPlaceholder(app, PHONE).props.value, "0241112223");
  assert.equal(byPlaceholder(app, CARD).props.value, "GHA-123456789-0");
}

async function addDebt34(app) {
  await app.tap(/^Owed$/);
  await app.tap(/Add debt/);
  assert.equal(app.route, "WhoOwesYou");
  await app.tap(/New person/);
  assert.equal(app.route, "NewPerson");
}
async function sale34(app) {
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Owe");
  assert.equal(app.route, "WhoOwesYou");
  await app.tap(/New person/);
  assert.equal(app.route, "NewPerson");
}

test("34 add debt: no amount line at all, and Next opens 53 with the person kept", async () => {
  const app = await open();
  await addDebt34(app);
  assertOnlyPersonInputs(app.view.tree);
  assert.equal(owesLine(app.view.tree), undefined);
  assert.doesNotMatch(shown(app), /Amount owed|enter the amount next|Owes from this sale/);
  await fill34(app);
  await submit34(app);
  assert.equal(app.route, "ManualDebtAmount");
  assert.equal(app.params.customer.name, "KOFI MENSAH");
  assert.equal(app.params.customer.phone, "0241112223");
  assert.equal(app.params.customer.ghanaCardNumber, "GHA-123456789-0");
});

test("34 sale on credit: one read-only line with the sale's amount, and Next opens 18 with that amount", async () => {
  const app = await open();
  await sale34(app);
  assertOnlyPersonInputs(app.view.tree);
  const line = owesLine(app.view.tree);
  assert.equal(textOf(line).replace(/\s+/g, " ").trim(), "Owes from this sale: GH₵8.00");
  assert.match(line.props.className, /bg-\[#F1F5F9\]/, "soft tile background (24 Nov 2026)");
  assert.doesNotMatch(line.props.className, /rose|pink/);
  const amount = [...walk(line)].find((node) => node.type === "strong");
  assert.equal(textOf(amount), "GH₵8.00");
  assert.match(amount.props.className, /text-\[#0F172A\]/, "amount neutral dark");
  assert.doesNotMatch(shown(app), /Amount owed|You can change it/);
  await fill34(app);
  await submit34(app);
  assert.equal(app.route, "WhenWillTheyPay");
  assert.equal(app.params.amountPesewas, 800);
  assert.equal(app.params.customer.name, "KOFI MENSAH");
});

test("34 sale on credit with part paid now: the line shows what is still owed", async () => {
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx");
  const navigated = [];
  const view = render({ type: CreditScreens, props: { route: "NewPerson", params: { amountPesewas: 5000, initialPaymentPesewas: 2000 }, onBack() {}, onNavigate: (...args) => navigated.push(args) } });
  assertOnlyPersonInputs(view.tree);
  assert.equal(textOf(owesLine(view.tree)).replace(/\s+/g, " ").trim(), "Owes from this sale: GH₵30.00");
  inputsOf(view.tree)[0].props.onChange({ target: { value: "Ama" } });
  view.rerender();
  [...walk(view.tree)].find((node) => node.type === "form").props.onSubmit({ preventDefault() {} });
  assert.equal(navigated[0][0], "WhenWillTheyPay");
  assert.equal(navigated[0][1].amountPesewas, 5000, "the sale amount is passed on unchanged");
  assert.equal(navigated[0][1].initialPaymentPesewas, 2000);
});

for (const [name, back] of [["on-screen Back", (app) => app.tap("Back")], ["phone back", (app) => app.phoneBack()]]) {
  test(`34 add debt: Name, Phone and Ghana Card survive Next > 53 > ${name}`, async () => {
    const app = await open();
    await addDebt34(app);
    await fill34(app);
    await submit34(app);
    assert.equal(app.route, "ManualDebtAmount");
    await back(app);
    assert34Filled(app);
    assertOnlyPersonInputs(app.view.tree);
    await submit34(app);
    assert.equal(app.route, "ManualDebtAmount");
    assert.equal(app.params.customer.name, "KOFI MENSAH");
  });

  test(`34 sale on credit: Name, Phone and Ghana Card survive Next > 18 > ${name}, the line still shows the sale's amount`, async () => {
    const app = await open();
    await sale34(app);
    await fill34(app);
    await submit34(app);
    assert.equal(app.route, "WhenWillTheyPay");
    await back(app);
    assert34Filled(app);
    assertOnlyPersonInputs(app.view.tree);
    assert.equal(textOf(owesLine(app.view.tree)).replace(/\s+/g, " ").trim(), "Owes from this sale: GH₵8.00");
    await submit34(app);
    assert.equal(app.route, "WhenWillTheyPay");
    assert.equal(app.params.amountPesewas, 800);
  });
}
