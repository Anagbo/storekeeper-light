import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { setPreference } from "../src/db/preferences.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { openPosApp } from "./helpers/posAppHarness.js";
import { walk } from "./helpers/renderJsx.js";

// draft_survives_trip_away (12 Nov 2026), 47 Settings: an unsaved Shop name (Save already green)
// survives MoMo payments (63), My plan (64) or Backup and restore (71) and Back. Nothing is saved
// until Save; Home drops it.

globalThis.localStorage ??= (() => {
  const store = new Map();
  return { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: (key) => store.delete(key), clear: () => store.clear() };
})();

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  resetBrowserBack();
  localStorage.clear();
  localStorage.setItem("storekeeper-shop-name", "Ama Stores");
  await Promise.all([db.settings, db.saveAttempts].filter(Boolean).map((table) => table.clear()));
  await setPreference("posSetupCompleted", true);
});

async function open(env) {
  const app = await openPosApp(env ? { env } : undefined);
  after(() => app.restoreConsole());
  return app;
}

const nameInput = (app) => [...walk(app.view.tree)].find((node) => node.type === "input" && node.props?.maxLength === 60);
const saveButton = (app) => [...walk(app.view.tree)].find((node) => node.type === "button" && node.props?.type === "submit");

async function toSettingsWithDraft(app) {
  await app.tap(/^Menu$/);
  await app.tap(/^Settings/);
  assert.equal(app.route, "SettingsProfitTools");
  nameInput(app).props.onChange({ target: { value: "Ama Stores Kumasi" } });
  await app.settle();
  assert.equal(saveButton(app).props.disabled, false, "Save is green");
}

function assertDraft(app) {
  assert.equal(app.route, "SettingsProfitTools");
  assert.equal(nameInput(app).props.value, "Ama Stores Kumasi");
  assert.equal(saveButton(app).props.disabled, false, "Save is still green");
  assert.equal(localStorage.getItem("storekeeper-shop-name"), "Ama Stores", "nothing saved");
}

const trips = [
  ["MoMo payments (63)", /^MoMo payments/, "PaymentSettings", undefined],
  ["Backup and restore (71)", /^Backup and restore/, "BackupRestore", undefined],
  ["My plan (64)", /^My plan/, "MyPlan", { VITE_ENABLE_MOMO_PHONE_REQUEST: "true", VITE_ENABLE_SUBSCRIPTION: "true" }]
];

for (const [trip, link, route, env] of trips) {
  for (const [name, back] of [["on-screen Back", (app) => app.tap("Back")], ["phone back", (app) => app.phoneBack()]]) {
    test(`47: an unsaved Shop name survives ${trip} and ${name}`, async () => {
      const app = await open(env);
      await toSettingsWithDraft(app);
      await app.tap(link);
      assert.equal(app.route, route);
      await back(app);
      assertDraft(app);
    });
  }
}

test("47: Save after the trip saves the kept name once; header Home drops an unsaved one", async () => {
  const app = await open();
  await toSettingsWithDraft(app);
  await app.tap(/^MoMo payments/);
  await app.tap("Back");
  [...walk(app.view.tree)].find((node) => node.type === "form").props.onSubmit({ preventDefault() {} });
  await app.settle();
  assert.equal(localStorage.getItem("storekeeper-shop-name"), "Ama Stores Kumasi");
  nameInput(app).props.onChange({ target: { value: "Something else" } });
  await app.settle();
  await app.goHome(); // header Home: Menu > Home on the phone (the hidden side menu is gone)
  await app.tap(/^Menu$/);
  await app.tap(/^Settings/);
  assert.equal(nameInput(app).props.value, "Ama Stores Kumasi");
  assert.equal(saveButton(app).props.disabled, true);
});
