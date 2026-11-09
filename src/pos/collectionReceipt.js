import { normalizeWhatsAppPhone } from "../utils/whatsapp.js";
import { formatGhs } from "../lib/formatGhs.js";

// Receipt amounts are checked, then shown through the one formatter ("GH₵268.20").
function formatReceiptAmount(amountPesewas) {
  if (!Number.isSafeInteger(amountPesewas) || amountPesewas < 0) {
    throw new TypeError("Receipt amounts must be non-negative integer pesewas.");
  }
  return formatGhs(amountPesewas);
}

function formatReceiptDate(dateString) {
  if (typeof dateString !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    throw new TypeError("The installment due date is invalid.");
  }
  const date = new Date(`${dateString}T00:00:00`);
  if (!Number.isFinite(date.getTime())) throw new TypeError("The installment due date is invalid.");
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function buildCollectionReceiptMessage(result, shopName) {
  if (!result || !Array.isArray(result.parts) || result.parts.length === 0) {
    throw new TypeError("A recorded collection is required to build its receipt.");
  }
  const customerName = result.customerName?.trim();
  const normalizedShopName = shopName?.trim();
  const createdAt = new Date(result.createdAt);
  if (!customerName || !normalizedShopName || !Number.isFinite(createdAt.getTime())) {
    throw new TypeError("The receipt is missing its customer, shop, or collection time.");
  }

  const cashPesewas = result.parts
    .filter((part) => part.paymentMethod === "cash")
    .reduce((sum, part) => sum + part.amountPesewas, 0);
  const momoPesewas = result.parts
    .filter((part) => part.paymentMethod === "momo")
    .reduce((sum, part) => sum + part.amountPesewas, 0);
  const amountPesewas = cashPesewas + momoPesewas;
  if (amountPesewas !== result.amountPesewas) {
    throw new TypeError("The receipt payment parts do not match the recorded collection total.");
  }

  const date = createdAt.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const time = createdAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const lines = [
    `Payment received by ${normalizedShopName}`,
    `${date}, ${time}`,
    `From: ${customerName}`,
    `Amount: ${formatReceiptAmount(amountPesewas)} (Cash ${formatReceiptAmount(cashPesewas)}, MoMo ${formatReceiptAmount(momoPesewas)})`,
    `Still owed: ${formatReceiptAmount(result.remainingPesewas)}`
  ];

  if (result.debtAfter?.isInstallmentPlan) {
    const installmentAmountPesewas = result.debtAfter.installmentAmount;
    if (!Number.isSafeInteger(installmentAmountPesewas) || installmentAmountPesewas <= 0) {
      throw new TypeError("The installment amount is invalid.");
    }
    const nextPaymentPesewas = Math.min(result.remainingPesewas, installmentAmountPesewas);
    lines.push(`Next payment: ${formatReceiptAmount(nextPaymentPesewas)} on ${formatReceiptDate(result.debtAfter.nextDueDate)}`);
  }

  lines.push("Thank you!");
  return lines.join("\n");
}

export function buildCollectionReceiptLink(phone, message) {
  const normalizedPhone = normalizeWhatsAppPhone(phone);
  if (!normalizedPhone || typeof message !== "string" || !message.trim()) return null;
  return `https://wa.me/${normalizedPhone.slice(1)}?text=${encodeURIComponent(message)}`;
}
