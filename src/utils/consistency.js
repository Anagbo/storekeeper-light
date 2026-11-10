import { db as defaultDb } from "../db/db.js";
import { summarizeFinancialTransactions, summarizePosMoney } from "./financials.js";
import { getSupplierBalances } from "./suppliers.js";
import {
  calculateLedgerEventBalance,
  getCustomerLedgerRecords,
  getCreditEventAmount,
  matchSaleTimePayments
} from "./debtLedgerMath.js";

function isPesewaAmount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function amountOf(record) {
  return record.amountPesewas ?? record.total_amount;
}

function addIssue(issues, code, message, recordId = "") {
  issues.push({ code, message, recordId });
}

function checkReference(issues, records, record, field, targetName) {
  if (record[field] && !records.has(record[field])) {
    addIssue(issues, "missing_reference", `${targetName} ${record[field]} referenced by ${record.id ?? "(unknown)"} does not exist.`, record.id);
  }
}

function checkInstallment(issues, debt) {
  const balance = debt.amountPesewas ?? debt.total_owed;
  if (!debt.isInstallmentPlan) {
    if ((debt.installmentsRemaining ?? 0) !== 0 || (debt.totalInstallments ?? 0) !== 0) {
      addIssue(issues, "installment_schedule_mismatch", `Debt ${debt.id} has installment counts without an active plan.`, debt.id);
    }
    return;
  }
  if (!isPesewaAmount(balance) || !Number.isSafeInteger(debt.installmentAmount) || debt.installmentAmount <= 0) {
    addIssue(issues, "installment_schedule_mismatch", `Debt ${debt.id} has an invalid installment amount or balance.`, debt.id);
    return;
  }
  const expectedRemaining = Math.ceil(balance / debt.installmentAmount);
  if (debt.installmentsRemaining !== expectedRemaining ||
    !Number.isSafeInteger(debt.totalInstallments) ||
    debt.totalInstallments < debt.installmentsRemaining) {
    addIssue(issues, "installment_schedule_mismatch", `Debt ${debt.id} installment counts do not match its balance.`, debt.id);
  }
}

function checkSplitPayment(issues, record) {
  const hasSplit = record.cashReceivedPesewas !== undefined ||
    record.momoReceivedPesewas !== undefined ||
    record.creditExtendedPesewas !== undefined;
  if (!hasSplit || !["sale", "cash_sale", "credit_sale", "installment_sale", "installment_addon"].includes(record.type)) return;
  const amount = amountOf(record);
  const cash = record.cashReceivedPesewas ?? 0;
  const momo = record.momoReceivedPesewas ?? 0;
  const credit = record.creditExtendedPesewas ?? 0;
  if (!isPesewaAmount(amount) || !isPesewaAmount(cash) || !isPesewaAmount(momo) || !isPesewaAmount(credit) ||
    cash + momo + credit !== amount) {
    addIssue(issues, "split_payment_mismatch", `Transaction ${record.id} payment parts do not add up to its sale amount.`, record.id);
  }
}

function checkDebtLedger(issues, debt, debts, transactions, payments, checkedCustomers) {
  const customerKey = debt.customerId ?? (debt.customer_name ?? debt.customerName ?? "").trim().toLowerCase();
  if (checkedCustomers.has(customerKey)) return;
  checkedCustomers.add(customerKey);

  const ledgerRecords = getCustomerLedgerRecords({
    customerId: debt.customerId,
    customerName: debt.customer_name ?? debt.customerName ?? "",
    debts,
    transactions,
    payments
  });
  const saleTimePayments = matchSaleTimePayments(ledgerRecords.transactions, ledgerRecords.payments);
  const linkedCredits = ledgerRecords.transactions.filter((record) => (
    getCreditEventAmount(record, saleTimePayments) > 0 ||
    ["sale", "credit_sale", "installment_sale", "installment_addon"].includes(record.type)
  ));
  const linkedAdjustments = ledgerRecords.transactions.filter((record) => record.type === "debt_adjustment");
  if (!linkedCredits.length && !linkedAdjustments.length) return;

  for (const record of linkedAdjustments) {
    if (!Number.isSafeInteger(record.deltaPesewas)) {
      addIssue(issues, "invalid_adjustment", `Debt adjustment ${record.id} has an invalid delta.`, record.id);
    }
  }

  const expectedBalance = calculateLedgerEventBalance(
    ledgerRecords.transactions,
    ledgerRecords.payments
  );
  const balance = debts
    .filter((item) => item.status === "unpaid" && (
      (debt.customerId && item.customerId === debt.customerId) ||
      (!item.customerId &&
        (item.customer_name ?? item.customerName ?? "").trim().toLowerCase() === customerKey)
    ))
    .reduce((total, item) => total + (item.amountPesewas ?? item.total_owed ?? 0), 0);
  if (!isPesewaAmount(expectedBalance) || expectedBalance !== balance) {
    addIssue(issues, "debt_balance_mismatch", `Customer ledger for ${customerKey} does not equal credits minus collections plus adjustments.`, debt.id);
  }
}

