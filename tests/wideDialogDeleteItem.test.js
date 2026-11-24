import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { createProduct } from "../src/db/products.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// wide_layout.page_types.dialog: on wide 42 Delete item is a WideDialog over the Items page (D8, the item
// in the pane), with the phone question's content and names. Escape and a click on the scrim are Keep.
// The pane behind is not remounted: an unsaved edit survives opening and closing 42.

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
  await Promise.all([db.products, db.transactions, db.settings].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
  await createProduct({ name: "Sugar", pricePesewas: 1_234_500 });
});

async function open(width) {
  const app = await openPosApp({ width });
  after(() => app.restoreConsole());
  return app;
}

const nodes = (tree) => [...walk(tree)].filter((node) => node.props);
const names = (root) => [...walk(root)].filter((node) => node.type === "button").map((node) => node.props["aria-label"] ?? textOf(node).trim());
const pressKey = (key) => { for (const listener of [...(window.__listeners.keydown ?? [])]) listener({ key, target: null, preventDefault() {}, stopPropagation() {} }); };
const scrimClick = (app) => nodes(app.view.tree).find((node) => node.props["data-wide-dialog-scrim"] !== undefined).props.onMouseDown({ target: "scrim", currentTarget: "scrim" });
const question = (app) => nodes(app.view.tree).find((node) => node.props.role === "alertdialog" && node.props["aria-labelledby"] === "delete-item-title") ?? null;
const nameField = (app) => nodes(app.view.tree).find((node) => node.type === "input" && node.props.maxLength === "80");

async function toEditSugar(app, wide = false) {
  nodes(app.view.tree).find((node) => node.type?.name === "Home").props.onNavigate("MyItems");
  await app.settle();
  await app.tap(/^Sugar/);
  if (wide) {
    assert.equal(app.route, "MyItems", "wide: one page");
    assert.ok(Number.isSafeInteger(app.params.itemsSelected), "wide: Sugar selected in the pane");
  } else {
    assert.equal(app.route, "EditItem");
  }
}

test("42 on wide (768, 1280): WideDialog over the Items page with the phone question's content and names", async () => {
  const phone = await open();
  await toEditSugar(phone);
  await phone.tap("Delete item");
  const phoneQuestion = question(phone);
  assert.ok(phoneQuestion, "phone: 42");
  assert.equal(phoneQuestion.props["data-wide-dialog"], undefined, "phone keeps its screen");
  for (const width of [768, 1280]) {
    const app = await open(width);
    await toEditSugar(app, true);
    await app.tap("Delete item");
    assert.equal(app.route, "MyItems", `${width}: the route is unchanged`);
    const dialog = question(app);
    assert.ok(dialog, `${width}: dialog`);
    assert.equal(dialog.props["data-wide-dialog"], "");
    assert.equal(textOf(dialog), textOf(phoneQuestion), `${width}: same content`);
    assert.deepEqual(names(dialog), names(phoneQuestion), `${width}: Keep Sugar first, then Yes, delete`);
    const inert = nodes(app.view.tree).find((node) => node.props.inert && node.props["data-items-columns"] !== undefined);
    assert.ok(inert && nodes(inert).some((node) => node.type?.name === "EditItem"), `${width}: the pane behind, inert`);
  }
});

test("42 on wide: Escape and the scrim are Keep; an unsaved edit in the pane survives; Yes, delete empties the pane", async () => {
  const app = await open(1280);
  await toEditSugar(app, true);
  await nameField(app).props.onChange({ target: { value: "Brown sugar" } });
  await app.settle();
  const editor = () => nodes(app.view.tree).find((node) => node.type?.name === "ItemEditor");
  const editorType = editor().type;
  await app.tap("Delete item");
  assert.ok(question(app));
  assert.equal(nameField(app).props.value, "Brown sugar", "the edit is still there behind 42");
  pressKey("Escape");
  await app.settle();
  assert.equal(app.route, "MyItems", "Escape is Keep");
  assert.equal(question(app), null);
  assert.equal(nameField(app).props.value, "Brown sugar", "the unsaved edit survives");
  assert.equal(nodes(app.view.tree).find((node) => node.props.inert), undefined, "the page is no longer inert");
  await app.tap("Delete item");
  scrimClick(app);
  await app.settle();
  assert.equal(app.route, "MyItems", "the scrim is Keep");
  assert.equal(nameField(app).props.value, "Brown sugar");
  assert.equal(editor().type, editorType);
  assert.equal((await db.products.toArray())[0].name, "Sugar", "nothing saved or removed");
  await app.tap("Delete item");
  await app.tap("Yes, delete");
  assert.equal(app.route, "MyItems");
  assert.equal(app.params.itemsSelected, undefined, "nothing selected");
  assert.equal((await db.products.toArray())[0].active, false);
});
