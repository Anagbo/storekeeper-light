import { cleanCreditReason } from "../lib/creditReason.js";

// Wiring 18 "Reason on 18" (16 Nov 2026): what the credit is for, in the draft (route params).
// Three cases:
//   field - a keypad sale on credit or the Owe part of a split (a cart holding only the "Other amount"
//           line counts as a keypad sale): the "What for?" field, kept as params.creditReason.
//   items - a sale with real items: the items, read-only.
//   note  - Add debt or + Add to debt: what was typed on 53, read-only ("" = no row).
const realItems = (params) => (Array.isArray(params.saleItems) ? params.saleItems : [])
  .filter((item) => item && item.productId !== null && typeof item.name === "string" && item.name.trim());

export function formatItemsReason(items) {
  return items.map((item) => (Number.isSafeInteger(item.quantity) && item.quantity > 1 ? `${item.name.trim()} × ${item.quantity}` : item.name.trim())).join(", ");
}

export function getCreditReasonCase(params = {}) {
  if (params.manualDebt) return { kind: "note", text: typeof params.note === "string" ? params.note.trim() : "" };
  const items = realItems(params);
  if (items.length) return { kind: "items", text: formatItemsReason(items) };
  return { kind: "field", text: cleanCreditReason(params.creditReason) };
}

// The reason a sale writer saves in creditReason: only the typed one (field case).
export function getSaleCreditReason(params = {}) {
  const reasonCase = getCreditReasonCase(params);
  return reasonCase.kind === "field" ? reasonCase.text : "";
}
