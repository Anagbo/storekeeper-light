import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { createProduct } from "../src/db/products.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// rules_global.leave_question (decided 24 Nov 2026): one leave question for every draft (useLeaveGuard).

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
const refresh = () => { liveResults = new Map(); };

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  resetBrowserBack();
  refresh();
  await Promise.all([db.products, db.transactions, db.settings].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
  await createProduct({ name: "Bread", pricePesewas: 500 });
  await createProduct({ name: "Sugar", pricePesewas: 800 });
});

const nodes = (tree) => [...walk(tree)].filter((node) => node.props);
const leaveQuestion = (app) => nodes(app.view.tree).find((node) => node.props.role === "alertdialog" && node.props["aria-labelledby"] === "leave-draft-question") ?? null;
const nameField = (app) => nodes(app.view.tree).find((node) => node.type === "input" && node.props.maxLength === "80") ?? null;
const paneTitle = (app) => textOf(nodes(app.view.tree).find((node) => node.props.id === "item-pane-title") ?? { props: {} }).trim();
async function typeName(app, value) {
  nameField(app).props.onChange({ target: { value } });
  await app.settle();
}

async function openWideItems(width = 1280) {
  const app = await openPosApp({ width });
  after(() => app.restoreConsole());
  await app.side("MyItems");
  assert.equal(app.route, "MyItems");
  await app.tap(/^Bread/);
  assert.equal(paneTitle(app), "Edit item · Bread");
  return app;
}

test("wide Items: device Back with a changed edit asks; Stay keeps it; Leave goes back and drops it", async () => {
  const app = await openWideItems();
  await typeName(app, "Brown bread");
  await app.phoneBack();
  assert.equal(app.route, "MyItems", "the page stays while the question is open");
  const question = leaveQuestion(app);
  assert.ok(question, "the leave question");
  assert.match(textOf(question), /Your changes to this item are not saved\. Leave without saving\?/);
  await app.tap("Stay");
  assert.equal(leaveQuestion(app), null);
  assert.equal(app.route, "MyItems");
  assert.equal(nameField(app).props.value, "Brown bread", "Stay keeps the edit");

  await app.phoneBack();
  assert.ok(leaveQuestion(app), "asks again");
  await app.tap("Leave");
  assert.equal(leaveQuestion(app), null);
  assert.equal(app.route, "Home", "Leave goes back");
  assert.equal((await db.products.toArray()).some((item) => item.name === "Brown bread"), false, "the edit is dropped");
});

test("wide Items: device Back with an unchanged edit goes back without a question", async () => {
  const app = await openWideItems(768);
  await typeName(app, "Bread rolls");
  await typeName(app, "Bread");
  await app.phoneBack();
  assert.equal(leaveQuestion(app), null);
  assert.equal(app.route, "Home");
});

test("wide Items: every exit asks (sidebar Home through leaveDraft, once; another sidebar page)", async () => {
  const app = await openWideItems();
  await typeName(app, "Brown bread");
  await app.side("Home");
  assert.equal(app.route, "MyItems");
  assert.ok(leaveQuestion(app), "Home asks");
  await app.tap("Stay");
  await app.side("SettingsProfitTools");
  assert.equal(app.route, "MyItems");
  assert.ok(leaveQuestion(app), "another page asks");
  await app.tap("Stay");
  await app.side("Home");
  await app.tap("Leave");
  assert.equal(leaveQuestion(app), null, "one question, not two");
  assert.equal(app.route, "Home");
});

test("useLeaveGuard: the dirty flag is cleared when the screen unmounts (it never traps the owner)", async () => {
  const app = await openWideItems();
  await typeName(app, "Brown bread");
  await app.resize(390);
  assert.equal(app.route, "MyItems", "the phone list: the wide pane is gone");
  await app.menu("Home");
  assert.equal(leaveQuestion(app), null, "nothing left to ask about");
  assert.equal(app.route, "Home");
});

