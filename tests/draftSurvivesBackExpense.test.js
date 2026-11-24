import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// draft_survives_trip_away (12 Nov 2026), 44 Spent money and 45 Stock on credit: the amount,
// category and note on 44 survive 45 and Back; on 45 Paid now, the supplier (chosen, or the typed new
// name and phone) and the pay-by date survive Back to 44 and No again. Save and Home start empty.

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
  await Promise.all([db.debts, db.customers, db.transactions, db.payments, db.settings, db.suppliers, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
});

async function open() {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  return app;
}

const inputs = (app) => [...walk(app.view.tree)].filter((node) => node.type === "input");
const labelled = (app, text) => {
  const label = [...walk(app.view.tree)].find((node) => node.type === "label" && textOf(node).startsWith(text));
  return [...walk(label)].find((node) => node.type === "input");
};
async function change(app, input, value) {
  input.props.onChange({ target: { value } });
  return app.settle();
}

// Home > Spent money (44): 50.00, Stock, a note.
async function to44(app) {
  await app.tap(/Spent money/);
  assert.equal(app.route, "SpentMoney");
  await change(app, inputs(app)[0], "50.00");
  await app.tap("Stock");
  await change(app, labelled(app, "What was this expense for?"), "Rice bags");
}

function assert44(app) {
  assert.equal(app.route, "SpentMoney");
  assert.equal(inputs(app)[0].props.value, "50.00");
  assert.equal(app.button("Stock").props["aria-pressed"], true);
  assert.equal(labelled(app, "What was this expense for?").props.value, "Rice bags");
}

for (const [name, back] of [["on-screen Back", (app) => app.tap("Back")], ["phone back", (app) => app.phoneBack()]]) {
  test(`44: amount, category and note survive No > 45 > ${name}`, async () => {
    const app = await open();
    await to44(app);
    await app.tap("No");
    assert.equal(app.route, "StockOnCredit");
    await back(app);
    assert44(app);
  });

  test(`45: Paid now, a typed new supplier and the pay-by date survive ${name} to 44 and No again`, async () => {
    const app = await open();
    await to44(app);
    await app.tap("No");
    await change(app, labelled(app, "Paid now"), "10.00");
    await change(app, labelled(app, "Supplier name"), "Kofi wholesale");
    await change(app, labelled(app, "Phone (optional)"), "0244556677");
    await change(app, labelled(app, "Pay by (optional)"), "2099-01-31");
    await back(app);
    // rules_global.leave_question (24 Nov 2026): Back from a changed 45 asks first; Leave is the ordinary Back.
    await app.tap("Leave");
    assert44(app);
    await app.tap("No");
    assert.equal(app.route, "StockOnCredit");
    assert.equal(labelled(app, "Paid now").props.value, "10.00");
    assert.equal(labelled(app, "Supplier name").props.value, "Kofi wholesale");
    assert.equal(labelled(app, "Phone (optional)").props.value, "0244556677");
    assert.equal(labelled(app, "Pay by (optional)").props.value, "2099-01-31");
    assert.match(app.text(), /GH₵50\.00/, "the stock total");
  });
}

test("45: a chosen existing supplier survives Back to 44 and No again", async () => {
  await db.suppliers.add({ id: "s1", name: "Ama farms", nameLower: "ama farms", phone: "", createdAt: 1, updatedAt: 1 });
  const app = await open();
  await to44(app);
  await app.tap("No");
  const ama = () => [...walk(app.view.tree)].find((node) => node.props?.["data-supplier-id"] === "s1");
  await ama().props.onSelect();
  await app.settle();
  assert.equal(ama().props.checked, true);
  await app.tap("Back");
  await app.tap("Leave"); // leave_question: a chosen supplier is a change
  await app.tap("No");
  assert.equal(ama().props.checked, true);
});

test("45: Save ends the task; Spent money starts empty again", async () => {
  const app = await open();
  await to44(app);
  await app.tap("No");
  await change(app, labelled(app, "Supplier name"), "Kofi wholesale");
  await app.tap(/^Save$/);
  assert.equal(app.route, "Home");
  assert.equal((await db.transactions.toArray()).length, 1);
  await app.tap(/Spent money/);
  assert.equal(inputs(app)[0].props.value, "");
  await app.tap("No");
  assert.equal(app.route, "SpentMoney", "no amount: No does not open 45");
});

test("44: header Home drops the draft", async () => {
  const app = await open();
  await to44(app);
  await app.tap("No");
  await app.goHome(); // header Home: Menu > Home on the phone (the hidden side menu is gone)
  await app.tap(/Spent money/);
  assert.equal(inputs(app)[0].props.value, "");
});
