import { displayName } from "../lib/displayName.js";
import { formatDate, formatTime } from "../lib/formatDate.js";
import { formatGhs } from "../lib/formatGhs.js";
import { receiptDueLines } from "./receiptDueLine.js";

// Receipt amounts are checked, then shown through the one formatter ("GH₵268.20").
function formatReceiptAmount(amountPesewas) {
  if (!Number.isSafeInteger(amountPesewas) || amountPesewas < 0) {
    throw new TypeError("Receipt amounts must be non-negative integer pesewas.");
  }
  return formatGhs(amountPesewas);
}

export function buildCollectionReceiptMessage(result, shopName) {
  if (!result || !Array.isArray(result.parts) || result.parts.length === 0) {
    throw new TypeError("A recorded collection is required to build its receipt.");
  }
  const customerName = displayName(result.customerName);
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

  const date = formatDate(createdAt);
  const time = formatTime(createdAt);
  const lines = [
    `Payment received by ${normalizedShopName}`,
    `${date}, ${time}`,
    `From: ${customerName}`,
    `Amount: ${formatReceiptAmount(amountPesewas)} (Cash ${formatReceiptAmount(cashPesewas)}, MoMo ${formatReceiptAmount(momoPesewas)})`,
    `Still owed: ${formatReceiptAmount(result.remainingPesewas)}`
  ];

  // The same Next payment / Due on line as the receipt with the flag on (receiptDueLines).
  lines.push(...receiptDueLines(result.debtAfter, result.remainingPesewas));

  lines.push("Thank you!");
  return lines.join("\n");
}