test("wide Items: device Back with the question open means Stay (the dialog and the page stay)", async () => {
  const app = await openWideItems();
  await typeName(app, "Brown bread");
  await app.phoneBack();
  assert.ok(leaveQuestion(app));
  await app.phoneBack();
  assert.equal(app.route, "MyItems", "the page underneath does not change");
  assert.equal(paneTitle(app), "Edit item · Bread");
  assert.equal(nameField(app).props.value, "Brown bread", "the edit is kept");
  assert.equal(leaveQuestion(app), null, "Back with the question open is Stay");
});

// Phone screens registered with useLeaveGuard (stage 4): 40, 41, 45, 53.
async function openPhone() {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  return app;
}
const inputs = (app) => nodes(app.view.tree).filter((node) => node.type === "input");
const byPlaceholder = (app, placeholder) => inputs(app).find((node) => node.props.placeholder === placeholder);
const labelled = (app, text) => {
  const label = nodes(app.view.tree).find((node) => node.type === "label" && textOf(node).startsWith(text));
  return [...walk(label)].find((node) => node.type === "input");
};
async function change(app, input, value) {
  input.props.onChange({ target: { value } });
  return app.settle();
}
function assertAsks(app, route, thing) {
  assert.equal(app.route, route, "the screen stays while the question is open");
  const question = leaveQuestion(app);
  assert.ok(question, `${route}: the leave question`);
  assert.match(textOf(question), new RegExp(`Your changes to this ${thing} are not saved\. Leave without saving\?`));
}
async function to40(app) {
  await app.menu("Items");
  await app.tap(/^Sugar/);
  assert.equal(app.route, "EditItem");
}

// 40, 41, 45 and 53 show the Menu button (no header Home tile, no tab bar): Menu Home is their Home,
// and it goes through the same leaveDraft as the header Home and the tabs.
test("40 Edit item (phone): changed values ask on Back, device Back, Menu Home and another Menu row; Stay keeps them", async () => {
  const app = await openPhone();
  await to40(app);
  await typeName(app, "Sugar cubes");
  for (const [name, exit] of [["Back", (a) => a.tap("Back")], ["device Back", (a) => a.phoneBack()], ["Menu Home", (a) => a.menu("Home")], ["Menu row", (a) => a.menu("Settings")]]) {
    await exit(app);
    assertAsks(app, "EditItem", "item");
    await app.tap("Stay");
    assert.equal(leaveQuestion(app), null, `${name}: Stay closes the question`);
    assert.equal(nameField(app).props.value, "Sugar cubes", `${name}: Stay keeps the values`);
  }
  await app.phoneBack();
  await app.phoneBack();
  assert.equal(app.route, "EditItem", "device Back with the question open is Stay");
  assert.equal(leaveQuestion(app), null);
  await app.tap("Back");
  await app.tap("Leave");
  assert.equal(app.route, "MyItems");
  assert.equal((await db.products.toArray()).some((item) => item.name === "Sugar cubes"), false, "nothing saved");
});

test("40 Edit item (phone): unchanged goes back without a question; Save leaves without one", async () => {
  const app = await openPhone();
  await to40(app);
  await typeName(app, "Sugar cubes");
  await typeName(app, "Sugar");
  await app.tap("Back");
  assert.equal(leaveQuestion(app), null);
  assert.equal(app.route, "MyItems");
  await app.tap(/^Sugar/);
  await typeName(app, "Sugar cubes");
  await nodes(app.view.tree).find((node) => node.type === "form").props.onSubmit({ preventDefault() {} });
  await app.settle();
  assert.equal(leaveQuestion(app), null, "saved: nothing to lose");
  assert.equal(app.route, "MyItems");
});

test("41 New item (phone): typed values ask on Back; nothing typed just goes back", async () => {
  const app = await openPhone();
  await app.menu("Items");
  await app.tap(/New item$/);
  assert.equal(app.route, "NewItem");
  await app.tap("Back");
  assert.equal(leaveQuestion(app), null);
  assert.equal(app.route, "MyItems");
  await app.tap(/New item$/);
  await typeName(app, "Milo");
  await app.phoneBack();
  assertAsks(app, "NewItem", "item");
  await app.tap("Leave");
  assert.equal(app.route, "MyItems");
});

