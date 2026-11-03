import { getTransactionTimestamp } from "./money.js";

const SALE_TYPES = new Set(["sale", "cash_sale", "credit_sale", "installment_sale", "installment_addon"]);

function getAmount(transaction) {
  const amount = transaction.amountPesewas ?? transaction.total_amount;
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError(`Transaction ${transaction.id ?? "(unknown)"} has an invalid pesewa amount.`);
  }
  return amount;
}

function getOptionalAmount(value, fallback, description) {
  const amount = value ?? fallback;
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError(`${description} must be a non-negative integer number of pesewas.`);
  }
  return amount;
}

function isDebtPayment(transaction) {
  return transaction.type === "debt_payment" ||
    (transaction.type === "income" && transaction.note?.startsWith("Debt payment"));
}

function getPaymentMethod(transaction) {
  const method = transaction.payment_method ?? transaction.paymentType;
  return method === "momo" || method === "telecel_cash" ? "momo" : "cash";
}

export function createPosTransactionRows(transactions) {
  const reversedTransactionIds = new Set(
    transactions
      .filter((transaction) => transaction.type === "income_reversal")
      .map((transaction) => transaction.reversalOfTransactionId)
      .filter(Boolean)
  );
  const reversedCollectionIds = new Set(
    transactions
      .filter((transaction) => transaction.type === "income_reversal")
      .map((transaction) => transaction.reversalOfCollectionId)
      .filter(Boolean)
  );
  const rows = transactions.filter((transaction) => (
    transaction.type !== "income_reversal" &&
    !reversedTransactionIds.has(transaction.id) &&
    !reversedCollectionIds.has(transaction.collectionId)
  )).map((transaction) => {
    const amountPesewas = getAmount(transaction);
    const timestamp = getTransactionTimestamp(transaction);
    const isExpense = transaction.type === "expense" || transaction.type === "supplier_payment";
    const isSale = SALE_TYPES.has(transaction.type);
    const isCreditSale = transaction.type === "credit_sale" ||
      (transaction.type === "sale" && transaction.paymentType === "credit");
    const isInstallmentSale = transaction.type === "installment_sale" || transaction.type === "installment_addon";
    const isPayment = isDebtPayment(transaction);
    const paymentMethod = getPaymentMethod(transaction);
    const paidExpensePesewas = isExpense
      ? getOptionalAmount(transaction.paidAmountPesewas, amountPesewas, "Expense payment")
      : 0;
    const owedExpensePesewas = isExpense
      ? getOptionalAmount(
          transaction.owedAmountPesewas,
          Math.max(0, amountPesewas - (transaction.paidAmountPesewas ?? amountPesewas)),
          "Expense payable"
        )
      : 0;
    const legacyInstallmentPaymentPesewas = getOptionalAmount(
      transaction.installmentPaymentPesewas,
      0,
      "Installment payment"
    );
    const cashReceivedPesewas = isInstallmentSale
      ? getOptionalAmount(
          transaction.cashReceivedPesewas,
          paymentMethod === "momo" ? 0 : legacyInstallmentPaymentPesewas,
          "Installment cash payment"
        ) + getOptionalAmount(
          transaction.momoReceivedPesewas,
          paymentMethod === "momo" ? legacyInstallmentPaymentPesewas : 0,
          "Installment MoMo payment"
        )
      : isCreditSale
        ? getOptionalAmount(transaction.cashReceivedPesewas, 0, "Credit sale payment")
        : isSale || isPayment
          ? amountPesewas
          : 0;
    const cashPesewas = isInstallmentSale
      ? getOptionalAmount(
          transaction.cashReceivedPesewas,
          paymentMethod === "momo" ? 0 : legacyInstallmentPaymentPesewas,
          "Installment cash payment"
        )
      : (isSale || isPayment) && paymentMethod === "cash" ? cashReceivedPesewas : 0;
    const momoPesewas = isInstallmentSale
      ? getOptionalAmount(
          transaction.momoReceivedPesewas,
          paymentMethod === "momo" ? legacyInstallmentPaymentPesewas : 0,
          "Installment MoMo payment"
        )
      : (isSale || isPayment) && paymentMethod === "momo" ? cashReceivedPesewas : 0;
    const owedPesewas = isInstallmentSale || isCreditSale
      ? getOptionalAmount(transaction.creditExtendedPesewas, amountPesewas - cashReceivedPesewas, "Credit extended")
      : 0;
    const customerName = (transaction.customer_name ?? transaction.customerName ?? "").trim();

    return {
      id: transaction.id,
      timestamp,
      kind: isExpense
        ? paidExpensePesewas > 0 || owedExpensePesewas === 0 ? "spent" : "credit"
        : isPayment ? "payment" : isSale ? "sold" : "other",
      isSale,
      isCredit: owedPesewas > 0 || owedExpensePesewas > 0,
      amountPesewas: isExpense
        ? paidExpensePesewas > 0 ? paidExpensePesewas : owedExpensePesewas
        : isCreditSale && cashReceivedPesewas === 0
          ? owedPesewas
          : amountPesewas,
      cashReceivedPesewas,
      owedPesewas: owedPesewas + owedExpensePesewas,
      paymentMethod,
      collectionId: transaction.collectionId,
      cashPesewas: isPayment || isSale ? cashPesewas : 0,
      momoPesewas: isPayment || isSale ? momoPesewas : 0,
      customerName,
      category: transaction.category ?? transaction.expenseCategory ?? transaction.note ?? ""
    };
  });
  const groupedRows = [];
  const collectionRows = new Map();
  for (const row of rows) {
    if (row.kind !== "payment" || !row.collectionId) {
      groupedRows.push(row);
      continue;
    }
    const existing = collectionRows.get(row.collectionId);
    if (!existing) {
      collectionRows.set(row.collectionId, row);
      groupedRows.push(row);
      continue;
    }
    existing.amountPesewas += row.amountPesewas;
    existing.cashReceivedPesewas += row.cashReceivedPesewas;
    existing.cashPesewas += row.cashPesewas;
    existing.momoPesewas += row.momoPesewas;
    if (!Number.isSafeInteger(existing.amountPesewas) || !Number.isSafeInteger(existing.cashReceivedPesewas)) {
      throw new RangeError("A collection total exceeds the safe integer range.");
    }
  }
  return groupedRows.sort((left, right) => right.timestamp - left.timestamp);
}

export function filterPosTransactionRows(rows, filter) {
  if (filter === "sold") return rows.filter((row) => row.isSale);
  if (filter === "spent") return rows.filter((row) => row.kind === "spent");
  if (filter === "credit") return rows.filter((row) => row.isCredit);
  if (filter !== "all") throw new TypeError(`Unknown transaction filter: ${filter}`);
  return rows;
}
