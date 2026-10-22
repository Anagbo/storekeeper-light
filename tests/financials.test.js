import test from "node:test";
import assert from "node:assert/strict";
import { getFinancialDateRange, summarizeFinancialTransactions } from "../src/utils/financials.js";

test("aggregates cash sales, recovered debt, expenses, and new credit", () => {
  const summary = summarizeFinancialTransactions([
    { type: "sale", paymentType: "cash", amountPesewas: 5000 },
    { type: "cash_sale", amountPesewas: 2500 },
    { type: "debt_payment", amountPesewas: 1000 },
    { type: "income", note: "Debt payment from Ama · 5.00 remaining", amountPesewas: 500 },
    { type: "expense", amountPesewas: 2000 },
    { type: "sale", paymentType: "credit", amountPesewas: 4000 },
    { type: "credit_sale", total_amount: 3000 }
  ]);

  assert.deepEqual(summary, {
    directCashSales: 7500,
    debtPaymentsCollected: 1500,
    cashInflow: 9000,
    cashReceived: 9000,
    momoReceived: 0,
    expenses: 2000,
    realCashProfit: 7000,
    newCreditExtended: 7000,
    accruedProfit: 14000
  });
});

test("splits cash and MoMo inflow for sales and debt payments", () => {
  const summary = summarizeFinancialTransactions([
    { type: "sale", paymentType: "momo", amountPesewas: 5000 },
    { type: "sale", paymentType: "cash", amountPesewas: 3000 },
    { type: "income", note: "Debt payment from Ama", payment_method: "momo", amountPesewas: 2000 },
    { type: "debt_payment", amountPesewas: 1000 },
    { type: "sale", paymentType: "credit", amountPesewas: 4000 },
    { type: "credit_sale", payment_method: "momo", amountPesewas: 1500 }
  ]);

  assert.equal(summary.directCashSales, 8000);
  assert.equal(summary.debtPaymentsCollected, 3000);
  assert.equal(summary.cashReceived, 4000);
  assert.equal(summary.momoReceived, 7000);
  assert.equal(summary.cashInflow, 11000);
  assert.equal(summary.newCreditExtended, 5500);
});

test("treats legacy Telecel Cash receipts as MoMo and missing methods as cash", () => {
  const summary = summarizeFinancialTransactions([
    { type: "sale", paymentType: "cash", payment_method: null, amountPesewas: 1000 },
    { type: "income", note: "Debt payment from Ama", payment_method: "telecel_cash", amountPesewas: 2000 }
  ]);

  assert.equal(summary.cashReceived, 1000);
  assert.equal(summary.momoReceived, 2000);
});

test("week date range starts Monday and ends exclusively the next Monday", () => {
  const range = getFinancialDateRange("week", "", "", new Date(2026, 9, 25, 15));
  assert.equal(new Date(range.start).getDay(), 1);
  assert.equal(new Date(range.start).getDate(), 19);
  assert.equal(new Date(range.end).getDate(), 26);
});

test("custom date range includes the full selected end date", () => {
  const range = getFinancialDateRange("custom", "2026-10-01", "2026-10-03");
  assert.equal(new Date(range.start).getDate(), 1);
  assert.equal(new Date(range.end).getDate(), 4);
  assert.equal(getFinancialDateRange("custom", "2026-10-04", "2026-10-03"), null);
});
