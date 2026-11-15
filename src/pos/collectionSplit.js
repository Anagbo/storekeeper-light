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
