import { displayName } from "../lib/displayName.js";
import { formatGhs } from "../lib/formatGhs.js";

const GHANA_MOBILE_PREFIX = /^(?:2[0-9]|5[0-9])/;

export function normalizeWhatsAppPhone(customerPhone) {
  if (typeof customerPhone !== "string" || !customerPhone.trim()) return null;

  const input = customerPhone.trim();
  if (!/^[+0-9\s().-]+$/.test(input)) return null;
  if (input.indexOf("+") > 0 || (input.match(/\+/g) ?? []).length > 1) return null;
  if (/[()]/.test(input.replace(/\(\s*\d+\s*\)/g, ""))) return null;

  let digits = input.replace(/\D/g, "");
  if (input.startsWith("+")) {
    if (!digits.startsWith("233")) return null;
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
    if (!digits.startsWith("233")) return null;
  } else if (digits.length === 10 && digits.startsWith("0")) {
    digits = `233${digits.slice(1)}`;
  } else if (digits.length === 9) {
    digits = `233${digits}`;
  } else if (digits.length === 12 && digits.startsWith("233")) {
    // Already in international digits-only format.
  } else {
    return null;
  }

  if (!/^233[0-9]{9}$/.test(digits) || !GHANA_MOBILE_PREFIX.test(digits.slice(3))) return null;
  return `+${digits}`;
}

// The amount is whole pesewas, shown through the one formatter ("GH₵12.00"). A cedi or
// fractional value is refused, so a caller that still passes cedis fails loudly instead of
// sending a wrong amount.
// The reminder text itself, also used without a phone (29/43: the share sheet, the owner picks the chat).
export function buildWhatsAppReminderText(customerName, debtAmountPesewas, shopName = "StoreKeeper Light") {
  if (!Number.isSafeInteger(debtAmountPesewas) || debtAmountPesewas <= 0) return null;
  // The customer's name with a capital first letter, as on screen; the stored name is not changed.
  const name = typeof customerName === "string" ? displayName(customerName) : "";
  const shop = typeof shopName === "string" ? shopName.trim() : "";
  if (!name || !shop) return null;
  return `Hello *${name}*, this is a gentle reminder from *${shop}* regarding your outstanding balance of *${formatGhs(debtAmountPesewas)}*. Kindly arrange payment at your earliest convenience. Thank you!`;
}
// Opening WhatsApp with this text: src/lib/openWhatsApp.js (rules_global.whatsapp_links), the only
// place that builds a WhatsApp link.
