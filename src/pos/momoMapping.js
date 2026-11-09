export const MOMO_METHODS = Object.freeze({
  direct: "direct",
  paystack: "paystack"
});

export const MOMO_VERIFICATION = Object.freeze({
  merchantConfirmed: "merchant_confirmed",
  verified: "verified"
});

export function normalizeMomoDetails({ momoMethod, verification, reference = "" } = {}) {
  if (!Object.values(MOMO_METHODS).includes(momoMethod)) throw new TypeError("A valid MoMo method is required.");
  if (!Object.values(MOMO_VERIFICATION).includes(verification)) throw new TypeError("A valid MoMo verification state is required.");
  return { momoMethod, verification, reference: typeof reference === "string" ? reference.trim() : "" };
}

// One verification value for a record holding MoMo money. "verified" only when every
// MoMo part is verified and carries a Paystack reference; anything else, including a
// missing value, is merchant_confirmed. Returns "" when there is no MoMo part.
export function getMomoVerification(parts) {
  const momoParts = (Array.isArray(parts) ? parts : []).filter((part) => part?.paymentMethod === "momo");
  if (momoParts.length === 0) return "";
  const allVerified = momoParts.every((part) =>
    part.verification === MOMO_VERIFICATION.verified &&
    typeof part.reference === "string" && part.reference.trim() !== ""
  );
  return allVerified ? MOMO_VERIFICATION.verified : MOMO_VERIFICATION.merchantConfirmed;
}

// What the merchant confirmed on 62 for the MoMo part(s) of a save (confirmedPesewas on the part, the
// saved amount when the part carries none). A part cannot be saved for more than was confirmed:
// raising a confirmed amount goes back to 62 (brief 3.8 rule 2). Returns `fallbackPesewas` when
// there is no MoMo part.
export function getMomoConfirmedPesewas(parts, fallbackPesewas = 0) {
  const momoParts = (Array.isArray(parts) ? parts : []).filter((part) => part?.paymentMethod === "momo");
  if (momoParts.length === 0) return fallbackPesewas;
  return momoParts.reduce((total, part) => {
    const confirmedPesewas = part.confirmedPesewas ?? part.amountPesewas;
    if (!Number.isSafeInteger(confirmedPesewas) || confirmedPesewas < 0 || confirmedPesewas < part.amountPesewas) {
      throw new TypeError("A MoMo payment cannot be saved for more than the amount confirmed.");
    }
    return total + confirmedPesewas;
  }, 0);
}

// Fields stored on every record holding MoMo money. momoMethod follows the
// verification: "paystack" only for a verified part (reserved until the backend
// exists), otherwise "direct" (customer sent to the merchant's number).
// momoConfirmedPesewas is the amount confirmed on 62 for the MoMo part of the save, next to the
// saved MoMo amount on the same record: they differ when the amount was lowered after confirming.
export function getMomoDetails(momoVerification, confirmedPesewas) {
  return {
    momoMethod: momoVerification === MOMO_VERIFICATION.verified ? MOMO_METHODS.paystack : MOMO_METHODS.direct,
    momoVerification,
    ...(Number.isSafeInteger(confirmedPesewas) && confirmedPesewas >= 0 ? { momoConfirmedPesewas: confirmedPesewas } : {})
  };
}

// Label for the MoMo line on screens 30 and 28 and on receipts. Records saved before
// verification was stored keep the plain label, never "verified".
export function getMomoDisplayLabel(record) {
  if (record?.momoVerification === MOMO_VERIFICATION.verified) return "MoMo · verified";
  if (record?.momoVerification === MOMO_VERIFICATION.merchantConfirmed) return "MoMo · you confirmed";
  return "MoMo";
}

export function getMomoReceiptLabel({ momoMethod, verification }) {
  normalizeMomoDetails({ momoMethod, verification });
  return verification === MOMO_VERIFICATION.verified ? "MoMo · verified" : "MoMo · you confirmed";
}
