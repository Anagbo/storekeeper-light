import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { recordCreditSale } from "../src/db/debts.js";
import { db } from "../src/db/db.js";

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

test("a credit sale keeps each item line's cost at the time of sale; a keypad-only sale gets none", async () => {
  const milo = await db.products.add({ name: "Milo", default_price: 25, cost_price_pesewas: 0, active: true });
  const result = await recordCreditSale({
    amountPesewas: 5000,
    name: "Kofi",
    saleItems: [{ productId: milo, name: "Milo", quantity: 2, unitPricePesewas: 2500 }]
  });
  const [line] = JSON.parse((await db.transactions.get(result.transactionId)).items_json);
  assert.equal(line.cost_at_sale_pesewas, 0, "0 is a real cost, kept as 0");

  const keypad = await recordCreditSale({ amountPesewas: 800, name: "Kofi" });
  const [keypadLine] = JSON.parse((await db.transactions.get(keypad.transactionId)).items_json);
  assert.equal(keypadLine.cost_at_sale_pesewas ?? null, null, "a keypad-only sale is never given a cost");
  db.close();
  await db.delete();
});
