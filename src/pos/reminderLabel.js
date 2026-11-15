import { formatDate, formatTime } from "../lib/formatDate.js";
import { displayName } from "../lib/displayName.js";
import { posText as t } from "./i18n.js";

// rules_global.reminders wording: "today HH:mm", "yesterday HH:mm", else "dd/mm/yyyy HH:mm", counted
// in calendar days on this device; times through formatTime, dates through formatDate. It says when
// the reminder was handed over to WhatsApp, never that it was delivered.
function validTime(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

// { day: "today" | "yesterday" | "date", date: "dd/mm/yyyy", time: "HH:mm" }, or null with no reminder.
export function reminderWhen(lastReminderAt, now = new Date()) {
  if (!validTime(lastReminderAt)) return null;
  const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const when = new Date(lastReminderAt);
  const days = Math.round((startOfDay(now) - startOfDay(when)) / 86_400_000);
  return {
    day: days === 0 ? "today" : days === 1 ? "yesterday" : "date",
    date: formatDate(when),
    time: formatTime(when)
  };
}

// The Last reminder line on 29/43 (and the wide detail pane D3).
export function formatLastReminder(lastReminderAt, now = new Date()) {
  const when = reminderWhen(lastReminderAt, now);
  if (!when) return t("collect.noReminderYet");
  if (when.day === "today") return t("collect.lastReminderToday", { time: when.time });
  if (when.day === "yesterday") return t("collect.lastReminderYesterday", { time: when.time });
  return t("collect.lastReminderOn", { date: when.date, time: when.time });
}

// The shared 7-day check (rules_global.reminders): a reminder to this person recorded less than
// 7 days ago asks "Send another reminder?" first. Used only through useReminderCheck (ReminderCheck.jsx).
export const REMINDER_REPEAT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function needsReminderCheck(lastReminderAt, now = Date.now()) {
  if (!validTime(lastReminderAt)) return false;
  return now - lastReminderAt < REMINDER_REPEAT_WINDOW_MS;
}

// "You sent Ama a reminder yesterday at 14:05. Sending too many can annoy a customer."
export function reminderAgainText(name, lastReminderAt, now = new Date()) {
  const when = reminderWhen(lastReminderAt, now);
  if (!when) return "";
  const day = when.day === "today" ? t("reminderAgain.today")
    : when.day === "yesterday" ? t("reminderAgain.yesterday")
      : t("reminderAgain.onDate", { date: when.date });
  return t("reminderAgain.body", { name: displayName(name), when: day, time: when.time });
}
