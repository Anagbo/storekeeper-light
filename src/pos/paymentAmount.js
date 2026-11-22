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
    pickOnly: true,
    // MOMO16 on 19: Direct returns to 19 not confirmed yet; 62 opens at Save plan.
    confirmAtDone: true
  };
}

// Merges a finished MoMo pick (61/62) into the split parts of 16 and 27 (brief 3.8 rule 2: one row
// per mode). A first MoMo pick adds the row; a later one grows the existing row by the picked amount
// instead of replacing it. `confirmedPesewas` is what 62 has confirmed so far for the row. A pick
// that cannot be combined (a different MoMo method, or more than the total) is ignored.
export function applyMomoPick(details = {}) {
  const parts = Array.isArray(details.splitParts) ? details.splitParts : [];
  const pending = details.pendingMomoAmountPesewas;
  if (!details.momoMethod || !Number.isSafeInteger(pending) || pending <= 0) return parts;
  const existing = parts.find((part) => part?.paymentMethod === "momo");
  const otherPaid = parts.reduce((total, part) => (part === existing ? total : total + part.amountPesewas), 0);
  const total = getPaymentTotalPesewas(details);
  // A Direct pick on 16 comes back with no verification: not confirmed yet (MOMO16 confirms it on 62
  // after Done), so it carries no confirmed amount either.
  const confirmed = Boolean(details.verification);
  if (existing) {
    if (existing.momoMethod !== details.momoMethod || existing.verification !== details.verification) return parts;
    // A raise above the confirmed amount names the row's new total; a plain second tap adds the pick.
    const amountPesewas = Number.isSafeInteger(details.momoRowAmountPesewas) && details.momoRowAmountPesewas > 0
      ? details.momoRowAmountPesewas
      : existing.amountPesewas + pending;
    if (otherPaid + amountPesewas > total) return parts;
    return parts.map((part) => (part === existing
      ? { ...part, amountPesewas, ...(confirmed ? { confirmedPesewas: (part.confirmedPesewas ?? part.amountPesewas) + pending } : {}) }
      : part));
  }
  if (otherPaid + pending > total) return parts;
  return [...parts, {
    paymentMethod: "momo",
    amountPesewas: pending,
    momoMethod: details.momoMethod,
    ...(confirmed ? { verification: details.verification } : {}),
    ...(typeof details.reference === "string" && details.reference ? { reference: details.reference } : {}),
    ...(confirmed ? { confirmedPesewas: pending } : {})
  }];
}

// The parts a split screen (16, 27, 26) opens with. Called while rendering, so it never throws: a
// screen that cannot load loses the owner's draft. Parts with an invalid amount are dropped, parts
// that add up to more than the total (kept from an earlier amount) are dropped, and a picked MoMo
// amount is clamped to what is left after the other parts. The checks that throw stay in
// getMomoAmountPesewas and getRemainingPaymentPesewas for the save path.
export function getInitialPaymentParts(params = {}, totalPesewas) {
  const total = Number.isSafeInteger(totalPesewas) && totalPesewas >= 0 ? totalPesewas : getPaymentTotalPesewas(params);
  const rawParts = Array.isArray(params.splitParts) ? params.splitParts : [];
  const validParts = rawParts.filter((part) => Number.isSafeInteger(part?.amountPesewas) && part.amountPesewas >= 0);
  const parts = sumOf(validParts) > total ? [] : validParts;
  const pending = params.pendingMomoAmountPesewas;
  if (!params.momoMethod || !Number.isSafeInteger(pending) || pending <= 0) return parts;
  if (sumOf(parts) === total) return parts;
  const nonMomoParts = parts.filter((part) => part.paymentMethod !== "momo");
  const momoPesewas = Math.min(pending, total - sumOf(nonMomoParts));
  if (momoPesewas <= 0) return nonMomoParts;
  return [
    ...nonMomoParts,
    {
      paymentMethod: "momo",
      amountPesewas: momoPesewas,
      momoMethod: params.momoMethod,
      verification: params.verification
    }
  ];
}

function sumOf(parts) {
  return parts.reduce((total, part) => total + part.amountPesewas, 0);
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

// Wiring 25 "Zero amount": the typed collect amount is 0.00 (or not a valid amount) in whole pesewas.
export const isZeroAmount = (pesewas) => !Number.isSafeInteger(pesewas) || pesewas <= 0;
