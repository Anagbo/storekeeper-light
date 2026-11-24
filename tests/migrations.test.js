import "fake-indexeddb/auto";
import Dexie from "dexie";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../src/db/db.js";

const databaseName = db.name;

async function resetDatabase() {
  db.close();
  await db.delete();
}

async function createLegacyDatabase(version, stores, records) {
  await resetDatabase();
  const legacy = new Dexie(databaseName);
  legacy.version(version).stores(stores);
  await legacy.open();
  for (const [tableName, values] of Object.entries(records)) {
    await legacy.table(tableName).bulkAdd(values);
  }
  legacy.close();
}

after(async () => {
  await resetDatabase();
});

test("upgrades a v1 database through v14 without losing ledger data", async () => {
  await createLegacyDatabase(1, {
    products: "++id, name, updatedAt, syncStatus, [name+updatedAt], [syncStatus+updatedAt]",
    transactions: "id, type, createdAt, updatedAt, syncStatus, [type+createdAt], [syncStatus+updatedAt]",
    debts: "id, customerName, phone, status, updatedAt, syncStatus, [status+updatedAt], [customerName+status], [syncStatus+updatedAt]"
  }, {
    products: [{ id: 1, name: "Bread", default_price: 1500 }],
    transactions: [{ id: "sale-1", type: "sale", amountPesewas: 1500, paymentType: "cash", createdAt: 100 }],
    debts: [{ id: "debt-1", customerName: "Ama", phone: "0241234567", status: "active", amountPesewas: 3000, createdAt: 100 }]
  });

  await db.open();
  const [product] = await db.products.toArray();
  const [transaction] = await db.transactions.toArray();
  const [debt] = await db.debts.toArray();

  assert.equal(db.verno, 14);
  assert.ok(db.tables.some((table) => table.name === "reminders"), "v14 adds the reminder events");
  assert.ok(await db.suppliers.count() >= 0);
  assert.equal(product.unit, "unit");
  assert.equal(transaction.timestamp, 100);
  assert.equal(transaction.payment_method, "cash");
  assert.equal(debt.status, "unpaid");
  assert.equal(debt.total_owed, 3000);
  assert.equal(await db.customers.count(), 1);
});

test("upgrades a v11 database to v12 with supplier storage and indexes", async () => {
  await createLegacyDatabase(11, {
    products: "++id, name, category, default_price, updatedAt, syncStatus, synced, [name+updatedAt], [syncStatus+updatedAt], [category+name]",
    transactions: "id, type, customerId, createdAt, timestamp, updatedAt, syncStatus, synced, [type+createdAt], [syncStatus+updatedAt], [createdAt+id], [type+timestamp]",
    debts: "id, customerId, customerName, customer_name, phone, customer_phone, status, amountPesewas, updatedAt, syncStatus, synced, [status+updatedAt], [customerName+status], [syncStatus+updatedAt], [status+updatedAt+id], [status+amountPesewas+id], [status+created_at], nextDueDate",
    customers: "id, name, nameLower, phone, totalDebtPesewas, createdAt, updatedAt",
    settings: "key",
    payments: "id, customerId, debtId, createdAt, paymentMethod, syncStatus, synced, [customerId+createdAt], [debtId+createdAt], [syncStatus+createdAt]"
  }, {
    products: [],
    transactions: [{ id: "stock-1", type: "expense", supplierId: "supplier-1", amountPesewas: 5000, createdAt: 100 }],
    debts: [],
    customers: [],
    settings: [],
    payments: []
  });

  await db.open();
  assert.equal(db.verno, 14);
  assert.ok(db.tables.some((table) => table.name === "reminders"), "v14 adds the reminder events");
  assert.ok(db.tables.some((table) => table.name === "suppliers"));
  assert.ok(db.tables.some((table) => table.name === "planPayments"));
  assert.ok(db.transactions.schema.indexes.some((index) => index.name === "supplierId"));
  assert.equal((await db.transactions.get("stock-1")).supplierId, "supplier-1");
});

test("an old item and an old sale read their cost as unknown (null), never zero", async () => {
  await createLegacyDatabase(1, {
    products: "++id, name, updatedAt, syncStatus, [name+updatedAt], [syncStatus+updatedAt]",
    transactions: "id, type, createdAt, updatedAt, syncStatus, [type+createdAt], [syncStatus+updatedAt]",
    debts: "id, customerName, phone, status, updatedAt, syncStatus, [status+updatedAt], [customerName+status], [syncStatus+updatedAt]"
  }, {
    products: [{ id: 1, name: "Bread", default_price: 15 }],
    transactions: [{
      id: "sale-old", type: "sale", amountPesewas: 1500, paymentType: "cash", createdAt: 100,
      items_json: JSON.stringify([{ productId: 1, name: "Bread", quantity: 1, unitPricePesewas: 1500, total_amount: 1500 }])
    }],
    debts: []
  });

  await db.open();
  assert.equal(db.verno, 14, "no Dexie version bump for the cost fields");
  const product = await db.products.get(1);
  assert.equal(product.cost_price_pesewas ?? null, null);
  const [line] = JSON.parse((await db.transactions.get("sale-old")).items_json);
  assert.equal(line.cost_at_sale_pesewas ?? null, null);
});
