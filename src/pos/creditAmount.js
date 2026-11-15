export function getCreditAmountOwedPesewas(params = {}) {
  const saleAmountPesewas = Number.isSafeInteger(params.amountPesewas) && params.amountPesewas >= 0
    ? params.amountPesewas
    : 0;
  const initialPaymentPesewas = Number.isSafeInteger(params.initialPaymentPesewas) && params.initialPaymentPesewas >= 0
    ? params.initialPaymentPesewas
    : 0;
  return Math.max(0, saleAmountPesewas - initialPaymentPesewas);
}
