import { posText as t } from "./i18n.js";

// 43: "Last reminder: {n} days ago", counted in calendar days on this device.
export function formatLastReminder(lastReminderAt, now = new Date()) {
  const value = Number(lastReminderAt);
  if (!Number.isFinite(value) || value <= 0) return "";
  const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.max(0, Math.round((startOfDay(now) - startOfDay(new Date(value))) / 86_400_000));
  if (days === 0) return t("collect.lastReminderToday");
  if (days === 1) return t("collect.lastReminderOneDay");
  return t("collect.lastReminderDays", { days });
}