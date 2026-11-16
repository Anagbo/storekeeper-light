import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { HIDE_AMOUNTS_PREFERENCE, loadHideAmounts, saveHideAmounts } from "../src/db/preferences.js";
import { buildBackup, importDatabaseFromJson } from "../src/utils/backup.js";

// rules_global.hide_amounts: one shared setting, amounts shown by default, remembered on this phone
// (Dexie settings table, no version bump) and carried in backup and restore as an optional
// settings: { hideAmounts } section. Older backups without it still restore; format version stays 1.

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  await Promise.all(["transactions", "payments", "debts", "customers", "products", "suppliers", "reminders", "settings"].map((name) => db.table(name).clear()));
});

function backupWith(extra = {}) {
  return {
    app: "StoreKeeper Light",
    formatVersion: 1,
    exportedAt: "2026-11-16T00:00:00.000Z",
    data: { transactions: [], customers: [], debts: [], products: [], payments: [], suppliers: [] },
    ...extra
  };
}
const file = (backup) => ({ text: async () => JSON.stringify(backup) });

test("hide_amounts: amounts are shown by default", async () => {
  assert.equal(await loadHideAmounts(), false);
});

test("hide_amounts: the choice is stored in the settings table and survives reopening the database", async () => {
  await saveHideAmounts(true);
  assert.deepEqual(await db.settings.get(HIDE_AMOUNTS_PREFERENCE), { key: HIDE_AMOUNTS_PREFERENCE, value: true });
  db.close();
  await db.open();
  assert.equal(await loadHideAmounts(), true);
  await saveHideAmounts(false);
  assert.equal(await loadHideAmounts(), false);
});

test("hide_amounts: only true hides; a damaged stored value reads as shown", async () => {
  await db.settings.put({ key: HIDE_AMOUNTS_PREFERENCE, value: "yes" });
  assert.equal(await loadHideAmounts(), false);
  await assert.rejects(saveHideAmounts("yes"), TypeError);
});

test("hide_amounts: a backup carries settings.hideAmounts in format version 1", async () => {
  await saveHideAmounts(true);
  const backup = await buildBackup(new Date("2026-11-16T10:00:00Z"));
  assert.equal(backup.formatVersion, 1);
  assert.deepEqual(backup.settings, { hideAmounts: true });
  await saveHideAmounts(false);
  assert.deepEqual((await buildBackup()).settings, { hideAmounts: false });
});

test("hide_amounts: restoring a backup with the settings section replaces the current value", async () => {
  await saveHideAmounts(false);
  await importDatabaseFromJson(file(backupWith({ settings: { hideAmounts: true } })));
  assert.equal(await loadHideAmounts(), true);
  await importDatabaseFromJson(file(backupWith({ settings: { hideAmounts: false } })));
  assert.equal(await loadHideAmounts(), false);
});

test("hide_amounts: an older backup without the settings section still restores and leaves the value alone", async () => {
  await saveHideAmounts(true);
  await importDatabaseFromJson(file(backupWith()));
  assert.equal(await loadHideAmounts(), true);
  await importDatabaseFromJson(file(backupWith({ settings: {} })));
  assert.equal(await loadHideAmounts(), true);
});

test("hide_amounts: a settings section of the wrong shape is refused before anything is written", async () => {
  await saveHideAmounts(false);
  await assert.rejects(importDatabaseFromJson(file(backupWith({ settings: { hideAmounts: "yes" } }))), /settings/);
  await assert.rejects(importDatabaseFromJson(file(backupWith({ settings: [true] }))), /settings/);
  assert.equal(await loadHideAmounts(), false);
});

test("hide_amounts: export, then restore on a fresh phone, keeps the choice", async () => {
  await saveHideAmounts(true);
  const backup = await buildBackup();
  await db.settings.clear();
  assert.equal(await loadHideAmounts(), false);
  await importDatabaseFromJson(file(backup));
  assert.equal(await loadHideAmounts(), true);
});
