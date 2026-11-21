// rules_global.whatsapp_links (decided 20 and 21 Nov 2026): the ONE place that opens WhatsApp. Every
// WhatsApp action (reminders on 22, 32, 29/43, the 7-day sheet and Debt saved; Send receipt on 28, 30,
// 31 and the detail receipt) calls openWhatsApp; no other file builds a wa.me or whatsapp:// link
// (tests/whatsappOpenerScan.test.js). Nothing is ever sent: WhatsApp opens with the text filled in and
// the merchant presses send.
//
// Order:
//   1. A number that passes the Ghana check (normalizeWhatsAppPhone): on a phone (Android, iPhone,
//      iPad) the installed app straight to that chat, whatsapp://send?phone=233…&text=… (works
//      offline: no web page has to load). On a desktop browser, wa.me/233…?text=… in a new tab.
//   2. No number, or one that fails the check: the phone's share sheet (navigator.share), so the
//      merchant picks the chat. A closed share sheet is "cancelled", not an error.
//   3. No share sheet, or one that fails: the same links as in 1, without a number.
// Returns "app", "web", "share" or "cancelled".
import { normalizeWhatsAppPhone } from "../utils/whatsapp.js";

export function isPhoneBrowser(nav = globalThis.navigator) {
  return /Android|iPhone|iPad|iPod/i.test(nav?.userAgent ?? "");
}

// The number WhatsApp wants: digits only with the country code (233…), or "" when it fails the check.
export function whatsAppDigits(phone) {
  const normalized = typeof phone === "string" ? normalizeWhatsAppPhone(phone) : null;
  return normalized ? normalized.slice(1) : "";
}

function appLink(text, digits) {
  return `whatsapp://send?${digits ? `phone=${digits}&` : ""}text=${encodeURIComponent(text)}`;
}

function webLink(text, digits) {
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

function openLink(text, digits) {
  if (isPhoneBrowser()) {
    window.location.href = appLink(text, digits);
    return "app";
  }
  window.open(webLink(text, digits), "_blank", "noopener,noreferrer");
  return "web";
}

export async function openWhatsApp({ text, phone = "", title = "" } = {}) {
  if (typeof text !== "string" || !text) throw new TypeError("A WhatsApp text is required.");
  const digits = whatsAppDigits(phone);
  if (digits) return openLink(text, digits);
  const nav = globalThis.navigator;
  if (typeof nav?.share === "function") {
    try {
      await nav.share(title ? { title, text } : { text });
      return "share";
    } catch (error) {
      if (error?.name === "AbortError") return "cancelled";
      console.warn("The share sheet could not open; trying WhatsApp directly.", error);
    }
  }
  return openLink(text, "");
}
