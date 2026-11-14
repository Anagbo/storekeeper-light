// The one place a date becomes text for a person: day/month/year with a leading zero, 16/11/2026
// (the format on 53). No imports, like formatGhs.js, so messages and the server can use it too.
//
// Accepted: an ISO date ("2026-11-16", read as that calendar day with no time zone shift), an ISO
// date-time ("2026-11-16T10:00:00.000Z", read as a moment, shown as the local day), a Date, or a
// timestamp in milliseconds. Anything else, including "16/11/2026" and invalid dates, gives "".
// Dates stay ISO text in params and records; only the text shown goes through here.
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T/;

function pad(number) {
  return String(number).padStart(2, "0");
}

function fromParts(year, month, day) {
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return "";
  return `${pad(day)}/${pad(month)}/${String(year).padStart(4, "0")}`;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// The weekday then the date, "Thursday 12/11/2026" (the Menu drawer and the wide sidebar). The day
// is the local day of a Date or timestamp; anything formatDate refuses gives "".
export function formatWeekdayDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const text = formatDate(date);
  return text ? `${WEEKDAYS[date.getDay()]} ${text}` : "";
}

export function formatDate(value) {
  if (typeof value === "string") {
    const match = ISO_DATE.exec(value);
    if (match) return fromParts(Number(match[1]), Number(match[2]), Number(match[3]));
    if (!ISO_DATE_TIME.test(value)) return "";
  } else if (!(value instanceof Date) && !(typeof value === "number" && Number.isFinite(value))) {
    return "";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return fromParts(date.getFullYear(), date.getMonth() + 1, date.getDate());
}
