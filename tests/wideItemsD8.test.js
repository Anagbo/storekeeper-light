import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { createProduct } from "../src/db/products.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// wide_layout.screens "39, 40, 41 Items" (D8): on wide the Items page is a list with detail on the 39 route.

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
// A save changes the database: the live queries read it again.
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
const find = (app, attr) => nodes(app.view.tree).find((node) => node.props[attr] !== undefined) ?? null;

async function openItems(width) {
  const app = await openPosApp({ width });
  after(() => app.restoreConsole());
  await app.side("MyItems");
  assert.equal(app.route, "MyItems");
  return app;
}

test("D8 first opening (768, 1280): the pane shows only the choose text; no item is selected", async () => {
  for (const width of [768, 1280]) {
    const app = await openItems(width);
    const pane = find(app, "data-items-detail");
    assert.ok(pane, `${width}: the detail pane`);
    assert.equal(textOf(pane).trim(), "Choose an item to edit, or tap New item.", `${width}: only the text`);
    const text = find(app, "data-items-choose");
    assert.equal(text.type, "p", `${width}: plain text, no box`);
    assert.doesNotMatch(text.props.className, /border|bg-/, `${width}: no box`);
    assert.match(text.props.className, /text-\[19px\]/, `${width}: 19px`);
    assert.equal(app.params.itemsSelected, undefined, `${width}: nothing selected`);
    assert.equal(nodes(app.view.tree).filter((node) => node.props["data-item-row"] !== undefined && node.props["aria-current"]).length, 0, `${width}: no row marked`);
    assert.equal(find(app, "data-items-pane"), null, `${width}: no form`);
  }
});

test("D8 phone is unchanged: 39 is its own page with the rows and no pane", async () => {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  await app.menu("Items");
  assert.equal(app.route, "MyItems");
  assert.equal(find(app, "data-items-detail"), null);
  await app.tap(/^Sugar/);
  assert.equal(app.route, "EditItem");
});

const nameField = (app) => nodes(app.view.tree).find((node) => node.type === "input" && node.props.maxLength === "80") ?? null;
const leaveQuestion = (app) => nodes(app.view.tree).find((node) => node.props.role === "alertdialog" && node.props["aria-labelledby"] === "leave-draft-question") ?? null;
const paneTitle = (app) => textOf(nodes(app.view.tree).find((node) => node.props.id === "item-pane-title") ?? { props: {} }).trim();
const savedLine = (app) => textOf(find(app, "data-items-saved") ?? { props: {} }).trim();
const rowFor = (app, name) => nodes(app.view.tree).find((node) => node.props["data-item-row"] !== undefined && textOf(node).startsWith(name));
async function typeName(app, value) {
  nameField(app).props.onChange({ target: { value } });
  await app.settle();
}
async function save(app) {
  const form = find(app, "data-items-pane");
  await form.props.onSubmit({ preventDefault() {} });
  await app.settle();
  refresh();
  await app.settle();
}

test("D8 unsaved changes: an unchanged pane just switches; changed values ask the leave question first", async () => {
  const app = await openItems(1280);
  await app.tap(/^Bread/);
  assert.equal(paneTitle(app), "Edit item · Bread");
  await app.tap(/^Sugar/);
  assert.equal(leaveQuestion(app), null, "nothing changed: no question");
  assert.equal(paneTitle(app), "Edit item · Sugar", "switched straight away");

  // Typed and typed back to the saved value: not a change.
  await typeName(app, "Sugar cubes");
  await typeName(app, "Sugar");
  await app.tap(/^Bread/);
  assert.equal(leaveQuestion(app), null, "back to the saved value: no question");
  assert.equal(paneTitle(app), "Edit item · Bread");

  await typeName(app, "Brown bread");
  await app.tap(/^Sugar/);
  const question = leaveQuestion(app);
  assert.ok(question, "changed: the leave question");
  assert.equal(question.props["data-wide-dialog"], "", "as a WideDialog");
  assert.match(textOf(question), /not saved/);
  await app.tap("Stay");
  assert.equal(leaveQuestion(app), null);
  assert.equal(paneTitle(app), "Edit item · Bread", "Stay keeps the pane");
  assert.equal(nameField(app).props.value, "Brown bread", "and the typed value");

  await app.tap(/New item$/);
  assert.ok(leaveQuestion(app), "New item asks too");
  await app.tap("Leave");
  assert.equal(app.params.itemsSelected, "new");
  assert.equal(paneTitle(app), "New item");
  assert.equal((await db.products.toArray()).find((item) => item.name === "Brown bread"), undefined, "Leave saves nothing");

  // Another page from the sidebar.
  await typeName(app, "Rice");
  await app.side("Home");
  assert.equal(app.route, "MyItems", "the sidebar asks first");
  assert.ok(leaveQuestion(app));
  await app.tap("Leave");
  assert.equal(app.route, "Home");
});

test("D8 unchanged pane: the sidebar just goes", async () => {
  const app = await openItems(768);
  await app.tap(/^Bread/);
  await app.side("Home");
  assert.equal(app.route, "Home");
});

test("D8 Save: the saved row stays selected with the new price, and the pane shows the quiet Saved line", async () => {
  const app = await openItems(1280);
  await app.tap(/^Sugar/);
  assert.equal(savedLine(app), "", "no Saved line before Save");
  const price = nodes(app.view.tree).find((node) => node.props.placeholder === "0.00");
  price.props.onValue("9.50");
  await app.settle();
  await save(app);
  assert.equal(app.route, "MyItems");
  const sugar = (await db.products.toArray()).find((item) => item.name === "Sugar");
  assert.equal(sugar.default_price, 9.5);
  assert.equal(app.params.itemsSelected, sugar.id, "still selected");
  assert.equal(rowFor(app, "Sugar").props["aria-current"], "true");
  assert.match(textOf(rowFor(app, "Sugar")), /GH₵9\.50/, "the row shows the new price");
  assert.equal(savedLine(app), "Saved");
  assert.equal(nodes(app.view.tree).some((node) => /toast/i.test(String(node.props.className ?? ""))), false, "no toast");
  await app.tap(/^Bread/);
  assert.equal(leaveQuestion(app), null, "saved: nothing to lose");

  // A new item becomes its own Edit item, selected, with Saved.
  await app.tap(/New item$/);
  await typeName(app, "Rice");
  await save(app);
  const rice = (await db.products.toArray()).find((item) => item.name === "Rice");
  assert.ok(rice, "Rice saved");
  assert.equal(app.params.itemsSelected, rice.id);
  assert.equal(paneTitle(app), "Edit item · Rice");
  assert.equal(savedLine(app), "Saved");
  assert.equal(rowFor(app, "Rice").props["aria-current"], "true");
  await typeName(app, "Rice 5kg");
  assert.equal(savedLine(app), "", "typing again hides Saved");
});
