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

export function getMomoReceiptLabel({ momoMethod, verification }) {
  normalizeMomoDetails({ momoMethod, verification });
  return verification === MOMO_VERIFICATION.verified ? "MoMo · verified" : "MoMo · you confirmed";
}
