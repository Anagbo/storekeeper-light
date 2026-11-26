// The one phone number rule for every phone field (supplier, new person, contact editor, Call link).
// It is the WhatsApp check (normalizeWhatsAppPhone), so a number a form accepts is one WhatsApp and
// phone search can use: 0 + 9 digits, 9 digits, or +233 / 233 / 00233 + 9 digits, a Ghana mobile
// prefix (2x or 5x) after 233, spaces, dashes and brackets ignored. Empty is valid: the fields are
// optional. Forms keep what was typed; each place stores the form it stored before.
import { normalizeWhatsAppPhone } from "../utils/whatsapp.js";

export const INVALID_PHONE_MESSAGE = "Enter a valid mobile number, like 024 123 4567";

export function isValidPhone(value) {
  if (value === undefined || value === null) return true;
  if (typeof value !== "string") return false;
  if (!value.trim()) return true;
  return normalizeWhatsAppPhone(value) !== null;
}

// A saved number that passes the rule (not empty, not a bad old number).
export function hasUsablePhone(value) {
  return typeof value === "string" && Boolean(value.trim()) && isValidPhone(value);
}
