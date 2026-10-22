export function normalizeWhatsAppPhone(customerPhone) {
  if (typeof customerPhone !== "string" || !customerPhone.trim()) return null;
  if (!/^[+\d\s().-]+$/.test(customerPhone.trim())) return null;

  let digits = customerPhone.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `233${digits.slice(1)}`;
  if (digits.length === 9) digits = `233${digits}`;

  return /^233\d{9}$/.test(digits) ? `+${digits}` : null;
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
