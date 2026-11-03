import test from "node:test";
import assert from "node:assert/strict";
import { buildSaleReceiptMessage, getSaleReceiptDetails } from "../src/pos/saleReceipt.js";

const transaction = {
  amountPesewas: 1300,
  payment_method: "cash",
  timestamp: Date.parse("2026-11-02T09:30:00"),
  items_json: JSON.stringify([
    { name: "Bread", quantity: 2, total_amount: 1000 },
    { name: "Water", quantity: 1, total_amount: 300 }
  ])
};

test("sale receipt details preserve item quantities, totals, payment method and timestamp", () => {
  assert.deepEqual(getSaleReceiptDetails(transaction), {
    amountPesewas: 1300,
    timestamp: transaction.timestamp,
    paymentMethod: "cash",
    cashReceivedPesewas: 1300,
    momoReceivedPesewas: 0,
    items: [
      { name: "Bread", quantity: 2, amountPesewas: 1000 },
      { name: "Water", quantity: 1, amountPesewas: 300 }
    ]
  });
  const message = buildSaleReceiptMessage(transaction, "Ama's Shop");
  assert.match(message, /^Sale recorded by Ama's Shop\n/);
  assert.match(message, /Bread × 2: .+10\.00/);
  assert.match(message, /Water × 1: .+3\.00/);
  assert.match(message, /Payment: Cash/);
});

test("sale receipts reject invalid sale details instead of showing an inaccurate total", () => {
  assert.throws(() => getSaleReceiptDetails({ ...transaction, amountPesewas: 1301 }), /do not match/);
  assert.throws(() => getSaleReceiptDetails({ ...transaction, payment_method: "credit" }), /payment method/);
  assert.throws(() => getSaleReceiptDetails({ ...transaction, items_json: "not json" }), /valid JSON/);
});
