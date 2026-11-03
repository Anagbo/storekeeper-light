import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatHistoryTimestamp,
  getHistoryCreditAmount,
  summarizeCustomerHistory,
  sortHistoryEvents
} from "../src/utils/customerDebtHistory.js";

test("formats activity timestamps with abbreviated local date and lowercase 12-hour time", () => {
  const timestamp = new Date(2026, 9, 24, 14, 45).toISOString();
  const formatted = formatHistoryTimestamp(timestamp);

  assert.equal(formatted.date, "Oct 24, 2026");
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
