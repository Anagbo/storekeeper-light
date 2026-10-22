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

export function generateWhatsAppLink(
  customerPhone,
  customerName,
  debtAmount,
  shopName = "StoreKeeper Light"
) {
  const phone = normalizeWhatsAppPhone(customerPhone);
  const amount = Number(debtAmount);
  if (!phone || !Number.isFinite(amount) || amount <= 0) return null;

  const name = typeof customerName === "string" ? customerName.trim() : "";
  const shop = typeof shopName === "string" ? shopName.trim() : "";
  if (!name || !shop) return null;

  const message = `Hello *${name}*, this is a gentle reminder from *${shop}* regarding your outstanding balance of *GH₵ ${amount.toFixed(2)}*. Kindly arrange payment at your earliest convenience. Thank you!`;
  return `https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(message)}`;
}