/**
 * Inspect ledger invariants without changing any database record.
 * The returned report is suitable for diagnostics and migration/sync checks.
 */
export async function checkLedgerConsistency(database = defaultDb) {
  const [transactions, debts, payments, customers, suppliers] = await Promise.all([
    database.transactions.toArray(),
    database.debts.toArray(),
    database.payments.toArray(),
    database.customers.toArray(),
    database.suppliers.toArray()
  ]);
  const issues = [];
  const transactionIds = new Set(transactions.map((record) => record.id));
  const debtIds = new Set(debts.map((record) => record.id));
  const customerIds = new Set(customers.map((record) => record.id));
  const supplierIds = new Set(suppliers.map((record) => record.id));

  for (const record of transactions) {
    if (!isPesewaAmount(amountOf(record))) {
      addIssue(issues, "invalid_amount", `Transaction ${record.id ?? "(unknown)"} has an invalid amount.`, record.id);
    }
    checkReference(issues, customerIds, record, "customerId", "Customer");
    checkReference(issues, debtIds, record, "debtId", "Debt");
    checkReference(issues, supplierIds, record, "supplierId", "Supplier");
    if ((record.cashReceivedPesewas !== undefined || record.momoReceivedPesewas !== undefined) &&
      (!isPesewaAmount(record.cashReceivedPesewas ?? 0) || !isPesewaAmount(record.momoReceivedPesewas ?? 0))) {
      addIssue(issues, "split_payment_mismatch", `Transaction ${record.id} has an invalid split payment.`, record.id);
    }
    checkSplitPayment(issues, record);
  }

  for (const payment of payments) {
    if (!isPesewaAmount(payment.amountPesewas) || payment.amountPesewas === 0) {
      addIssue(issues, "invalid_amount", `Payment ${payment.id ?? "(unknown)"} has an invalid amount.`, payment.id);
    }
    checkReference(issues, debtIds, payment, "debtId", "Debt");
    checkReference(issues, customerIds, payment, "customerId", "Customer");
    checkReference(issues, transactionIds, payment, "transactionId", "Transaction");
  }

  const unpaidByCustomer = new Map();
  const checkedLedgerCustomers = new Set();
  for (const debt of debts) {
    const balance = debt.amountPesewas ?? debt.total_owed;
    if (!isPesewaAmount(balance)) {
      addIssue(issues, "negative_or_invalid_balance", `Debt ${debt.id} has an invalid balance.`, debt.id);
    }
    checkReference(issues, customerIds, debt, "customerId", "Customer");
    checkInstallment(issues, debt);
    checkDebtLedger(issues, debt, debts, transactions, payments, checkedLedgerCustomers);
    if (debt.status === "unpaid") {
      const key = debt.customerId ?? (debt.customer_name ?? debt.customerName ?? "").trim().toLowerCase();
      unpaidByCustomer.set(key, (unpaidByCustomer.get(key) ?? 0) + (balance || 0));
    }
  }

  for (const customer of customers) {
    const key = customer.id;
    const expected = unpaidByCustomer.get(key) ?? unpaidByCustomer.get((customer.name ?? "").trim().toLowerCase()) ?? 0;
    if (!isPesewaAmount(customer.totalDebtPesewas) || customer.totalDebtPesewas !== expected) {
      addIssue(issues, "customer_balance_mismatch", `Customer ${customer.id} total debt does not match unpaid debts.`, customer.id);
    }
  }

  let financialTotals = null;
  let posTotals = null;
  try {
    financialTotals = summarizeFinancialTransactions(transactions);
    posTotals = summarizePosMoney(transactions);
  } catch (error) {
    addIssue(issues, "financial_totals_invalid", error.message);
  }
  if (financialTotals && posTotals && (
    posTotals.moneyIn !== financialTotals.cashInflow ||
    posTotals.moneySpent !== financialTotals.expenses ||
    posTotals.sales !== financialTotals.totalSales ||
    posTotals.cashLeft !== financialTotals.realCashProfit
  )) {
    addIssue(issues, "summary_mismatch", "POS money totals do not match the financial ledger totals.");
  }

  let supplierBalances = [];
  try {
    supplierBalances = getSupplierBalances(transactions, suppliers);
  } catch (error) {
    addIssue(issues, "supplier_balance_invalid", error.message);
  }

  return {
    ok: issues.length === 0,
    issues,
    checked: {
      transactions: transactions.length,
      debts: debts.length,
      payments: payments.length,
      customers: customers.length,
      suppliers: suppliers.length
    },
    totals: financialTotals ? {
      financial: financialTotals,
      pos: posTotals,
      supplierBalances
    } : null
  };
}
