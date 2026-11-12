import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { walk } from "./helpers/renderJsx.js";

// draft_survives_trip_away (12 Nov 2026), 35 What do you sell?: the chosen businesses and categories
// survive More categories (51) and Back (or Done), and Back to 21 and Continue again. (35's choices
// are held by PosApp for the whole first-run setup; this checks they come back.)

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  resetBrowserBack();
  await Promise.all(db.tables.map((table) => table.clear()));
});

async function open() {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  assert.equal(app.route, "HowDoYouWantToSell");
  return app;
}

const chosen = (app) => [...walk(app.view.tree)].filter((node) => node.type === "button" && node.props?.["aria-pressed"] === true).map((node) => node.key);
const tiles = (app) => [...walk(app.view.tree)].filter((node) => node.type === "button" && "aria-pressed" in (node.props ?? {}));

async function to35(app) {
  await app.tap(/^With items/);
  await app.tap(/^Continue/);
  assert.equal(app.route, "WhatDoYouSell");
}

for (const [name, back] of [["on-screen Back", (app) => app.tap("Back")], ["phone back", (app) => app.phoneBack()], ["Done", (app) => app.tap(/^Done/)]]) {
  test(`35: chosen categories survive More categories (51) and ${name}, also one chosen on 51`, async () => {
    const app = await open();
    await to35(app);
    await tiles(app)[0].props.onClick();
    await app.settle();
    await tiles(app)[1].props.onClick();
    await app.settle();
    const before = chosen(app);
    assert.equal(before.length, 2);
    await app.tap(/^More categories/);
    assert.equal(app.route, "MoreCategories");
    const extra = tiles(app).find((node) => node.props["aria-pressed"] === false);
    await extra.props.onClick();
    await app.settle();
    await back(app);
    assert.equal(app.route, "WhatDoYouSell");
    for (const key of before) assert.ok(chosen(app).includes(key), `${key} still chosen`);
  });
}

test("35: chosen categories survive Back to 21 and Continue again", async () => {
  const app = await open();
  await to35(app);
  await tiles(app)[0].props.onClick();
  await app.settle();
  const before = chosen(app);
  await app.tap("Back");
  assert.equal(app.route, "HowDoYouWantToSell");
  await app.tap(/^Continue/);
  assert.equal(app.route, "WhatDoYouSell");
  assert.deepEqual(chosen(app), before);
});
