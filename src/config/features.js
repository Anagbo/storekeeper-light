export const FEATURE_FLAGS = {
  SHOW_SUBSCRIPTION_FEATURE: import.meta.env?.VITE_ENABLE_SUBSCRIPTION === "true",
  // One flag for every POS receipt template (sale, split credit, collection).
  SHOW_POS_RECEIPTS: import.meta.env?.VITE_ENABLE_POS_RECEIPTS === "true",
  // Paystack phone request (sales and plan). Off until a backend creates and confirms charges.
  ENABLE_MOMO_PHONE_REQUEST: import.meta.env?.VITE_ENABLE_MOMO_PHONE_REQUEST === "true"
};

// rules_global.customer_proof.threshold: a credit event of this many pesewas or more opens 72 (Please
// sign) after it is saved. Read only here. A missing or invalid value (anything but a positive whole
// number written with digits only) uses the default, GH₵50.00.
export const DEFAULT_SIGNATURE_THRESHOLD_PESEWAS = 5000;

export function parseSignatureThreshold(raw) {
  if (typeof raw !== "string") return DEFAULT_SIGNATURE_THRESHOLD_PESEWAS;
  const text = raw.trim();
  if (!/^[1-9]\d*$/.test(text)) return DEFAULT_SIGNATURE_THRESHOLD_PESEWAS;
  // The text is digits only, so JSON.parse reads it exactly (a setting, not a typed amount).
  const limit = JSON.parse(text);
  return Number.isSafeInteger(limit) ? limit : DEFAULT_SIGNATURE_THRESHOLD_PESEWAS;
}

export const SIGNATURE_THRESHOLD_PESEWAS = parseSignatureThreshold(import.meta.env?.VITE_SIGNATURE_THRESHOLD_PESEWAS);

// The amount of ONE credit event (the Owe part of a sale, the amount added for a manual debt); an
// older balance is never counted. Exactly the threshold asks.
export function needsSignature(amountPesewas, thresholdPesewas = SIGNATURE_THRESHOLD_PESEWAS) {
  return Number.isSafeInteger(amountPesewas) && amountPesewas > 0 && amountPesewas >= thresholdPesewas;
}
