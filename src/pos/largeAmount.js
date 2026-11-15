// Brief 3.12 / wiring global rule large_amount_confirm: a sale above the limit asks before it is saved.
// The limit is whole pesewas from VITE_LARGE_AMOUNT_CONFIRM_PESEWAS. A missing or invalid value
// (anything but a positive whole number, digits only) uses the default, GH₵1,000.00.
export const DEFAULT_LARGE_AMOUNT_CONFIRM_PESEWAS = 100000;

export function parseLargeAmountLimit(raw) {
  if (typeof raw !== "string") return DEFAULT_LARGE_AMOUNT_CONFIRM_PESEWAS;
  const text = raw.trim();
  if (!/^[1-9]\d*$/.test(text)) return DEFAULT_LARGE_AMOUNT_CONFIRM_PESEWAS;
  // The text is digits only, so JSON.parse reads it exactly (this is a setting, not a typed amount).
  const limit = JSON.parse(text);
  return Number.isSafeInteger(limit) ? limit : DEFAULT_LARGE_AMOUNT_CONFIRM_PESEWAS;
}

export function getLargeAmountLimitPesewas() {
  return parseLargeAmountLimit(import.meta.env?.VITE_LARGE_AMOUNT_CONFIRM_PESEWAS);
}

// Exactly the limit does not ask; one pesewa above does.
export function isLargeAmount(totalPesewas, limitPesewas = getLargeAmountLimitPesewas()) {
  return Number.isSafeInteger(totalPesewas) && totalPesewas > limitPesewas;
}