async function to45(app) {
  await app.tap(/Spent money/);
  await change(app, inputs(app)[0], "50.00");
  await app.tap("Stock");
  await app.tap("No");
  assert.equal(app.route, "StockOnCredit");
}

test("45 Stock on credit: changed values ask on Back and Menu Home, not on a Menu trip; unchanged just goes back", async () => {
  const app = await openPhone();
  await to45(app);
  await app.tap("Back");
  assert.equal(leaveQuestion(app), null, "nothing changed");
  assert.equal(app.route, "SpentMoney");
  await app.tap("No");
  await change(app, labelled(app, "Supplier name"), "Kofi wholesale");
  await app.tap("Back");
  assertAsks(app, "StockOnCredit", "stock purchase");
  await app.tap("Stay");
  // A trip away keeps the draft in the route params: no question, and Back brings it back.
  await app.menu("Settings");
  assert.equal(leaveQuestion(app), null);
  assert.equal(app.route, "SettingsProfitTools");
  await app.tap("Back");
  assert.equal(app.route, "StockOnCredit");
  assert.equal(labelled(app, "Supplier name").props.value, "Kofi wholesale");
  await app.menu("Home");
  assertAsks(app, "StockOnCredit", "stock purchase");
  await app.tap("Leave");
  assert.equal(app.route, "Home");
});

async function to53(app) {
  await app.tap(/^Owed$/);
  await app.tap(/Add debt/);
  await app.tap(/New person/);
  await change(app, byPlaceholder(app, "e.g. Kofi Mensah"), "Kofi");
  nodes(app.view.tree).find((node) => node.type === "form").props.onSubmit({ preventDefault() {} });
  await app.settle();
  assert.equal(app.route, "ManualDebtAmount");
}

test("53 manual debt: a typed amount asks on device Back; unchanged just goes back", async () => {
  const app = await openPhone();
  await to53(app);
  await app.phoneBack();
  assert.equal(leaveQuestion(app), null, "nothing changed");
  assert.equal(app.route, "NewPerson");
  nodes(app.view.tree).find((node) => node.type === "form").props.onSubmit({ preventDefault() {} });
  await app.settle();
  await app.keys(["2", "5"]);
  await app.phoneBack();
  assertAsks(app, "ManualDebtAmount", "debt");
  await app.tap("Leave");
  assert.equal(app.route, "NewPerson");
});

test("credit flow: Back inside 15 > 17 > 34 keeps the draft and never asks", async () => {
  const app = await openPhone();
  await app.tap(/^Sell$/);
  await app.keys(["8"]);
  await app.tap("Owe");
  await app.tap(/New person/);
  await change(app, byPlaceholder(app, "e.g. Kofi Mensah"), "KOFI");
  await app.tap("Back");
  assert.equal(leaveQuestion(app), null, "34 > 17 does not ask");
  assert.equal(app.route, "WhoOwesYou");
  await app.phoneBack();
  assert.equal(leaveQuestion(app), null, "17 > 15 does not ask");
  assert.equal(app.route, "Sell");
});

test("Settings and Spent money (44) never ask", async () => {
  const app = await openPhone();
  await app.menu("Settings");
  assert.equal(app.route, "SettingsProfitTools");
  await change(app, inputs(app)[0], "Ama Stores");
  await app.tap("Back");
  assert.equal(leaveQuestion(app), null, "Settings Back does not ask");
  assert.notEqual(app.route, "SettingsProfitTools");
  await app.goHome();
  await app.tap(/Spent money/);
  await change(app, inputs(app)[0], "50.00");
  await app.phoneBack();
  assert.equal(leaveQuestion(app), null, "44 does not ask");
  assert.equal(app.route, "Home");
});
