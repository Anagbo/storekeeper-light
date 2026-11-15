import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { getLatestReminderAt, isReminderFor, latestReminderAt, loadReminderEvents, recordReminderSent } from "../src/db/reminders.js";
import { importDatabaseFromJson, validateBackupData } from "../src/utils/backup.js";

// rules_global.reminders (data): a local "reminder sent" event (person, time, channel), appended
// only, included in backup and restore; an older backup without these events still restores.

after(async () => {
  db.close();
  await db.delete();
});

beforeEach(async () => {
  await Promise.all(["transactions", "payments", "debts", "customers", "products", "suppliers", "settings", "reminders"].map((name) => db.table(name).clear()));
});

const file = (backup) => ({ text: async () => JSON.stringify(backup) });
const backupWith = (data) => ({
  app: "StoreKeeper Light",
  formatVersion: 1,
  exportedAt: "2026-11-15T00:00:00.000Z",
  data: { transactions: [], customers: [], debts: [], products: [], payments: [], suppliers: [], ...data }
});

test("a reminder is stored with person, time and channel", async () => {
  const event = await recordReminderSent({ customerId: "c1", customerName: " Ama ", now: 1_000 });
  const stored = await db.reminders.get(event.id);
  assert.equal(stored.customerId, "c1");
  assert.equal(stored.customerName, "Ama");
  assert.equal(stored.nameLower, "ama");
  assert.equal(stored.channel, "whatsapp");
  assert.equal(stored.createdAt, 1_000);
});

test("a reminder is appended: a second one adds a row and leaves the first as it was", async () => {
  const first = await recordReminderSent({ customerId: "c1", customerName: "Ama", now: 1_000 });
  await recordReminderSent({ customerId: "c1", customerName: "Ama", now: 2_000 });
  const events = await loadReminderEvents();
  assert.equal(events.length, 2);
  assert.deepEqual(await db.reminders.get(first.id), first);
});

test("a reminder needs a person, a known channel and a time", async () => {
  await assert.rejects(recordReminderSent({ customerName: "  " }), /person/);
  await assert.rejects(recordReminderSent({ customerId: "c1", channel: "sms" }), /channel/);
  await assert.rejects(recordReminderSent({ customerId: "c1", now: 1.5 }), /time/);
  assert.equal((await loadReminderEvents()).length, 0);
});

test("the latest reminder is read per person", async () => {
  await recordReminderSent({ customerId: "c1", customerName: "Ama", now: 1_000 });
  await recordReminderSent({ customerId: "c1", customerName: "Ama", now: 3_000 });
  await recordReminderSent({ customerId: "c2", customerName: "Kofi", now: 5_000 });
  await recordReminderSent({ customerName: "Esi", now: 4_000 });
  assert.equal(await getLatestReminderAt({ customerId: "c1", customerName: "Ama" }), 3_000);
  assert.equal(await getLatestReminderAt({ customerId: "c2", customerName: "Kofi" }), 5_000);
  assert.equal(await getLatestReminderAt({ customerName: "esi " }), 4_000, "no customerId: matched by name");
  assert.equal(await getLatestReminderAt({ customerId: "c9", customerName: "Yaw" }), 0, "none recorded");
});

test("two people with the same name but different ids are kept apart", () => {
  const events = [{ customerId: "c1", nameLower: "ama", createdAt: 9_000 }];
  assert.equal(latestReminderAt(events, { customerId: "c2", customerName: "Ama" }), 0);
  assert.equal(isReminderFor(events[0], { customerName: "Ama" }), true, "a person with no id matches by name");
});

test("backup round trip: reminder events are exported and restored", async () => {
  const event = await recordReminderSent({ customerId: "c1", customerName: "Ama", now: 7_000 });
  const exported = await db.reminders.toArray();
  await db.reminders.clear();
  const result = await importDatabaseFromJson(file(backupWith({ reminders: exported })));
  assert.equal(result.reminders, 1);
  assert.deepEqual(await db.reminders.get(event.id), event);
});

test("restore never edits a reminder already on this phone", async () => {
  const event = await recordReminderSent({ customerId: "c1", customerName: "Ama", now: 7_000 });
  const result = await importDatabaseFromJson(file(backupWith({ reminders: [{ ...event, createdAt: 9_999 }] })));
  assert.equal((await db.reminders.get(event.id)).createdAt, 7_000);
  assert.equal(result.skippedLedgerRows, 0, "the restore message counts only sales, payments and debts");
});

test("an older backup without reminder events restores and keeps the reminders on this phone", async () => {
  const event = await recordReminderSent({ customerId: "c1", customerName: "Ama", now: 7_000 });
  const old = backupWith({ transactions: [{ id: "s1", type: "sale", amountPesewas: 500, total_amount: 500, payment_method: "cash", createdAt: 10, timestamp: 10, updatedAt: 10 }] });
  assert.equal("reminders" in old.data, false);
  const result = await importDatabaseFromJson(file(old));
  assert.equal(result.reminders, 0);
  assert.ok(await db.transactions.get("s1"));
  assert.deepEqual(await db.reminders.toArray(), [event]);
  assert.deepEqual(validateBackupData(old).reminders, undefined, "validation keeps the file's own tables");
});

test("a backup with a broken reminder event is refused and writes nothing", async () => {
  for (const bad of [
    { id: "r1", customerId: "c1", nameLower: "ama", channel: "sms", createdAt: 5 },
    { id: "r1", customerId: "c1", nameLower: "ama", channel: "whatsapp", createdAt: "5" },
    { id: "r1", customerId: "", nameLower: "", channel: "whatsapp", createdAt: 5 }
  ]) {
    await assert.rejects(importDatabaseFromJson(file(backupWith({ reminders: [bad] }))), /invalid reminder/);
  }
  assert.equal((await db.reminders.toArray()).length, 0);
});