import { normalizeTypedAmount } from "./amountKeypad.js";

export function getDefaultCollectionSplit(targetAmountPesewas, cashAmountPesewas) {
  if (!Number.isSafeInteger(targetAmountPesewas) || targetAmountPesewas <= 1) {
    throw new TypeError("The collection target must be at least two pesewas.");
  }
  if (!Number.isSafeInteger(cashAmountPesewas) || cashAmountPesewas <= 0 || cashAmountPesewas >= targetAmountPesewas) {
    return [];
  }
  return [
    { paymentMethod: "cash", amountPesewas: cashAmountPesewas },
    { paymentMethod: "momo", amountPesewas: targetAmountPesewas - cashAmountPesewas }
  ];
}

// The typed field on 26 follows the same rules as the shared keypad (wiring rules_global.amount_entry).
export function normalizeCollectionAmountInput(value, current = "") {
  return normalizeTypedAmount(value, current);
}
