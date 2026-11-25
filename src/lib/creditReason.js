import { getHistoryCreditAmount } from "../utils/customerDebtHistory.js";

// rules_global.customer_proof.what_for / no_reason: what ONE credit was for. Items for a sale, the
// reason typed on 53 for a debt added by hand. Words the app writes by itself ("Sale", the "Other
// amount" line, …) are not a reason: "" comes back and the screens show "No reason written".
const GENERATED = new Set(["sale", "other amount", "credit extended", "debt add-on", "debt added", "credit entry"]);

const isGenerated = (text) => GENERATED.has(text.replace(/\s+×\s*\d+$/, "").trim().toLowerCase());

function itemNames(record) {
  let items;
  try {
    items = JSON.parse(record.items_json ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => typeof item?.name === "string" && item.name.trim() && !isGenerated(item.name))
    .map((item) => (Number.isFinite(item.quantity) && item.quantity > 1 ? `${item.name.trim()} × ${item.quantity}` : item.name.trim()));
}

function cleanText(text) {
  if (typeof text !== "string") return "";
  return text.split(",").map((part) => part.trim()).filter((part) => part && !isGenerated(part)).join(", ");
}

const SALE_CREDIT_TYPES = new Set(["installment_sale", "installment_addon"]);

// A credit event as the history reads it: a debt added by hand, a plan sale or add-on, or a sale on credit.
export function isCreditEvent(record) {
  if (!record || typeof record !== "object") return false;
  if (record.type === "manual_debt") return true;
  if (SALE_CREDIT_TYPES.has(record.type)) return true;
  return ["sale", "credit_sale"].includes(record.type) && record.paymentType === "credit";
}

// rules_global.credit_reason (16 Nov 2026): the reason typed on 18 for a keypad sale or the Owe part of a
// split. Optional, trimmed, at most 60 characters. Kept exactly as typed (" · " included).
export const CREDIT_REASON_MAX = 60;

export function cleanCreditReason(text) {
  if (typeof text !== "string") return "";
  return text.trim().slice(0, CREDIT_REASON_MAX).trim();
}

// The reason saved in its own field (creditReason), or "" when it is missing or a generated word.
function typedReason(record) {
  const reason = cleanCreditReason(record.creditReason);
  return reason && !isGenerated(reason) ? reason : "";
}

export function getCreditReason(record) {
  if (!record) return "";
  // Events saved since 16 Nov 2026 carry the reason in creditReason; older ones fall back to note/items.
  const typed = typedReason(record);
  if (typed) return typed;
  if (record.type === "manual_debt") return cleanText(record.note);
  const items = itemNames(record);
  if (items.length) return items.join(", ");
  return cleanText(record.itemDescription) || cleanText(typeof record.note === "string" ? record.note.split(" · ")[0] : "");
}

// The amount of that ONE credit event: the Owe part of a sale, the amount added for a manual debt.
// An older balance is never in it.
export function getCreditEventAmountPesewas(record) {
  if (Number.isSafeInteger(record?.creditExtendedPesewas) && record.creditExtendedPesewas >= 0) return record.creditExtendedPesewas;
  return getHistoryCreditAmount(record ?? {});
}

// 29/43 "Open debt entries" (16 Nov 2026): what one open debt entry is for. The debt's note holds the
// reasons of the credits added to it, joined with ", "; generated words ("Sale", "Other amount", …)
// are dropped, so "Sale, Sale" is "" and the screen shows "No reason written".
export function getDebtEntryReason(debt) {
  if (!debt) return "";
  return cleanText(debt.note) || cleanText(debt.description) || cleanText(debt.itemDescription);
}

// rules_global "Recent reason chip" (polish 6): the What for field is a list of items joined with ", ".
// A chip is selected when all of its items are in the field; a tap adds its items or removes them. Typed
// items count too, and the field stays editable. Compared ignoring case.
const reasonItems = (text) => (typeof text === "string" ? text.split(",").map((part) => part.trim()).filter(Boolean) : []);

export function reasonChipSelected(field, chip) {
  const have = new Set(reasonItems(field).map((item) => item.toLowerCase()));
  const wanted = reasonItems(chip);
  return wanted.length > 0 && wanted.every((item) => have.has(item.toLowerCase()));
}

export function toggleReasonChip(field, chip) {
  const items = reasonItems(field);
  const wanted = reasonItems(chip);
  if (reasonChipSelected(field, chip)) {
    const drop = new Set(wanted.map((item) => item.toLowerCase()));
    return items.filter((item) => !drop.has(item.toLowerCase())).join(", ");
  }
  const have = new Set(items.map((item) => item.toLowerCase()));
  return [...items, ...wanted.filter((item) => !have.has(item.toLowerCase()))].join(", ");
}
