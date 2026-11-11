import { displayName } from "../lib/displayName.js";
import { formatGhs } from "../lib/money.js";
import { posText as t } from "./i18n.js";
import { getTransactionTimestamp } from "./money.js";

const SALE_TYPES = new Set(["sale", "cash_sale", "credit_sale", "installment_sale", "installment_addon"]);

function getAmount(transaction) {
  const amount = transaction.type === "manual_debt"
    ? transaction.creditExtendedPesewas ?? transaction.amountPesewas ?? transaction.total_amount
    : transaction.amountPesewas ?? transaction.total_amount;
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
    const isAdjustment = transaction.type === "debt_adjustment";
    const isDebtAdded = transaction.type === "manual_debt";
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
    // A plain sale paid with Cash and MoMo is stored with both parts (payment_method "split"):
    // the chips show each part, not the whole sale as Cash.
    const storedPlainSaleParts = isSale && !isCreditSale && !isInstallmentSale &&
      Number.isSafeInteger(transaction.cashReceivedPesewas) && Number.isSafeInteger(transaction.momoReceivedPesewas) &&
      transaction.cashReceivedPesewas >= 0 && transaction.momoReceivedPesewas >= 0 &&
      transaction.cashReceivedPesewas + transaction.momoReceivedPesewas === amountPesewas
      ? { cash: transaction.cashReceivedPesewas, momo: transaction.momoReceivedPesewas }
      : null;
    const cashPesewas = storedPlainSaleParts ? storedPlainSaleParts.cash : isInstallmentSale
      ? getOptionalAmount(
          transaction.cashReceivedPesewas,
          paymentMethod === "momo" ? 0 : legacyInstallmentPaymentPesewas,
          "Installment cash payment"
        )
      : (isSale || isPayment) && paymentMethod === "cash" ? cashReceivedPesewas : 0;
    const momoPesewas = storedPlainSaleParts ? storedPlainSaleParts.momo : isInstallmentSale
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
      : isPayment ? "payment" : isSale ? "sold" : isAdjustment ? "adjustment" : isDebtAdded ? "debt_added" : "other",
      isSale,
      isCredit: isDebtAdded || owedPesewas > 0 || owedExpensePesewas > 0,
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
      category: transaction.category ?? transaction.expenseCategory ?? transaction.note ?? "",
      adjustmentDeltaPesewas: isAdjustment ? transaction.deltaPesewas : 0
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

// 24 (redesign 11 Nov 2026): what one row shows. Money in is money actually received today, so a
// sale's amount is what was received (+); the owed part is a pink person chip. A credit-only sale
// shows its amount with no sign (nothing was received). The sum of the "+" amounts equals Money in.
//   tone: "in" (green, +), "spent" (amber-brown, −), "credit" (dark red, no sign), "neutral".
//   chips: { kind: "payment" | "person" | "category" | "credit", label }
export function describeTransactionRow(row) {
  const name = displayName(row.customerName);
  const person = (label) => ({ kind: "person", label });
  const paymentChips = () => [
    ...(row.cashPesewas > 0 ? [{ kind: "payment", label: `${t("transactions.tag.cash")} ${formatGhs(row.cashPesewas)}` }] : []),
    ...(row.momoPesewas > 0 ? [{ kind: "payment", label: `${t("transactions.tag.momo")} ${formatGhs(row.momoPesewas)}` }] : [])
  ];
  if (row.kind === "sold") {
    const received = row.cashReceivedPesewas;
    if (row.owedPesewas > 0 && received === 0) {
      return { title: t("transactions.row.soldOnCredit"), amountPesewas: row.owedPesewas, tone: "credit", chips: name ? [person(name)] : [] };
    }
    if (row.owedPesewas > 0) {
      return {
        title: t("transactions.row.saleOf", { amount: formatGhs(received + row.owedPesewas) }),
        amountPesewas: received,
        tone: "in",
        chips: [...paymentChips(), person(t("transactions.row.owes", { name: name || t("home.unnamedCustomer"), amount: formatGhs(row.owedPesewas) }))]
      };
    }
    return { title: t("transactions.row.sale"), amountPesewas: received, tone: "in", chips: paymentChips() };
  }
  if (row.kind === "payment") {
    return { title: t("transactions.row.paymentCollected"), amountPesewas: row.amountPesewas, tone: "in", chips: [...paymentChips(), ...(name ? [person(name)] : [])] };
  }
  if (row.kind === "spent" || row.kind === "credit") {
    const category = categoryLabel(row.category);
    const chips = [
      ...(category ? [{ kind: "category", label: category }] : []),
      ...(row.owedPesewas > 0 ? [{ kind: "credit", label: `${t("transactions.tag.credit")} ${formatGhs(row.owedPesewas)}` }] : [])
    ];
    // Stock bought fully on credit: nothing was paid today, so the amount has no sign.
    if (row.kind === "credit") return { title: t("transactions.row.spent"), amountPesewas: row.amountPesewas, tone: "credit", chips };
    return { title: t("transactions.row.spent"), amountPesewas: row.amountPesewas, tone: "spent", chips };
  }
  if (row.kind === "debt_added") {
    return { title: t("transactions.row.addedToDebt"), amountPesewas: row.amountPesewas, tone: "credit", chips: name ? [person(name)] : [] };
  }
  if (row.kind === "adjustment") {
    return { title: t("transactions.row.balanceCorrection"), amountPesewas: Math.abs(row.adjustmentDeltaPesewas), tone: "neutral", chips: name ? [person(name)] : [] };
  }
  return { title: "", amountPesewas: row.amountPesewas, tone: "neutral", chips: [] };
}

function categoryLabel(category) {
  const text = String(category ?? "").trim();
  const key = `transactions.category.${text.toLowerCase()}`;
  return ["stock", "transport", "rent", "utilities", "other"].includes(text.toLowerCase()) ? t(key) : text;
}

export function filterPosTransactionRows(rows, filter) {
  if (filter === "sold") return rows.filter((row) => row.isSale);
  if (filter === "spent") return rows.filter((row) => row.kind === "spent");
  if (filter === "credit") return rows.filter((row) => row.isCredit);
  if (filter !== "all") throw new TypeError(`Unknown transaction filter: ${filter}`);
  return rows;
}
