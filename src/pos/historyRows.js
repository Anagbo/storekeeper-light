import { formatDate, formatTime } from "../lib/formatDate.js";
import { formatGhs } from "../lib/money.js";
import { formatHistoryTimestamp } from "../utils/customerDebtHistory.js";
import { posText as t } from "./i18n.js";

// One person's "What happened" rows, shared by 29/43 and 73: the parts of one collection (Cash and
// MoMo) become one Paid row; newest first.
export function groupCollectionHistory(events) {
  const rows = new Map();
  for (const event of events) {
    if (event.type !== "payment" || !event.collectionId) {
      rows.set(event.id, event);
      continue;
    }
    const id = `collection-${event.collectionId}`;
    const row = rows.get(id) ?? {
      id,
      type: "payment",
      timestamp: event.timestamp,
      amountPesewas: 0,
      collectionParts: []
    };
    row.amountPesewas += event.amountPesewas;
    row.collectionParts.push({ method: event.method, amountPesewas: event.amountPesewas });
    rows.set(id, row);
  }
  return [...rows.values()].sort((left, right) => right.timestamp - left.timestamp);
}

// "Today HH:mm" or "dd/mm/yyyy HH:mm" (dates through formatDate, times through formatTime).
export function formatHistoryRowTimestamp(timestamp) {
  const value = timestamp instanceof Date ? timestamp.getTime() : Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return formatHistoryTimestamp(timestamp).date;
  const date = new Date(value);
  const today = new Date();
  const isToday = date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  const time = formatTime(date);
  return isToday ? `Today ${time}` : `${formatDate(date)} ${time}`;
}

export const CREDIT_ROW_TYPES = new Set(["credit", "addon", "manual_debt"]);

// The "Time" value on a What happened card (wiring "What happened cards", decision (1), 16 Nov 2026):
// "Today HH:mm" for today, otherwise "dd/mm/yyyy HH:mm" (formatDate then formatTime). A debt entered
// with an earlier Taken on date has no real time and always shows the day only.
export function rowTime(event) {
  if (event.dateOnly) return formatDate(event.timestamp);
  return formatHistoryRowTimestamp(event.timestamp);
}

// What a credit row was for, or "No reason written".
export function rowReason(event) {
  return event.reason?.trim() ? event.reason.trim() : t("creditRow.noReason");
}

// "Cash GH₵6.00, MoMo GH₵4.00" for a Paid row (one part: "Cash GH₵6.00"). Always Cash first, then
// MoMo: the parts come from the database in id order, which is random. The one helper for every Paid
// row on 29, 43 and 73 (rules_global.customer_proof.paid_order).
const METHOD_ORDER = ["Cash", "MoMo"];
const methodRank = (method) => (METHOD_ORDER.includes(method) ? METHOD_ORDER.indexOf(method) : METHOD_ORDER.length);
export function paidParts(event) {
  if (event.collectionParts?.length) {
    return [...event.collectionParts]
      .sort((left, right) => methodRank(left.method) - methodRank(right.method))
      .map((part) => `${part.method} ${formatGhs(part.amountPesewas)}`).join(", ");
  }
  return `${event.method ?? "Cash"} ${formatGhs(event.amountPesewas)}`;
}

// The reason entered on 54 for a correction: the note typed, or the reason chosen.
export function correctionReason(event) {
  return event.reasonNote?.trim() || event.reasonLabel || "";
}
