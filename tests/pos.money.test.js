import test from "node:test";
import assert from "node:assert/strict";
import {
  getDebtDueLabel,
  getMoneyPeriodRange,
  getMostUrgentCustomerDebt,
  getOutstandingDebtPesewas,
  getPreviousMoneyPeriodRange,
  summarizeMoney
} from "../src/pos/money.js";
import {
  getOutstandingDebtPesewas as getSharedOutstandingDebtPesewas,
  summarizeFinancialTransactions as summarizeSharedFinancialTransactions,
  summarizePosMoney
} from "../src/lib/money.js";
import { getCreditAmountOwedPesewas } from "../src/pos/creditAmount.js";

test("split credit displays and plans only the unpaid portion of the sale", () => {
  assert.equal(getCreditAmountOwedPesewas({
    amountPesewas: 8000,
    initialPaymentPesewas: 6000
  }), 2000);
  assert.equal(getCreditAmountOwedPesewas({
    amountPesewas: 8000,
    initialPaymentPesewas: 0
  }), 8000);
  assert.equal(getCreditAmountOwedPesewas({
    amountPesewas: 8000,
    initialPaymentPesewas: 9000
  }), 0);
});

test("summarizeMoney classifies cash, MoMo, debt payments, credit and spending", () => {
  const totals = summarizeMoney([
    { type: "sale", amountPesewas: 5000, payment_method: "cash" },
    { type: "sale", amountPesewas: 2000, payment_method: "momo" },
    { type: "debt_payment", amountPesewas: 300, payment_method: "cash" },
    { type: "income", amountPesewas: 50, note: "Debt payment received" },
    { type: "installment_sale", amountPesewas: 3000, installmentPaymentPesewas: 1000 },
    { type: "installment_addon", amountPesewas: 4000, installmentPaymentPesewas: 500 },
    { type: "sale", amountPesewas: 1500, paymentType: "credit", cashReceivedPesewas: 250 },
    { type: "expense", amountPesewas: 800, paidAmountPesewas: 600 }
  ]);

  assert.deepEqual(totals, {
    moneyIn: 9100,
    cashIn: 7100,
    momoIn: 2000,
    moneySpent: 600,
    cashLeft: 8500,
    sales: 15500
  });
});

test("all POS money surfaces agree on one ledger", () => {
  const transactions = [
    { id: "cash-sale", type: "sale", amountPesewas: 10000, paymentType: "cash" },
    {
      id: "credit-sale",
      type: "sale",
      amountPesewas: 5000,
      paymentType: "credit",
      cashReceivedPesewas: 2000,
      creditExtendedPesewas: 3000
    },
    { id: "collection", type: "debt_payment", amountPesewas: 1500, payment_method: "momo" },
    { id: "expense", type: "expense", amountPesewas: 1000, paidAmountPesewas: 700 },
    { id: "supplier-payment", type: "supplier_payment", amountPesewas: 300 }
  ];
  const debts = [
    { id: "open-debt", status: "unpaid", amountPesewas: 7000 },
    { id: "settled-debt", status: "paid", amountPesewas: 9000 }
  ];

  const homeTotals = summarizePosMoney(transactions);
  const todayTotals = summarizeSharedFinancialTransactions(transactions);
  const myMoneyTotals = summarizeMoney(transactions);
  const peopleWhoOweYouTotal = getSharedOutstandingDebtPesewas(debts);

  assert.deepEqual(homeTotals, {
    moneyIn: 13500,
    cashIn: 12000,
    momoIn: 1500,
    moneySpent: 1000,
    cashLeft: 12500,
    sales: 15000
  });
  assert.equal(myMoneyTotals.moneyIn, homeTotals.moneyIn);
  assert.equal(myMoneyTotals.cashLeft, homeTotals.cashLeft);
  assert.equal(todayTotals.cashInflow, homeTotals.moneyIn);
  assert.equal(todayTotals.expenses, homeTotals.moneySpent);
  assert.equal(todayTotals.newCreditExtended, 3000);
  assert.equal(peopleWhoOweYouTotal, 7000);
});

test("money summaries reject malformed amounts rather than hiding them as zero", () => {
  assert.throws(
    () => summarizeMoney([{ id: "bad-sale", type: "sale", amountPesewas: 2.5 }]),
    /invalid pesewa amount/
  );
});

test("money ranges use calendar weeks and months, including the previous calendar month", () => {
  const now = new Date(2026, 2, 15, 13, 30);
  const week = getMoneyPeriodRange("week", now);
  const month = getMoneyPeriodRange("month", now);
  const previousMonth = getPreviousMoneyPeriodRange("month", now);

  assert.equal(new Date(week.start).getDay(), 1);
  assert.equal(new Date(week.start).getHours(), 0);
  assert.equal(new Date(month.start).getDate(), 1);
  assert.equal(new Date(month.end).getMonth(), 3);
  assert.equal(new Date(previousMonth.start).getMonth(), 1);
  assert.equal(new Date(previousMonth.start).getDate(), 1);
  assert.equal(previousMonth.end, month.start);
});

test("most urgent debt prefers overdue dates and due labels are date-derived", () => {
  const today = new Date(2026, 4, 10, 12);
  const urgent = getMostUrgentCustomerDebt([
    { id: "future", status: "unpaid", customerName: "Future", amountPesewas: 9000, dueDate: "2026-05-11" },
    { id: "late-later", status: "unpaid", customerName: "Late later", amountPesewas: 1200, dueDate: "2026-05-09" },
    { id: "late-first", status: "unpaid", customerName: "Late first", amountPesewas: 1000, dueDate: "2026-05-08" }
  ], today);

  assert.equal(urgent.customerName, "Late first");
  assert.equal(urgent.debtId, "late-first");
  assert.equal(getDebtDueLabel("2026-05-10", today), "Due today");
  assert.equal(getDebtDueLabel("2026-05-12", today), "In 2 days");
});

test("the urgent customer entry retains its earliest-due debt for collection", () => {
  const urgent = getMostUrgentCustomerDebt([
    { id: "later-debt", status: "unpaid", customerName: "Ama", amountPesewas: 9000, dueDate: "2026-05-12" },
    { id: "earlier-debt", status: "unpaid", customerName: "Ama", amountPesewas: 1200, dueDate: "2026-05-09" }
  ], new Date(2026, 4, 10, 12));

  assert.equal(urgent.customerName, "Ama");
  assert.equal(urgent.amountPesewas, 10200);
  assert.equal(urgent.debtId, "earlier-debt");
});

test("outstanding balances sum only unpaid integer-pesewa debt and reject invalid balances", () => {
  assert.equal(getOutstandingDebtPesewas([
    { id: "open", status: "unpaid", amountPesewas: 1250 },
    { id: "paid", status: "paid", amountPesewas: 300 },
    { id: "legacy", status: "unpaid", total_owed: 750 }
  ]), 2000);
  assert.throws(
    () => getOutstandingDebtPesewas([{ id: "bad", status: "unpaid", amountPesewas: 1.5 }]),
    /invalid pesewa balance/
  );
});
