import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { getPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";

// 21 "How do you want to sell?" is the root of the setup flow on a fresh start. After Continue
// (21 -> 22) the stack resets to Home as the root, so the phone's back on Home never returns to 21.

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  resetBrowserBack();
  await Promise.all(db.tables.map((table) => table.clear()));
});

async function freshStart() {
  const app = await openPosApp();
  after(() => app.restoreConsole());
  assert.equal(app.route, "HowDoYouWantToSell", "a fresh start opens 21");
  assert.deepEqual(app.state.history, [], "21 has nothing behind it");
  return app;
}

const SCREEN_ERROR = "This screen could not load.";

test("21 is the root: the phone's back on 21 does not loop, open another screen or a blank screen", async () => {
  const app = await freshStart();
  const entriesBefore = window.history.entries.length;
  for (let press = 0; press < 3; press += 1) {
    await app.phoneBack();
    assert.equal(app.route, "HowDoYouWantToSell", `press ${press + 1}: still on 21`);
    assert.deepEqual(app.state.history, []);
    assert.ok(app.text().includes("How do you want to sell?"), "21 is shown, not a blank screen");
    assert.ok(!app.text().includes(SCREEN_ERROR));
  }
  // No guard entry is pushed for the root, so the press is left to the phone (the app is left).
  assert.equal(window.history.index, 0, "the back press leaves the app instead of looping");
  assert.ok(window.history.entries.length <= entriesBefore);
  assert.equal(await getPreference("posSetupCompleted", false), false, "setup is not skipped by a back press");
});

test("after setup (21 Continue -> 22) Home is the root: the phone's back on Home never returns to 21", async () => {
  const app = await freshStart();
  await app.tap(/^Continue/);
  assert.equal(app.route, "Home");
  assert.deepEqual(app.state.history, [], "the stack was reset to Home");
  assert.equal(await getPreference("posSetupCompleted", false), true);
  for (let press = 0; press < 3; press += 1) {
    await app.phoneBack();
    assert.equal(app.route, "Home", `press ${press + 1}: still Home, never 21`);
    assert.ok(!app.text().includes("How do you want to sell?"));
  }
  assert.equal(window.history.index, 0, "back on Home leaves the app");
});
