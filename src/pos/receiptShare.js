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

// The phone's share sheet when there is one, else the WhatsApp app link on a phone, else wa.me on
// a desktop browser. Returns "share", "app", "web" or "cancelled" (the person closed the sheet).
// A share sheet that fails for any reason other than being closed falls through to the links.
export async function sendReceipt({ text, phone = "", title = "" }) {
  if (typeof text !== "string" || !text) throw new TypeError("A receipt text is required.");
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share(title ? { title, text } : { text });
      return "share";
    } catch (error) {
      if (error?.name === "AbortError") return "cancelled";
      console.warn("The share sheet could not open; trying WhatsApp directly.", error);
    }
  }
  if (isPhoneBrowser()) {
    window.location.href = buildWhatsAppAppLink(text, phone);
    return "app";
  }
  window.open(buildWhatsAppWebLink(text, phone), "_blank", "noopener,noreferrer");
  return "web";
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
