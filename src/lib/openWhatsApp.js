// rules_global.whatsapp_links (decided 20 and 21 Nov 2026): the ONE place that opens WhatsApp. Every
// WhatsApp action (reminders on 22, 32, 29/43, the 7-day sheet and Debt saved; Send receipt on 28, 30,
// 31 and the detail receipt) calls openWhatsApp; no other file builds a wa.me or whatsapp:// link
// (tests/whatsappOpenerScan.test.js). Nothing is ever sent: WhatsApp opens with the text filled in and
// the merchant presses send.
//
// Order while online:
//   1. A number that passes the Ghana check (normalizeWhatsAppPhone): on a phone (Android, iPhone,
//      iPad) the installed app straight to that chat, whatsapp://send?phone=233…&text=…. On a desktop
//      browser, wa.me/233…?text=… in a new tab.
//   2. No number, or one that fails the check: the phone's share sheet (navigator.share), so the
//      merchant picks the chat. A closed share sheet is "cancelled", not an error.
//   3. No share sheet, or one that fails: the same links as in 1, without a number.
// Offline (navigator.onLine === false, decided 21 Nov 2026 from phone tests: the direct link and wa.me
// both stop at WhatsApp's "No internet connection", the share sheet works and WhatsApp keeps the
// message until the phone is back online): the share sheet first, even with a valid number. With no
// share sheet, or one that fails, the offline chooser (WhatsAppOfflineSheet, mounted once by PosApp)
// offers "Copy reminder" / "Copy receipt", "Open WhatsApp anyway" and Not now. Without a mounted
// chooser the links of 1 and 3 open as before.
// Returns "app", "web", "share", "copied" or "cancelled" (a closed share sheet, or Not now).
import { normalizeWhatsAppPhone } from "../utils/whatsapp.js";

// The offline chooser: a function ({ text, kind, title }) => Promise<"open" | "copied" | "cancelled">.
// setOfflineChooser returns the function that removes it again.
let offlineChooser = null;
export function setOfflineChooser(chooser) {
  offlineChooser = chooser;
  return () => { if (offlineChooser === chooser) offlineChooser = null; };
}

export function isOffline(nav = globalThis.navigator) {
  return nav?.onLine === false;
}

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

// The share sheet: "share", "cancelled" when the merchant closed it, or null when there is none or it
// failed.
async function shareSheet(text, title) {
  const nav = globalThis.navigator;
  if (typeof nav?.share !== "function") return null;
  try {
    await nav.share(title ? { title, text } : { text });
    return "share";
  } catch (error) {
    if (error?.name === "AbortError") return "cancelled";
    console.warn("The share sheet could not open.", error);
    return null;
  }
}

// kind is "reminder" or "receipt": it names the copy button of the offline chooser.
export async function openWhatsApp({ text, phone = "", title = "", kind = "reminder" } = {}) {
  if (typeof text !== "string" || !text) throw new TypeError("A WhatsApp text is required.");
  const digits = whatsAppDigits(phone);
  if (isOffline()) {
    const shared = await shareSheet(text, title);
    if (shared) return shared;
    if (!offlineChooser) return openLink(text, digits);
    const choice = await offlineChooser({ text, kind: kind === "receipt" ? "receipt" : "reminder", title });
    if (choice === "open") return openLink(text, digits);
    return choice === "copied" ? "copied" : "cancelled";
  }
  if (digits) return openLink(text, digits);
  return (await shareSheet(text, title)) ?? openLink(text, "");
}
