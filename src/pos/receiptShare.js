// Sending and copying a receipt (wiring 28, 30, 31 "Receipts offline"). The sale or collection is
// already saved before any of this runs, and nothing here ever blocks Done or New sale.

function isPhoneBrowser() {
  return typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent ?? "");
}

// whatsapp://send opens the installed app. The phone is digits only (233...), or left out.
export function buildWhatsAppAppLink(text, phone = "") {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return `whatsapp://send?${digits ? `phone=${digits}&` : ""}text=${encodeURIComponent(text)}`;
}

// The web link: only the last fallback, on a desktop browser.
export function buildWhatsAppWebLink(text, phone = "") {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

// Opens WhatsApp with the text: the app link on a phone, wa.me on a desktop browser.
function openWhatsApp(text, digits) {
  if (isPhoneBrowser()) {
    window.location.href = buildWhatsAppAppLink(text, digits);
    return "app";
  }
  window.open(buildWhatsAppWebLink(text, digits), "_blank", "noopener,noreferrer");
  return "web";
}

// Recipient order: a customer with a valid saved number gets WhatsApp opened straight to that number
// (whatsapp://send?phone=... on a phone, wa.me with the number on a desktop browser). Without a number
// the phone's share sheet opens so the merchant picks the chat; with no share sheet, or one that fails,
// the same links open without a number. Returns "app", "web", "share" or "cancelled" (a closed share
// sheet, which is not an error).
export async function sendReceipt({ text, phone = "", title = "" }) {
  if (typeof text !== "string" || !text) throw new TypeError("A receipt text is required.");
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (/^\d{8,15}$/.test(digits)) return openWhatsApp(text, digits);
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share(title ? { title, text } : { text });
      return "share";
    } catch (error) {
      if (error?.name === "AbortError") return "cancelled";
      console.warn("The share sheet could not open; trying WhatsApp directly.", error);
    }
  }
  return openWhatsApp(text, "");
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
