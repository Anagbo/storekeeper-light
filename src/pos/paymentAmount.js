export function getRemainingPaymentPesewas(params = {}) {
  const totalPesewas = getPaymentTotalPesewas(params);
  const parts = Array.isArray(params.splitParts) ? params.splitParts : [];
  const paidPesewas = parts.reduce((total, part) => {
    if (!Number.isSafeInteger(part?.amountPesewas) || part.amountPesewas < 0) {
      throw new TypeError("Payment parts must contain valid whole-pesewa amounts.");
    }
    return total + part.amountPesewas;
  }, 0);
  if (paidPesewas > totalPesewas) {
    throw new RangeError("Payment parts cannot exceed the payment total.");
  }
  return totalPesewas - paidPesewas;
}

export function getMomoAmountPesewas(params = {}) {
  const pendingAmount = params.pendingMomoAmountPesewas;
  if (!Number.isSafeInteger(pendingAmount) || pendingAmount <= 0) {
    return getRemainingPaymentPesewas(params);
  }
  const remainingPesewas = getRemainingPaymentPesewas({ ...params, pendingMomoAmountPesewas: undefined });
  if (pendingAmount > remainingPesewas) {
    throw new RangeError("The MoMo amount cannot exceed the remaining payment.");
  }
  return pendingAmount;
}

// What 19 sends to 61 when the merchant taps MoMo for the payment today (A3). That payment can
// be up to the customer's whole balance (old debt plus this sale), not only the sale, so the
// balance is the total the MoMo amount is checked against. Without it, a customer who owes
// GH₵50.00 and buys GH₵20.00 on credit paying GH₵60.00 today made 61 throw while rendering.
// With no valid amount today, nothing changes from before.
export function getMomoPickParams(params = {}, { todayPaymentPesewas, maxCreditPesewas } = {}) {
  const validAmount = Number.isSafeInteger(todayPaymentPesewas) && todayPaymentPesewas > 0;
  return {
    ...params,
    paymentMethod: "momo",
    pendingMomoAmountPesewas: todayPaymentPesewas,
    ...(validAmount && { splitTotalPesewas: Math.max(maxCreditPesewas ?? 0, todayPaymentPesewas) }),
    returnRoute: "ALittleAtATime",
    pickOnly: true
  };
}

export function getInitialPaymentParts(params = {}, totalPesewas) {
  const parts = Array.isArray(params.splitParts) ? params.splitParts : [];
  if (!params.momoMethod || !Number.isSafeInteger(params.pendingMomoAmountPesewas) || params.pendingMomoAmountPesewas <= 0) {
    return parts;
  }
  if (getRemainingPaymentPesewas({
    ...params,
    splitTotalPesewas: totalPesewas,
    pendingMomoAmountPesewas: undefined
  }) === 0) {
    return parts;
  }
  const nonMomoParts = parts.filter((part) => part.paymentMethod !== "momo");
  return [
    ...nonMomoParts,
    {
      paymentMethod: "momo",
      amountPesewas: getMomoAmountPesewas({ ...params, splitTotalPesewas: totalPesewas }),
      momoMethod: params.momoMethod,
      verification: params.verification
    }
  ];
}

export function getPaidPaymentPesewas(parts = []) {
  return parts.reduce((total, part) => {
    if (!Number.isSafeInteger(part?.amountPesewas) || part.amountPesewas < 0) {
      throw new TypeError("Payment parts must contain valid whole-pesewa amounts.");
    }
    return part.paymentMethod === "owe" ? total : total + part.amountPesewas;
  }, 0);
}

export function getCarriedPaymentParts(params = {}) {
  if (Array.isArray(params.initialPaymentParts)) return params.initialPaymentParts;
  if (Array.isArray(params.firstPaymentParts)) return params.firstPaymentParts;
  if (Array.isArray(params.splitParts)) return params.splitParts;
  return [];
}

function getPaymentTotalPesewas(params) {
  return Number.isSafeInteger(params.splitTotalPesewas)
    ? params.splitTotalPesewas
    : Number.isSafeInteger(params.amountPesewas)
      ? params.amountPesewas
      : 0;
}
