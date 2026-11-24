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
