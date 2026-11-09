const CREDIT_EVENT_TYPES = new Set([
  "sale",
  "credit_sale",
  "installment_sale",
  "installment_addon"
]);

export function getCreditEventAmount(record) {
  if (record.type === "manual_debt") {
    return record.creditExtendedPesewas ?? record.amountPesewas ?? record.total_amount ?? 0;
  }
  if (!CREDIT_EVENT_TYPES.has(record.type)) return 0;

  return record.creditSaleGrossPesewas ?? record.creditExtendedPesewas ?? Math.max(
    0,
    (record.amountPesewas ?? record.total_amount ?? 0) -
      (record.cashReceivedPesewas ?? 0) -
      (record.momoReceivedPesewas ?? 0)
  );
}

function customerNameOf(record) {
  return (record?.customerName ?? record?.customer_name ?? "").trim().toLowerCase();
}

export function getCustomerLedgerRecords({
  customerId,
  customerName,
  debts,
  transactions,
  payments
}) {
  const normalizedName = customerName.trim().toLowerCase();
  const debtIds = new Set(debts
    .filter((debt) => (
      (customerId && debt.customerId === customerId) ||
      customerNameOf(debt) === normalizedName
    ))
    .map((debt) => debt.id));
  const matchesCustomer = (record) => (
    (customerId && record.customerId === customerId) ||
    debtIds.has(record.debtId) ||
    customerNameOf(record) === normalizedName
  );

  return {
    transactions: transactions.filter(matchesCustomer),
    payments: payments.filter(matchesCustomer)
  };
}

export function calculateLedgerEventBalance(transactions, payments) {
  const creditTotal = transactions.reduce((total, record) => (
    total + getCreditEventAmount(record)
  ), 0);
  // Undo appends an income_reversal pointing at the payment's income transaction
  // and keeps the payment row (append-only), so a reversed payment no longer counts (D15).
  const reversedTransactionIds = new Set(transactions
    .filter((record) => record.type === "income_reversal" && record.reversalOfTransactionId)
    .map((record) => record.reversalOfTransactionId));
  const paymentTotal = payments.reduce((total, payment) => (
    reversedTransactionIds.has(payment.transactionId) ? total : total + (payment.amountPesewas ?? 0)
  ), 0);
  const adjustmentTotal = transactions
    .filter((record) => record.type === "debt_adjustment")
    .reduce((total, record) => total + (record.deltaPesewas ?? 0), 0);
  return creditTotal - paymentTotal + adjustmentTotal;
}
