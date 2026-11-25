import { displayName } from "../lib/displayName.js";
import { FEATURE_FLAGS } from "../config/features.js";
import { buildCollectionReceiptMessage } from "./collectionReceipt.js";
import { buildSaleReceiptMessage, getSaleReceiptDetails } from "./saleReceipt.js";
import { formatDate, formatTime } from "../lib/formatDate.js";
import { formatGhs } from "../lib/formatGhs.js";
import { receiptDueLines } from "./receiptDueLine.js";

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

// The collection receipt (wiring 28 and 29/43 "Collection receipt", decided 15 Nov 2026), the one text
// for 28, 29/43 and Copy receipt:
//   Receipt from {Shop}
//   dd/mm/yyyy HH:mm                      (no comma)
//   Received from {Name}: GH₵x (Cash|MoMo)
//   Balance owed now: GH₵y                ("Nothing owed now" when zero)
//   Next payment: GH₵x on dd/mm/yyyy      (only with a payment plan and something still owed)
//   or Due on dd/mm/yyyy                  (a one-time debt with a due date, something still owed)
//   Thank you!
// A payment split between Cash and MoMo names both parts: (Cash GH₵a, MoMo GH₵b).
// `plan` is the person's open debt as it stands now (a plan or a one-time debt); x is the plan card's
// Still needed, never more than what is owed (receiptDueLines).
export function buildPaymentReceipt({
  shopName,
  customerName,
  timestamp,
  cashPesewas = 0,
  momoPesewas = 0,
  remainingPesewas,
  plan = null
}) {
  const shop = requireName(shopName, "A shop name is required for the receipt.");
  const customer = displayName(requireName(customerName, "A customer name is required for the receipt."));
  amount(cashPesewas);
  amount(momoPesewas); // both are checked as whole, non-negative pesewas
  const paidPesewas = cashPesewas + momoPesewas;
  if (paidPesewas <= 0) throw new RangeError("The collection has no payment to show.");
  const when = new Date(timestamp);
  if (!Number.isFinite(timestamp) || !Number.isFinite(when.getTime())) throw new RangeError("The receipt time is invalid.");
  const method = cashPesewas > 0 && momoPesewas > 0
    ? paymentParts(cashPesewas, momoPesewas).join(", ")
    : cashPesewas > 0 ? "Cash" : "MoMo";

  return [
    `Receipt from ${shop}`,
    `${formatDate(when)} ${formatTime(when)}`,
    `Received from ${customer}: ${amount(paidPesewas)} (${method})`,
    remainingPesewas === 0 ? "Nothing owed now" : `Balance owed now: ${amount(remainingPesewas)}`,
    ...receiptDueLines(plan, remainingPesewas),
    "Thank you!"
  ].join("\n");
}

// paidThisPeriodPesewas is the money already paid toward the installment now due (the debt's
// installmentPaymentCarryPesewas); dueDate is a one-time debt's date when there is no plan.
export function buildCustomerBalanceReceipt({
  shopName,
  customerName,
  timestamp = Date.now(),
  balancePesewas,
  installmentPesewas = 0,
  nextDueDate = "",
  paidThisPeriodPesewas = 0,
  dueDate = ""
}) {
  const shop = requireName(shopName, "A shop name is required for the receipt.");
  const customer = displayName(requireName(customerName, "A customer name is required for the receipt."));
  if (!Number.isSafeInteger(balancePesewas) || balancePesewas < 0) {
    throw new RangeError("The customer balance is invalid.");
  }
  const debt = installmentPesewas > 0
    ? { isInstallmentPlan: true, installmentAmount: installmentPesewas, nextDueDate, installmentPaymentCarryPesewas: paidThisPeriodPesewas }
    : { isInstallmentPlan: false, dueDate };

  return [
    `Receipt from ${shop}`,
    formatDateTime(timestamp),
    `For: ${customer}`,
    `Balance owed as of ${formatDateTime(timestamp)}: ${amount(balancePesewas)}`,
    ...receiptDueLines(debt, balancePesewas),
    "Thank you!"
  ].join("\n");
}

// Add debt (a debt written down without a sale): who, how much was added, what they owe now.
export function buildDebtAddedReceipt({ shopName, customerName, timestamp = Date.now(), addedPesewas, paidPesewas = 0, balancePesewas, reason = "" }) {
  const shop = requireName(shopName, "A shop name is required for the receipt.");
  const customer = displayName(requireName(customerName, "A customer name is required for the receipt."));
  const note = typeof reason === "string" ? reason.trim() : "";
  return [
    `Receipt from ${shop}`,
    formatDateTime(timestamp),
    `For: ${customer}`,
    `Debt added: ${amount(addedPesewas)}${note ? ` (${note})` : ""}`,
    ...(paidPesewas > 0 ? [`Paid today: ${amount(paidPesewas)}`] : []),
    `Balance owed as of ${formatDateTime(timestamp)}: ${amount(balancePesewas)}`,
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

  if (result.debtAfter === undefined) {
    throw new TypeError("The reconciled credit balance is required for the receipt.");
  }
  // The plan as it stands after the sale (debtAfter); without a plan, the sale's own due date.
  const debt = result.debtAfter?.isInstallmentPlan
    ? result.debtAfter
    : { isInstallmentPlan: false, dueDate: result.installmentPlan ? "" : result.dueDate ?? "" };
  return [
    `Receipt from ${shop}`,
    formatDateTime(transaction.timestamp ?? transaction.createdAt),
    `This sale: ${amount(result.amountPesewas)}`,
    ...(paidPesewas > 0
      ? [`Paid today: ${amount(paidPesewas)} (${paymentParts(cashPesewas, momoPesewas).join(", ")})`]
      : []),
    `Balance owed as of ${formatDateTime(transaction.timestamp ?? transaction.createdAt)}: ${amount(result.totalDebtPesewas)}`,
    ...receiptDueLines(debt, result.totalDebtPesewas),
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
  return buildPaymentReceipt({
    shopName,
    customerName: result.customerName,
    timestamp: result.createdAt,
    cashPesewas,
    momoPesewas,
    remainingPesewas: result.remainingPesewas,
    plan: result.debtAfter ?? null
  });
}

// 29/43 (wiring "Collection receipt"): the receipt covers the person's latest payment only, with the
// balance owed now. `payment` is a history row: { timestamp, amountPesewas, method } or a grouped
// collection with collectionParts [{ method, amountPesewas }]. Null when the person never paid.
export function buildLatestPaymentReceipt({ shopName, customerName, payment, balancePesewas, plan = null }) {
  if (!payment) return null;
  const parts = Array.isArray(payment.collectionParts) && payment.collectionParts.length
    ? payment.collectionParts
    : [{ method: payment.method, amountPesewas: payment.amountPesewas }];
  const sumFor = (method) => parts.filter((part) => part.method === method).reduce((sum, part) => sum + part.amountPesewas, 0);
  const timestamp = payment.timestamp instanceof Date ? payment.timestamp.getTime() : typeof payment.timestamp === "string" ? Date.parse(payment.timestamp) : payment.timestamp;
  return buildPaymentReceipt({
    shopName,
    customerName,
    timestamp,
    cashPesewas: sumFor("Cash"),
    momoPesewas: sumFor("MoMo"),
    remainingPesewas: balancePesewas,
    plan
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
