import { displayName } from "../lib/displayName.js";
import { FEATURE_FLAGS } from "../config/features.js";
import { buildCollectionReceiptMessage } from "./collectionReceipt.js";
import { buildSaleReceiptMessage, getSaleReceiptDetails } from "./saleReceipt.js";
import { formatDate, formatTime } from "../lib/formatDate.js";
import { formatGhs } from "../lib/formatGhs.js";

// Receipts are built only from these fields. Customer phone and Ghana Card numbers are never read.

function amount(pesewas) {
  if (!Number.isSafeInteger(pesewas) || pesewas < 0) {
    throw new TypeError("Receipt amounts must be non-negative integer pesewas.");
  }
  return formatGhs(pesewas);
}

function formatDateTime(timestamp) {
  const when = new Date(timestamp);
  if (!Number.isFinite(timestamp) || !Number.isFinite(when.getTime())) {
    throw new RangeError("The receipt time is invalid.");
  }
  return `${formatDate(when)}, ${formatTime(when)}`;
}

function formatDueDate(dateString) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString ?? "");
  if (!match) throw new TypeError("The due date is invalid.");
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) {
    throw new TypeError("The due date is invalid.");
  }
  return formatDate(dateString);
}

function requireName(name, message) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) throw new TypeError(message);
  return trimmed;
}

function paymentParts(cashPesewas, momoPesewas) {
  return [
    ...(cashPesewas > 0 ? [`Cash ${amount(cashPesewas)}`] : []),
    ...(momoPesewas > 0 ? [`MoMo ${amount(momoPesewas)}`] : [])
  ];
}

export function buildSaleReceipt({
  shopName,
  timestamp,
  items = [],
  totalPesewas,
  cashPesewas = 0,
  momoPesewas = 0,
  owedPesewas = 0,
  dueDate = ""
}) {
  const shop = requireName(shopName, "A shop name is required for the receipt.");
  if (!Number.isSafeInteger(totalPesewas) || totalPesewas <= 0) {
    throw new RangeError("The recorded sale has an invalid amount.");
  }
  if (cashPesewas + momoPesewas + owedPesewas !== totalPesewas) {
    throw new RangeError("The receipt payment parts do not match the sale total.");
  }
  const itemTotal = items.reduce((sum, item) => sum + item.amountPesewas, 0);
  if (items.length && itemTotal !== totalPesewas) {
    throw new RangeError("Sale items do not match the recorded sale total.");
  }

  const paid = paymentParts(cashPesewas, momoPesewas);
  return [
    `Receipt from ${shop}`,
    formatDateTime(timestamp),
    ...items.map(({ name, quantity, amountPesewas }) => `${name} × ${quantity}: ${amount(amountPesewas)}`),
    `Total: ${amount(totalPesewas)}`,
    ...(paid.length ? [`Paid: ${paid.join(", ")}`] : []),
    ...(owedPesewas > 0
      ? [`Owed: ${amount(owedPesewas)}${dueDate ? `, pay by ${formatDueDate(dueDate)}` : ""}`]
      : []),
    "Thank you!"
  ].join("\n");
}

export function buildPaymentReceipt({
  shopName,
  customerName,
  timestamp,
  cashPesewas = 0,
  momoPesewas = 0,
  remainingPesewas,
  installmentPesewas = 0,
  nextDueDate = ""
}) {
  const shop = requireName(shopName, "A shop name is required for the receipt.");
  const customer = displayName(requireName(customerName, "A customer name is required for the receipt."));
  const paidPesewas = cashPesewas + momoPesewas;
  if (paidPesewas <= 0) throw new RangeError("The collection has no payment to show.");
  const hasNextPayment = installmentPesewas > 0 && remainingPesewas > 0;

  return [
    `Payment received by ${shop}`,
    formatDateTime(timestamp),
    `From: ${customer}`,
    `Amount: ${amount(paidPesewas)} (${paymentParts(cashPesewas, momoPesewas).join(", ")})`,
    `Still owed: ${amount(remainingPesewas)}`,
    ...(hasNextPayment
      ? [`Next payment: ${amount(Math.min(remainingPesewas, installmentPesewas))} on ${formatDueDate(nextDueDate)}`]
      : []),
    "Thank you!"
  ].join("\n");
}

export function buildCustomerBalanceReceipt({
  shopName,
  customerName,
  timestamp = Date.now(),
  balancePesewas,
  installmentPesewas = 0,
  nextDueDate = ""
}) {
  const shop = requireName(shopName, "A shop name is required for the receipt.");
  const customer = displayName(requireName(customerName, "A customer name is required for the receipt."));
  if (!Number.isSafeInteger(balancePesewas) || balancePesewas < 0) {
    throw new RangeError("The customer balance is invalid.");
  }
  const hasNextPayment = installmentPesewas > 0 && balancePesewas > 0;

  return [
    `Receipt from ${shop}`,
    formatDateTime(timestamp),
    `For: ${customer}`,
    `Balance owed as of ${formatDateTime(timestamp)}: ${amount(balancePesewas)}`,
    ...(hasNextPayment
      ? [`Next payment: ${amount(Math.min(balancePesewas, installmentPesewas))} on ${formatDueDate(nextDueDate)}`]
      : []),
    "Thank you!"
  ].join("\n");
}

