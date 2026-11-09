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
