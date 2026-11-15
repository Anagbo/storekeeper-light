import test from "node:test";
import assert from "node:assert/strict";
import { getSupplierBalances, validateSupplierExpense } from "../src/utils/suppliers.js";

test("supplier balances subtract partial payments from oldest stock payables", () => {
  const suppliers = [{ id: "supplier-1", name: "Market Wholesale", nameLower: "market wholesale" }];
  const transactions = [
    {
      id: "purchase-1",
      type: "expense",
      category: "stock",
      supplierId: "supplier-1",
      amountPesewas: 10000,
      paidAmountPesewas: 4000,
      owedAmountPesewas: 6000,
      payBy: "2026-11-05",
      createdAt: 1
    },
    {
      id: "purchase-2",
      type: "expense",
      category: "stock",
      supplierId: "supplier-1",
      amountPesewas: 5000,
      paidAmountPesewas: 0,
      owedAmountPesewas: 5000,
      payBy: "2026-11-12",
      createdAt: 2
    },
    { id: "payment-1", type: "supplier_payment", supplierId: "supplier-1", amountPesewas: 7000, createdAt: 3 }
  ];

  assert.deepEqual(getSupplierBalances(transactions, suppliers, "2026-11-01").map((supplier) => ({
    id: supplier.id,
    balancePesewas: supplier.balancePesewas,
    nextDueDate: supplier.nextDueDate,
    dueStatus: supplier.dueStatus
  })), [{
    id: "supplier-1",
    balancePesewas: 4000,
    nextDueDate: "2026-11-12",
    dueStatus: "upcoming"
  }]);
});

test("paid supplier balances are omitted and unpaid stock requires a supplier", () => {
  assert.deepEqual(getSupplierBalances([
    {
      id: "purchase-1",
      type: "expense",
      category: "stock",
      supplierId: "supplier-1",
      amountPesewas: 2500,
      paidAmountPesewas: 0,
      owedAmountPesewas: 2500,
      createdAt: 1
    },
    { id: "payment-1", type: "supplier_payment", supplierId: "supplier-1", amountPesewas: 2500, createdAt: 2 }
  ], [{ id: "supplier-1", name: "Supplier" }]), []);

  assert.throws(() => validateSupplierExpense({
    amountPesewas: 5000,
    paidAmountPesewas: 1000,
    category: "stock"
  }), /supplier/);
  assert.doesNotThrow(() => validateSupplierExpense({
    amountPesewas: 5000,
    paidAmountPesewas: 1000,
    category: "stock",
    supplierId: "supplier-1"
  }));
  assert.throws(() => validateSupplierExpense({
    amountPesewas: 5000,
    paidAmountPesewas: 6000,
    category: "stock",
    supplierId: "supplier-1"
  }), /between zero and the total/);
});

test("overdue supplier payables are labeled from their due date", () => {
  const [supplier] = getSupplierBalances([{
    id: "purchase-1",
    type: "expense",
    category: "stock",
    supplierId: "supplier-1",
    amountPesewas: 2500,
    paidAmountPesewas: 0,
    owedAmountPesewas: 2500,
    payBy: "2026-10-30",
    createdAt: 1
  }], [{ id: "supplier-1", name: "Supplier" }], "2026-11-01");
  assert.equal(supplier.dueStatus, "late");
  assert.equal(supplier.nextDueDate, "2026-10-30");
});