// A cash/MoMo sale, or a sale partly on credit. Item lines appear only when the shop sells with items.
export function buildSaleReceiptFromTransaction(transaction, shopName, { items, dueDate = "" } = {}) {
  const owedPesewas = transaction.creditExtendedPesewas ?? 0;
  if (transaction.paymentType !== "credit" && owedPesewas === 0) {
    const details = getSaleReceiptDetails(transaction);
    return buildSaleReceipt({
      shopName,
      timestamp: details.timestamp,
      items: items ?? details.items,
      totalPesewas: details.amountPesewas,
      cashPesewas: details.cashReceivedPesewas,
      momoPesewas: details.momoReceivedPesewas
    });
  }
  return buildSaleReceipt({
    shopName,
    timestamp: transaction.timestamp ?? transaction.createdAt,
    items: (items ?? []).map(({ name, quantity, total_amount, amountPesewas }) => ({
      name,
      quantity,
      amountPesewas: amountPesewas ?? total_amount
    })),
    totalPesewas: transaction.amountPesewas,
    cashPesewas: transaction.cashReceivedPesewas ?? 0,
    momoPesewas: transaction.momoReceivedPesewas ?? 0,
    owedPesewas,
    dueDate: dueDate || transaction.dueDate || ""
  });
}

export function buildCreditSaleReceipt(result, shopName) {
  const transaction = result?.saleTransaction;
  const shop = requireName(shopName, "A shop name is required for the receipt.");
  if (!transaction || !Number.isSafeInteger(result.amountPesewas) || result.amountPesewas <= 0) {
    throw new TypeError("The credit sale details are invalid.");
  }
  const parts = Array.isArray(result.initialPaymentParts) ? result.initialPaymentParts : [];
  const cashPesewas = parts
    .filter((part) => part.paymentMethod === "cash")
    .reduce((sum, part) => sum + part.amountPesewas, 0);
  const momoPesewas = parts
    .filter((part) => part.paymentMethod === "momo")
    .reduce((sum, part) => sum + part.amountPesewas, 0);
  const paidPesewas = cashPesewas + momoPesewas;
  if (paidPesewas !== (result.initialPaymentPesewas ?? 0)) {
    throw new RangeError("The credit sale payment parts do not match the recorded payment.");
  }
  if (!Number.isSafeInteger(result.totalDebtPesewas) || result.totalDebtPesewas < 0) {
    throw new RangeError("The remaining credit balance is invalid.");
  }

  const plan = result.debtAfter?.isInstallmentPlan ? result.debtAfter : null;
  if (result.debtAfter === undefined) {
    throw new TypeError("The reconciled credit balance is required for the receipt.");
  }
  return [
    `Receipt from ${shop}`,
    formatDateTime(transaction.timestamp ?? transaction.createdAt),
    `This sale: ${amount(result.amountPesewas)}`,
    ...(paidPesewas > 0
      ? [`Paid today: ${amount(paidPesewas)} (${paymentParts(cashPesewas, momoPesewas).join(", ")})`]
      : []),
    `Balance owed as of ${formatDateTime(transaction.timestamp ?? transaction.createdAt)}: ${amount(result.totalDebtPesewas)}`,
    ...(plan && result.totalDebtPesewas > 0
      ? [`Next payment: ${amount(Math.min(result.totalDebtPesewas, plan.installmentAmount))} on ${formatDueDate(plan.nextDueDate)}`]
      : []),
    "Thank you!"
  ].join("\n");
}

export function buildPaymentReceiptFromCollection(result, shopName) {
  const sumFor = (method) => (result?.parts ?? [])
    .filter((part) => part.paymentMethod === method)
    .reduce((sum, part) => sum + part.amountPesewas, 0);
  const cashPesewas = sumFor("cash");
  const momoPesewas = sumFor("momo");
  if (cashPesewas + momoPesewas !== result?.amountPesewas) {
    throw new TypeError("The receipt payment parts do not match the recorded collection total.");
  }
  const plan = result.debtAfter?.isInstallmentPlan ? result.debtAfter : null;
  return buildPaymentReceipt({
    shopName,
    customerName: result.customerName,
    timestamp: result.createdAt,
    cashPesewas,
    momoPesewas,
    remainingPesewas: result.remainingPesewas,
    installmentPesewas: plan?.installmentAmount ?? 0,
    nextDueDate: plan?.nextDueDate ?? ""
  });
}

export function isReceiptTemplatesEnabled() {
  return FEATURE_FLAGS.SHOW_POS_RECEIPTS === true;
}

// With the flag off, the receipts that shipped before the templates keep working unchanged.
export function getSaleReceiptText(transaction, shopName, options = {}, enabled = isReceiptTemplatesEnabled()) {
  return enabled
    ? buildSaleReceiptFromTransaction(transaction, shopName, options)
    : buildSaleReceiptMessage(transaction, shopName);
}

export function getCollectionReceiptText(result, shopName, enabled = isReceiptTemplatesEnabled()) {
  return enabled
    ? buildPaymentReceiptFromCollection(result, shopName)
    : buildCollectionReceiptMessage(result, shopName);
}
