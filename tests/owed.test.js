import assert from "node:assert/strict";
import { test } from "node:test";
import { groupUnpaidDebts, isDebtDueSoon, isDebtLate } from "../src/pos/owed.js";

test("groups unpaid debts by stable customer id and sorts by total balance", () => {
  const customers = [{ id: "customer-1", name: "Ama Owusu", phone: "+233241234567" }];
  const grouped = groupUnpaidDebts([
    { id: "debt-1", customerId: "customer-1", customerName: "Ama Owusu", amountPesewas: 4000, status: "unpaid" },
    { id: "debt-2", customerId: "customer-1", customerName: "Ama Owusu", amountPesewas: 3000, status: "unpaid" },
    { id: "debt-3", customerName: "Kofi", amountPesewas: 9000, status: "unpaid" }
  ], customers);

  assert.deepEqual(grouped.map((customer) => [customer.customerName, customer.balancePesewas]), [
    ["Kofi", 9000],
    ["Ama Owusu", 7000]
  ]);
  assert.equal(grouped[1].debtIds.length, 2);
  assert.equal(grouped[1].phone, "+233241234567");
});

test("keeps legacy name-only debts grouped case-insensitively", () => {
  const [customer] = groupUnpaidDebts([
    { id: "debt-1", customer_name: "Ama", total_owed: 1000, status: "unpaid" },
    { id: "debt-2", customerName: " ama ", amountPesewas: 2000, status: "unpaid" }
  ]);

  assert.equal(customer.customerName, "Ama");
  assert.equal(customer.balancePesewas, 3000);
  assert.deepEqual(customer.debtIds, ["debt-1", "debt-2"]);
});

test("classifies regular and installment debts for owed filters", () => {
  const today = new Date("2026-11-05T12:00:00");
  assert.equal(isDebtLate({ dueDate: "2026-11-04" }, today), true);
  assert.equal(isDebtDueSoon({ dueDate: "2026-11-10" }, today), true);
  assert.equal(isDebtDueSoon({ dueDate: "2026-11-13" }, today), false);
  assert.equal(isDebtDueSoon({ isInstallmentPlan: true, nextDueDate: "2026-11-06" }, today), true);
});
