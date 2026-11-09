function timestampValue(timestamp) {
  const value = timestamp instanceof Date
    ? timestamp.getTime()
    : typeof timestamp === "string" ? Date.parse(timestamp) : timestamp;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function formatHistoryTimestamp(timestamp) {
  const value = timestampValue(timestamp);
  if (!value) return { date: "Unknown date", time: "Unknown time" };

  return {
    date: new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric"
    }).format(value),
    time: new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    }).format(value).toLowerCase()
  };
}

export function sortHistoryEvents(events) {
  return events.sort((left, right) => timestampValue(right.timestamp) - timestampValue(left.timestamp));
}

export function getHistoryTimestampValue(timestamp) {
  return timestampValue(timestamp);
}

export function getDebtAdjustmentReasonLabel(reasonCode) {
  return {
    wrong_amount: "Wrong amount entered",
    customer_dispute: "Customer dispute",
    returned_goods: "Goods returned",
    debt_forgiven: "Debt forgiven",
    other: "Other"
  }[reasonCode] ?? "Correction";
}

export function getHistoryCreditAmount(transaction) {
  const amount = transaction.creditSaleGrossPesewas ??
    transaction.creditExtendedPesewas ??
    (transaction.type === "installment_sale" || transaction.type === "installment_addon"
      ? (transaction.amountPesewas ?? transaction.total_amount ?? 0) - (transaction.installmentPaymentPesewas ?? 0)
      : transaction.amountPesewas ?? transaction.total_amount ?? 0);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : 0;
}

export function summarizeCustomerHistory(events, currentBalancePesewas) {
  const totalCreditPesewas = events.reduce((sum, event) => (
    ["credit", "addon", "manual_debt"].includes(event.type)
      ? sum + event.amountPesewas
      : event.type === "adjustment" ? sum + event.deltaPesewas : sum
  ), 0);
  const totalPaidPesewas = events.reduce((sum, event) => (
    event.type === "payment" ? sum + event.amountPesewas : sum
  ), 0);

  return {
    events: sortHistoryEvents([...events]),
    totalCreditPesewas,
    totalPaidPesewas,
    currentBalancePesewas,
    unaccountedCreditPesewas: currentBalancePesewas + totalPaidPesewas - totalCreditPesewas
  };
}
