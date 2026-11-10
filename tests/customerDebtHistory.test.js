import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatHistoryTimestamp,
  getHistoryCreditAmount,
  summarizeCustomerHistory,
  sortHistoryEvents
} from "../src/utils/customerDebtHistory.js";

test("formats activity timestamps with a day/month/year date and lowercase 12-hour time", () => {
  const timestamp = new Date(2026, 9, 24, 14, 45).toISOString();
  const formatted = formatHistoryTimestamp(timestamp);

  assert.equal(formatted.date, "24/10/2026");
  assert.equal(formatted.time, "02:45 pm");
  assert.deepEqual(formatHistoryTimestamp(Date.parse(timestamp)), formatted);
});

test("sorts activity events by timestamp descending for ISO and numeric values", () => {
  const events = [
    { id: "older", timestamp: "2026-10-24T10:00:00.000Z" },
    { id: "newest", timestamp: Date.parse("2026-10-24T14:00:00.000Z") },
    { id: "middle", timestamp: "2026-10-24T12:00:00.000Z" }
  ];

  assert.deepEqual(sortHistoryEvents(events).map((event) => event.id), ["newest", "middle", "older"]);
});

test("reports the gap between recorded activity and the ledger without inventing history events", () => {
  const events = [
    { id: "credit-logged", type: "credit", timestamp: 100, amountPesewas: 26000 },
    { id: "payment-logged", type: "payment", timestamp: 200, amountPesewas: 6000 }
  ];

  const result = summarizeCustomerHistory(events, 106000);
  assert.equal(result.totalCreditPesewas, 26000);
  assert.equal(result.totalPaidPesewas, 6000);
  assert.equal(result.currentBalancePesewas, 106000);
  assert.equal(result.unaccountedCreditPesewas, 86000);
  assert.deepEqual(result.events.map((event) => event.id), ["payment-logged", "credit-logged"]);
});

test("installment sale fallback treats the initial deposit as paid rather than credit", () => {
  assert.equal(getHistoryCreditAmount({
    type: "installment_addon",
    amountPesewas: 10000,
    installmentPaymentPesewas: 2000
  }), 8000);
  assert.equal(getHistoryCreditAmount({
    type: "installment_sale",
    amountPesewas: 10000,
    installmentPaymentPesewas: 10000
  }), 0);
});

test("history uses gross credit when the initial payment is recorded separately", () => {
  assert.equal(getHistoryCreditAmount({
    type: "installment_sale",
    amountPesewas: 10000,
    creditSaleGrossPesewas: 10000,
    creditExtendedPesewas: 3000,
    installmentPaymentPesewas: 7000
  }), 10000);
});

test("history totals reconcile multiple credit entries, payments, and a correction", () => {
  const result = summarizeCustomerHistory([
    { id: "sale", type: "credit", timestamp: 100, amountPesewas: 10000 },
    { id: "addon", type: "addon", timestamp: 110, amountPesewas: 5000 },
    { id: "initial-payment", type: "payment", timestamp: 120, amountPesewas: 7000 },
    { id: "collection", type: "payment", timestamp: 130, amountPesewas: 3000 },
    { id: "adjustment", type: "adjustment", timestamp: 140, amountPesewas: 1000, deltaPesewas: -1000 }
  ], 4000);

  assert.equal(result.totalCreditPesewas, 14000);
  assert.equal(result.totalPaidPesewas, 10000);
  assert.equal(result.currentBalancePesewas, 4000);
  assert.equal(result.unaccountedCreditPesewas, 0);
});

test("includes balance corrections in debt history reconciliation", () => {
  const result = summarizeCustomerHistory([
    { id: "credit", type: "credit", timestamp: 100, amountPesewas: 10000 },
    { id: "adjustment", type: "adjustment", timestamp: 150, amountPesewas: 2000, deltaPesewas: -2000 },
    { id: "payment", type: "payment", timestamp: 200, amountPesewas: 3000 }
  ], 5000);

  assert.equal(result.totalCreditPesewas, 8000);
  assert.equal(result.totalPaidPesewas, 3000);
  assert.equal(result.unaccountedCreditPesewas, 0);
});
