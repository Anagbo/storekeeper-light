import { db } from "./db.js";
import { createId } from "../lib/ids.js";

// rules_global.reminders: a local "reminder sent" event (person, time, channel). Appended only:
// nothing here edits or deletes an event. It records that the app handed the reminder over to
// WhatsApp, never that the message was delivered.
export const REMINDER_CHANNELS = new Set(["whatsapp"]);

function nameKey(name) {
  return typeof name === "string" ? name.trim().toLowerCase() : "";
}

export function makeReminderEvent({ customerId = "", customerName = "", channel = "whatsapp", now = Date.now() }) {
  const nameLower = nameKey(customerName);
  if (!customerId && !nameLower) throw new TypeError("A reminder needs a person.");
  if (!REMINDER_CHANNELS.has(channel)) throw new TypeError("Unknown reminder channel.");
  if (!Number.isSafeInteger(now) || now <= 0) throw new TypeError("A reminder needs a time.");
  return {
    id: createId(),
    customerId: typeof customerId === "string" ? customerId : "",
    customerName: typeof customerName === "string" ? customerName.trim() : "",
    nameLower,
    channel,
    createdAt: now
  };
}

export async function recordReminderSent(person, database = db) {
  const event = makeReminderEvent(person);
  await database.reminders.add(event);
  return event;
}

export async function loadReminderEvents(database = db) {
  return database.reminders.toArray();
}

// The same person: the same customerId when both have one, otherwise the same name.
export function isReminderFor(event, { customerId = "", customerName = "" } = {}) {
  if (!event) return false;
  if (customerId && event.customerId) return event.customerId === customerId;
  const name = nameKey(customerName);
  return Boolean(name) && event.nameLower === name;
}

// The latest reminder time for a person, or 0 when none was recorded.
export function latestReminderAt(events = [], person = {}) {
  let latest = 0;
  for (const event of events) {
    if (isReminderFor(event, person) && Number.isSafeInteger(event.createdAt) && event.createdAt > latest) latest = event.createdAt;
  }
  return latest;
}

export async function getLatestReminderAt(person, database = db) {
  return latestReminderAt(await loadReminderEvents(database), person);
}