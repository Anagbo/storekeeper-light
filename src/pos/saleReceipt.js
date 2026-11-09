import { formatGhs } from "../lib/money.js";
import { getMomoDisplayLabel } from "./momoMapping.js";

function readSaleItems(transaction, totalPesewas) {
  let items;
  try {
    items = typeof transaction.items_json === "string"
      ? JSON.parse(transaction.items_json)
      : transaction.items_json ?? [];
  } catch (error) {
    throw new TypeError("Sale item details are not valid JSON.", { cause: error });
  }
  if (!Array.isArray(items)) throw new TypeError("Sale item details must be a list.");

  const normalized = items.map((item) => {
    const name = typeof item?.name === "string" ? item.name.trim() : "";
    const quantity = item?.quantity;
    const amountPesewas = item?.total_amount;
    if (!name || !Number.isSafeInteger(quantity) || quantity <= 0 ||
      !Number.isSafeInteger(amountPesewas) || amountPesewas <= 0) {
      throw new TypeError("Sale item details are incomplete.");
    }
    const subtitle = typeof item?.subtitle === "string" ? item.subtitle.trim() : "";
    return { name, ...(subtitle ? { subtitle } : {}), quantity, amountPesewas };
  });
  const itemTotal = normalized.reduce((sum, item) => sum + item.amountPesewas, 0);
  if (!Number.isSafeInteger(itemTotal) || (normalized.length && itemTotal !== totalPesewas)) {
    throw new RangeError("Sale items do not match the recorded sale total.");
  }
  return normalized;
}

export function getSaleReceiptDetails(transaction) {
  if (!transaction || typeof transaction !== "object") throw new TypeError("Sale details are required.");
  const amountPesewas = transaction.amountPesewas ?? transaction.total_amount;
  if (!Number.isSafeInteger(amountPesewas) || amountPesewas <= 0) {
    throw new RangeError("The recorded sale has an invalid amount.");
  }
  const timestamp = transaction.timestamp ?? transaction.createdAt;
  if (!Number.isFinite(timestamp) || !Number.isFinite(new Date(timestamp).getTime())) {
    throw new RangeError("The recorded sale has an invalid time.");
  }
  const paymentMethod = transaction.payment_method ?? transaction.paymentType;
  const hasSplitParts = transaction.cashReceivedPesewas !== undefined ||
    transaction.momoReceivedPesewas !== undefined;
  const cashReceivedPesewas = hasSplitParts
    ? transaction.cashReceivedPesewas ?? 0
    : paymentMethod === "cash" ? amountPesewas : 0;
  const momoReceivedPesewas = hasSplitParts
    ? transaction.momoReceivedPesewas ?? 0
    : paymentMethod === "momo" ? amountPesewas : 0;
  const creditExtendedPesewas = transaction.creditExtendedPesewas ?? 0;
  const expectedPaidPesewas = amountPesewas - creditExtendedPesewas;
  if (!["cash", "momo", "split"].includes(paymentMethod) ||
    !Number.isSafeInteger(creditExtendedPesewas) || creditExtendedPesewas < 0 ||
    creditExtendedPesewas > amountPesewas ||
    !Number.isSafeInteger(cashReceivedPesewas) || cashReceivedPesewas < 0 ||
    !Number.isSafeInteger(momoReceivedPesewas) || momoReceivedPesewas < 0 ||
    cashReceivedPesewas + momoReceivedPesewas !== expectedPaidPesewas) {
    throw new TypeError("The recorded sale has an invalid payment method.");
  }
  return {
    amountPesewas,
    timestamp,
    paymentMethod,
    cashReceivedPesewas,
    momoReceivedPesewas,
    items: readSaleItems(transaction, amountPesewas)
  };
}

export function buildSaleReceiptMessage(transaction, shopName) {
  const details = getSaleReceiptDetails(transaction);
  const momoLabel = getMomoDisplayLabel(transaction);
  const lines = [
    `Sale recorded by ${shopName.trim() || "StoreKeeper Light"}`,
    `Total: ${formatGhs(details.amountPesewas)}`,
    ...details.items.map(({ name, quantity, amountPesewas }) =>
      `${name} × ${quantity}: ${formatGhs(amountPesewas)}`
    ),
    ...(details.paymentMethod === "split"
      ? [`Payment: Cash ${formatGhs(details.cashReceivedPesewas)} · ${momoLabel} ${formatGhs(details.momoReceivedPesewas)}`]
      : [`Payment: ${details.paymentMethod === "momo" ? momoLabel : "Cash"}`]),
    "Thank you!"
  ];
  return lines.join("\n");
}
