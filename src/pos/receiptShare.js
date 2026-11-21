// Sending and copying a receipt (wiring 28, 30, 31 "Receipts offline"). The sale or collection is
// already saved before any of this runs, and nothing here ever blocks Done or New sale.

import { openWhatsApp } from "../lib/openWhatsApp.js";

// Send receipt goes through the one shared WhatsApp opener (src/lib/openWhatsApp.js): the saved
// number's chat in the installed app, else the share sheet, else the app without a number.
// Returns "app", "web", "share" or "cancelled" (a closed share sheet, which is not an error).
export async function sendReceipt({ text, phone = "", title = "" }) {
  if (typeof text !== "string" || !text) throw new TypeError("A receipt text is required.");
  return openWhatsApp({ text, phone, title });
}

// Copies the exact text. Returns true when it was copied.
export async function copyReceiptText(text) {
  if (typeof text !== "string" || !text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (error) {
    console.warn("The clipboard refused the receipt text; trying the older way.", error);
  }
  try {
    const box = document.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "");
    box.style.position = "fixed";
    box.style.opacity = "0";
    document.body.appendChild(box);
    box.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(box);
    return copied;
  } catch (error) {
    console.error("Could not copy the receipt.", error);
    return false;
  }
}
