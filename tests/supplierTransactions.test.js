import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordExpense, recordSupplierPayment } from "../src/db/suppliers.js";
import { getSupplierBalances } from "../src/utils/suppliers.js";

const tables = [db.suppliers, db.transactions];

before(async () => {
  await db.open();
});

beforeEach(async () => {
  await Promise.all(tables.map((table) => table.clear()));
});

after(async () => {
  db.close();
  await db.delete();
});

async function addSupplier() {
  await db.suppliers.add({
    id: "supplier-1",
    name: "Market Wholesale",
    nameLower: "market wholesale",
    phone: "",
    createdAt: 1,
    updatedAt: 1
  });
  return "supplier-1";
}

test("concurrent supplier payments cannot exceed the payable balance", async () => {
  const supplierId = await addSupplier();
  await recordExpense({
    amountPesewas: 10000,
    paidAmountPesewas: 0,
    category: "stock",
    supplierId,
    now: 1
  });

  const results = await Promise.allSettled([
    recordSupplierPayment({ supplierId, amountPesewas: 7000, now: 2 }),
    recordSupplierPayment({ supplierId, amountPesewas: 7000, now: 3 })
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);

  const [supplier] = getSupplierBalances(
    await db.transactions.toArray(),
    await db.suppliers.toArray()
  );
  assert.equal(supplier.balancePesewas, 3000);
  const transactions = await db.transactions.toArray();
  assert.equal(transactions.filter((transaction) => transaction.type === "supplier_payment").length, 1);
  assert.equal(
    transactions.filter((transaction) => transaction.type === "supplier_payment")
      .reduce((sum, transaction) => sum + transaction.amountPesewas, 0),
    7000
  );
});

test("a supplier payment racing a new payable reconciles both committed operations", async () => {
  const supplierId = await addSupplier();
  await recordExpense({
    amountPesewas: 10000,
    paidAmountPesewas: 0,
    category: "stock",
    supplierId,
    now: 10
  });

  const results = await Promise.all([
    recordSupplierPayment({ supplierId, amountPesewas: 8000, now: 11 }),
    recordExpense({
      amountPesewas: 5000,
      paidAmountPesewas: 0,
      category: "stock",
      supplierId,
      now: 12
    })
  ]);
  assert.equal(results.length, 2);

  const transactions = await db.transactions.toArray();
  const [supplier] = getSupplierBalances(transactions, await db.suppliers.toArray());
  assert.equal(supplier.balancePesewas, 7000);
  assert.equal(
    transactions.filter((transaction) => transaction.type === "expense")
      .reduce((sum, transaction) => sum + transaction.owedAmountPesewas, 0) -
      transactions.filter((transaction) => transaction.type === "supplier_payment")
        .reduce((sum, transaction) => sum + transaction.amountPesewas, 0),
    supplier.balancePesewas
  );
});

test("a failed expense transaction rolls back its newly created supplier", async () => {
  const originalAdd = db.transactions.add;
  db.transactions.add = async () => { throw new Error("forced expense write failure"); };
  try {
    await assert.rejects(recordExpense({
      amountPesewas: 10000,
      paidAmountPesewas: 4000,
      category: "stock",
      newSupplier: { name: "Market Wholesale", phone: "0241234567" },
      now: 4
    }), /forced expense write failure/);
  } finally {
    db.transactions.add = originalAdd;
  }

  assert.equal(await db.suppliers.count(), 0);
  assert.equal(await db.transactions.count(), 0);
});

test("a failed new-supplier write leaves no expense transaction", async () => {
  const originalAdd = db.suppliers.add;
  db.suppliers.add = async () => { throw new Error("forced supplier write failure"); };
  try {
    await assert.rejects(recordExpense({
      amountPesewas: 10000,
      paidAmountPesewas: 4000,
      category: "stock",
      newSupplier: { name: "Market Wholesale" },
      now: 5
    }), /forced supplier write failure/);
  } finally {
    db.suppliers.add = originalAdd;
  }

  assert.equal(await db.suppliers.count(), 0);
  assert.equal(await db.transactions.count(), 0);
});

test("a failed supplier payment write leaves the payable unchanged", async () => {
  const supplierId = await addSupplier();
  await recordExpense({
    amountPesewas: 10000,
    paidAmountPesewas: 0,
    category: "stock",
    supplierId,
    now: 6
  });
  const before = await db.transactions.toArray();
  const originalAdd = db.transactions.add;
  db.transactions.add = async () => { throw new Error("forced payment write failure"); };
  try {
    await assert.rejects(recordSupplierPayment({
      supplierId,
      amountPesewas: 3000,
      now: 7
    }), /forced payment write failure/);
  } finally {
    db.transactions.add = originalAdd;
  }

  assert.deepEqual(await db.transactions.toArray(), before);
});
