// Errors the plan and debt writers throw for causes the merchant can fix, with a code the screen
// maps to a message that names what is wrong (19, CreditScreens.jsx). The text stays the same as
// before; the code is added. No imports.
export const PLAN_ERROR = Object.freeze({
  // "How much each time" is more than the debt the plan is saved on.
  eachTimeTooHigh: "each_time_too_high",
  // The payment today is more than the customer can owe after this sale or debt (maximumPesewas).
  paymentTooHigh: "payment_too_high",
  // The customer's debt is not what the screen was told (changed, or not found).
  debtChanged: "debt_changed",
  // The cash and MoMo parts of the payment today do not add up to the payment amount.
  paymentPartsMismatch: "payment_parts_mismatch"
});

export function planError(code, message, details = {}) {
  const error = new TypeError(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}