import { db } from "../db/db.js";
import {
  getDebtAdjustmentReasonLabel,
  getHistoryCreditAmount,
  getHistoryTimestampValue,
  summarizeCustomerHistory
} from "./customerDebtHistory.js";

function getTransactionTimestamp(transaction) {
  return transaction.createdAt ?? transaction.timestamp ?? 0;
}

export async function loadCustomerHistory(customerId, customerName) {
  const normalizedName = customerName.trim().toLowerCase();
  const [indexedDebts, indexedPayments, indexedTransactions, allDebts, allPayments, allTransactions] = await Promise.all([
    customerId ? db.debts.where("customerId").equals(customerId).toArray() : [],
    customerId ? db.payments.where("customerId").equals(customerId).toArray() : [],
    customerId ? db.transactions.where("customerId").equals(customerId).toArray() : [],
    db.debts.toArray(),
    db.payments.toArray(),
    db.transactions.toArray()
  ]);

  const debts = new Map(indexedDebts.map((debt) => [debt.id, debt]));
  for (const debt of allDebts) {
    if ((debt.customer_name ?? debt.customerName ?? "").trim().toLowerCase() === normalizedName) {
      debts.set(debt.id, debt);
    }
  }
  const debtIds = new Set(debts.keys());
  const payments = new Map(indexedPayments.map((payment) => [payment.id, payment]));
  for (const payment of allPayments) {
    if (
      payment.customerId === customerId ||
      debtIds.has(payment.debtId) ||
      (payment.customer_name ?? "").trim().toLowerCase() === normalizedName
    ) payments.set(payment.id, payment);
  }
  const transactions = new Map(indexedTransactions.map((transaction) => [transaction.id, transaction]));
  const referencedTransactionIds = new Set([
    ...[...debts.values()].map((debt) => debt.transactionId),
    ...[...payments.values()].flatMap((payment) => [payment.transactionId, payment.id])
  ].filter(Boolean));
  const paymentIds = new Set([...payments.values()].map((payment) => payment.id));
  for (const transaction of allTransactions) {
    const name = transaction.customer_name ?? transaction.customerName ?? "";
    if (
      transaction.customerId === customerId ||
      name.trim().toLowerCase() === normalizedName ||
      referencedTransactionIds.has(transaction.id) ||
      paymentIds.has(transaction.paymentId)
    ) {
      transactions.set(transaction.id, transaction);
    }
  }

  const events = [];
  const reversedTransactionIds = new Set(
    [...transactions.values()]
      .filter((transaction) => transaction.type === "income_reversal")
      .map((transaction) => transaction.reversalOfTransactionId)
      .filter(Boolean)
  );
  const paymentTransactionIds = new Set();
  for (const payment of payments.values()) {
    if (payment.transactionId) paymentTransactionIds.add(payment.transactionId);
    const paymentTransaction = payment.transactionId ? transactions.get(payment.transactionId) : null;
    if (payment.transactionId && reversedTransactionIds.has(payment.transactionId)) continue;
    const paymentMethod = payment.paymentMethod === "momo" || paymentTransaction?.payment_method === "momo" ? "MoMo" : "Cash";
    events.push({
      id: `payment-${payment.id}`,
      type: "payment",
      timestamp: payment.createdAt ?? payment.timestamp ?? 0,
      amountPesewas: payment.amountPesewas,
      method: paymentMethod,
      collectionId: payment.collectionId,
      detail: `${paymentMethod}${payment.note?.trim() ? ` · ${payment.note.trim()}` : paymentTransaction?.note ? ` · ${paymentTransaction.note}` : ""}`
    });
  }

  for (const transaction of transactions.values()) {
    if (transaction.type === "income_reversal" || reversedTransactionIds.has(transaction.id)) continue;
    const timestamp = getTransactionTimestamp(transaction);
    if (transaction.type === "manual_debt") {
      const creditAmount = getHistoryCreditAmount(transaction);
      if (creditAmount > 0) {
        events.push({
          id: `manual-debt-${transaction.id}`,
          type: "manual_debt",
          timestamp,
          amountPesewas: creditAmount,
          detail: "Added to debt",
          note: transaction.note?.trim() || ""
        });
      }
      continue;
    }
    if (transaction.type === "debt_adjustment") {
      const deltaPesewas = transaction.deltaPesewas;
      if (Number.isSafeInteger(deltaPesewas) && deltaPesewas !== 0) {
        events.push({
          id: `adjustment-${transaction.id}`,
          type: "adjustment",
          timestamp,
          amountPesewas: Math.abs(deltaPesewas),
          deltaPesewas,
          previousBalancePesewas: transaction.previousBalancePesewas,
          newBalancePesewas: transaction.newBalancePesewas,
          reasonCode: transaction.reasonCode,
          reasonNote: transaction.reasonNote?.trim() || "",
          reasonLabel: getDebtAdjustmentReasonLabel(transaction.reasonCode),
          detail: transaction.reasonNote?.trim() || getDebtAdjustmentReasonLabel(transaction.reasonCode)
        });
      }
      continue;
    }
    if (transaction.type === "installment_sale" || transaction.type === "installment_addon") {
      const creditAmount = getHistoryCreditAmount(transaction);
      if (creditAmount > 0) {
        events.push({
          id: `credit-${transaction.id}`,
          type: transaction.type === "installment_addon" ? "addon" : "credit",
          timestamp,
          amountPesewas: creditAmount,
          detail: transaction.itemDescription?.trim() ||
            transaction.note?.split(" · ")[0]?.trim() ||
            (transaction.type === "installment_addon" ? "Debt add-on" : "Credit extended")
        });
      }

      const depositAmount = transaction.installmentPaymentPesewas ?? 0;
      const depositRecorded = [...payments.values()].some((payment) => (
        payment.transactionId === transaction.id ||
        (payment.amountPesewas === depositAmount &&
          getHistoryTimestampValue(payment.createdAt ?? payment.timestamp) === getHistoryTimestampValue(timestamp))
      ));
      if (depositAmount > 0 && !depositRecorded) {
        events.push({
          id: `deposit-${transaction.id}`,
          type: "payment",
          timestamp,
          amountPesewas: depositAmount,
          method: transaction.payment_method === "momo" ? "MoMo" : "Cash",
          detail: transaction.payment_method === "momo" ? "MoMo initial installment" : "Cash initial installment"
        });
      }
      continue;
    }

    if (["sale", "credit_sale"].includes(transaction.type) && transaction.paymentType === "credit") {
      const creditAmount = getHistoryCreditAmount(transaction);
      if (creditAmount > 0) {
        events.push({
          id: `credit-${transaction.id}`,
          type: "credit",
          timestamp,
          amountPesewas: creditAmount,
          detail: transaction.itemDescription?.trim() || transaction.note?.split(" · ")[0]?.trim() || "Credit extended"
        });
      }
      continue;
    }

    if (["income", "debt_payment"].includes(transaction.type) && !paymentTransactionIds.has(transaction.id)) {
      const amount = transaction.amountPesewas ?? transaction.total_amount ?? 0;
      const duplicatePayment = [...payments.values()].some((payment) => (
        payment.amountPesewas === amount &&
        getHistoryTimestampValue(payment.createdAt ?? payment.timestamp) === getHistoryTimestampValue(timestamp)
      ));
      if (Number.isSafeInteger(amount) && amount > 0 && !duplicatePayment) {
        events.push({
          id: `legacy-payment-${transaction.id}`,
          type: "payment",
          timestamp,
          amountPesewas: amount,
          method: transaction.payment_method === "momo" ? "MoMo" : "Cash",
          detail: `${transaction.payment_method === "momo" ? "MoMo" : "Cash"}${transaction.note ? ` · ${transaction.note}` : ""}`
        });
      }
    }
  }

  const currentBalancePesewas = [...debts.values()].reduce((sum, debt) => (
    debt.status === "unpaid" ? sum + (debt.amountPesewas ?? debt.total_owed ?? 0) : sum
  ), 0);
  return summarizeCustomerHistory(events, currentBalancePesewas);
}
