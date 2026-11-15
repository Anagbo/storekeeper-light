import test from "node:test";
import assert from "node:assert/strict";
import { recordCreditSale } from "../src/db/debts.js";

test("credit sale validation rejects missing names and invalid amounts before writing", async () => {
  await assert.rejects(recordCreditSale({ amountPesewas: 500, name: " " }), /customer name/);
  await assert.rejects(recordCreditSale({ amountPesewas: 0, name: "Ama" }), /positive integer/);
  await assert.rejects(recordCreditSale({ amountPesewas: 500, name: "Ama", initialPaymentPesewas: -1 }), /Initial payment/);
  await assert.rejects(recordCreditSale({
    amountPesewas: 500,
    name: "Ama",
    saleItems: [{ productId: 1, name: "Bread", quantity: 2, unitPricePesewas: 300 }]
  }), /Item totals/);
});

test("credit sale validation checks payment methods, Ghana Cards, due dates and installment schedules", async () => {
  await assert.rejects(recordCreditSale({ amountPesewas: 500, name: "Ama", paymentMethod: "card" }), /cash or MoMo/);
  await assert.rejects(recordCreditSale({ amountPesewas: 500, name: "Ama", ghanaCardNumber: "not-a-card" }), /Ghana Card/);
  await assert.rejects(recordCreditSale({ amountPesewas: 500, name: "Ama", dueDate: "tomorrow" }), /due date/);
  await assert.rejects(recordCreditSale({
    amountPesewas: 500,
    name: "Ama",
    installmentPlan: { isInstallmentPlan: true, installmentAmount: 100, frequency: "daily", nextDueDate: "2026-11-01", installmentsRemaining: 5 }
  }), /installment plan/);
});
