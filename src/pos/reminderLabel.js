import { formatDate, formatTime } from "../lib/formatDate.js";
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
