const CREDIT_EVENT_TYPES = new Set([
  "sale",
  "credit_sale",
  "installment_sale",
  "installment_addon"
]);

// Money paid at a credit sale (owner rule, 2026-11-10).
// recordCreditSale stores the whole sale as creditSaleGrossPesewas, the Owe part as
// creditExtendedPesewas, and one payment row per paid part linked to the sale
// (transactionId = the sale's id, no collectionId). Those rows are part of the sale, not
// debt payments: the sale's credit event is only the part left owing, and the linked rows
// are left out of payments. Rows are matched up to the amount paid at the sale; a sale
// with no matched rows keeps the older reading (gross credit, rows counted). Credit and
// payments drop by the same amount, so the ledger balance is the same number either way.
// The history, the ledger check, Correct balance and the consistency check all use this.
export function isGrossCreditSale(record) {
  return CREDIT_EVENT_TYPES.has(record?.type) &&
    Number.isSafeInteger(record.creditSaleGrossPesewas) &&
    Number.isSafeInteger(record.creditExtendedPesewas) &&
    record.creditExtendedPesewas >= 0 &&
    record.creditExtendedPesewas <= record.creditSaleGrossPesewas;
}

export function matchSaleTimePayments(transactions, payments) {
  const paidAtSale = new Map();
  for (const record of transactions) {
    if (isGrossCreditSale(record) && record.id) {
      paidAtSale.set(record.id, record.creditSaleGrossPesewas - record.creditExtendedPesewas);
    }
  }
  const matchedBySaleId = new Map();
  const paymentIds = new Set();
  for (const payment of payments) {
    if (!payment.id || payment.collectionId || !paidAtSale.has(payment.transactionId)) continue;
    const amount = payment.amountPesewas;
    if (!Number.isSafeInteger(amount) || amount <= 0) continue;
    const matched = matchedBySaleId.get(payment.transactionId) ?? 0;
    if (matched + amount > paidAtSale.get(payment.transactionId)) continue;
    matchedBySaleId.set(payment.transactionId, matched + amount);
    paymentIds.add(payment.id);
  }
  return { matchedBySaleId, paymentIds };
}

export function getCreditEventAmount(record, saleTimePayments = null) {
  if (record.type === "manual_debt") {
    return record.creditExtendedPesewas ?? record.amountPesewas ?? record.total_amount ?? 0;
  }
  if (!CREDIT_EVENT_TYPES.has(record.type)) return 0;
  if (isGrossCreditSale(record)) {
    return record.creditSaleGrossPesewas - (saleTimePayments?.matchedBySaleId.get(record.id) ?? 0);
  }

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

// Returns { balancePesewas, paidPesewas }: paidPesewas is the debt payments counted against
// the balance (sale-time rows and undone payments left out).
export function calculateLedgerEventBalance(transactions, payments) {
  const saleTimePayments = matchSaleTimePayments(transactions, payments);
  const creditTotal = transactions.reduce((total, record) => (
    total + getCreditEventAmount(record, saleTimePayments)
  ), 0);
  // Undo appends an income_reversal pointing at the payment's income transaction
  // and keeps the payment row (append-only), so a reversed payment no longer counts (D15).
  const reversedTransactionIds = new Set(transactions
    .filter((record) => record.type === "income_reversal" && record.reversalOfTransactionId)
    .map((record) => record.reversalOfTransactionId));
  const paymentTotal = payments.reduce((total, payment) => (
    reversedTransactionIds.has(payment.transactionId) || saleTimePayments.paymentIds.has(payment.id)
      ? total
      : total + (payment.amountPesewas ?? 0)
  ), 0);
  const adjustmentTotal = transactions
    .filter((record) => record.type === "debt_adjustment")
    .reduce((total, record) => total + (record.deltaPesewas ?? 0), 0);
  return { balancePesewas: creditTotal - paymentTotal + adjustmentTotal, paidPesewas: paymentTotal };
}

// Money paid against one debt (the plan card on 43): the customer's records, with only the
// payments linked to that debt, so a sale's own payment and undone payments stay out.
export function getPlanPaidPesewas(ledgerRecords, debtId) {
  if (!debtId) return 0;
  return calculateLedgerEventBalance(
    ledgerRecords.transactions,
    ledgerRecords.payments.filter((payment) => payment.debtId === debtId)
  ).paidPesewas;
}
