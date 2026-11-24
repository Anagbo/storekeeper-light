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
