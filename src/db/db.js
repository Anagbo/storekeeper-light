import Dexie from "dexie";
import { createId } from "../lib/ids.js";

export const db = new Dexie("StoreKeeperLight");

const sampleProducts = [
  { name: "Cooking oil", default_price: 2500, unit: "bottle", category: "Groceries" },
  { name: "Rice", default_price: 1800, unit: "bag", category: "Groceries" },
  { name: "Cement", default_price: 9500, unit: "bag", category: "Building supplies" },
  { name: "Soft drink", default_price: 1000, unit: "bottle", category: "Drinks" }
];

db.version(1).stores({
  products: "++id, name, updatedAt, syncStatus, [name+updatedAt], [syncStatus+updatedAt]",
  transactions: "id, type, createdAt, updatedAt, syncStatus, [type+createdAt], [syncStatus+updatedAt]",
  debts: "id, customerName, phone, status, updatedAt, syncStatus, [status+updatedAt], [customerName+status], [syncStatus+updatedAt]"
});

db.version(2).stores({
  products: "++id, name, updatedAt, syncStatus, [name+updatedAt], [syncStatus+updatedAt]",
  transactions: "id, type, createdAt, updatedAt, syncStatus, [type+createdAt], [syncStatus+updatedAt], [createdAt+id]",
  debts: "id, customerName, phone, status, updatedAt, syncStatus, [status+updatedAt], [customerName+status], [syncStatus+updatedAt], [status+updatedAt+id]"
});

db.version(3).stores({
  products: "++id, name, updatedAt, syncStatus, [name+updatedAt], [syncStatus+updatedAt]",
  transactions: "id, type, createdAt, updatedAt, syncStatus, [type+createdAt], [syncStatus+updatedAt], [createdAt+id]",
  debts: "id, customerName, phone, status, amountPesewas, updatedAt, syncStatus, [status+updatedAt], [customerName+status], [syncStatus+updatedAt], [status+updatedAt+id], [status+amountPesewas+id]"
});

db.version(4).stores({
  products: "++id, name, category, default_price, updatedAt, syncStatus, synced, [name+updatedAt], [syncStatus+updatedAt], [category+name]",
  transactions: "id, type, createdAt, timestamp, updatedAt, syncStatus, synced, [type+createdAt], [syncStatus+updatedAt], [createdAt+id], [type+timestamp], [synced+timestamp]",
  debts: "id, customerName, customer_name, phone, customer_phone, status, amountPesewas, total_owed, created_at, updatedAt, syncStatus, synced, [status+updatedAt], [customerName+status], [syncStatus+updatedAt], [status+updatedAt+id], [status+amountPesewas+id], [status+created_at]"
}).upgrade(async (transaction) => {
  const products = transaction.table("products");
  const productCount = await products.count();
  await products.toCollection().modify((product) => {
    product.default_price ??= 0;
    product.unit ??= "unit";
    product.category ??= "Other";
    product.synced ??= product.syncStatus === "synced";
  });
  if (productCount === 0) {
    await products.bulkAdd(sampleProducts.map((product) => ({
      ...product,
      updatedAt: Date.now(),
      syncStatus: "synced",
      synced: true
    })));
  }

  await transaction.table("transactions").toCollection().modify((record) => {
    record.total_amount ??= record.amountPesewas;
    record.payment_method ??= record.paymentType ?? null;
    record.customer_name ??= record.customerName ?? "";
    record.customer_phone ??= record.phone ?? "";
    record.items_json ??= JSON.stringify(record.itemDescription ? [{
      name: record.itemDescription,
      quantity: record.quantity ?? 1,
      total_amount: record.pricePesewas ?? record.amountPesewas
    }] : []);
    record.timestamp ??= record.createdAt;
    record.synced ??= record.syncStatus === "synced";
  });

  await transaction.table("debts").toCollection().modify((debt) => {
    debt.customer_name ??= debt.customerName;
    debt.customer_phone ??= debt.phone ?? "";
    debt.total_owed ??= debt.amountPesewas;
    if (debt.status === "active") debt.status = "unpaid";
    debt.last_reminder_date ??= null;
    debt.created_at ??= debt.createdAt;
    debt.synced ??= debt.syncStatus === "synced";
  });
});

db.version(5).stores({
  products: "++id, name, category, default_price, updatedAt, syncStatus, synced, [name+updatedAt], [syncStatus+updatedAt], [category+name]",
  transactions: "id, type, createdAt, timestamp, updatedAt, syncStatus, synced, [type+createdAt], [syncStatus+updatedAt], [createdAt+id], [type+timestamp], [synced+timestamp]",
  debts: "id, customerName, customer_name, phone, customer_phone, status, amountPesewas, total_owed, created_at, updatedAt, syncStatus, synced, [status+updatedAt], [customerName+status], [syncStatus+updatedAt], [status+updatedAt+id], [status+amountPesewas+id], [status+created_at]",
  customers: "id, name, nameLower, phone, totalDebtPesewas, createdAt, updatedAt"
}).upgrade(async (transaction) => {
  const customers = new Map();
  const addCustomer = (name, phone, debtPesewas = 0) => {
    const cleanName = (name ?? "").trim();
    const nameLower = cleanName.toLowerCase();
    if (!nameLower) return;

    const customer = customers.get(nameLower) ?? {
      id: createId(),
      name: cleanName,
      nameLower,
      phone: "",
      totalDebtPesewas: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    customer.phone = phone?.trim() || customer.phone;
    customer.totalDebtPesewas += debtPesewas;
    customers.set(nameLower, customer);
  };

  await transaction.table("debts").toCollection().each((debt) => {
    addCustomer(
      debt.customerName ?? debt.customer_name,
      debt.phone ?? debt.customer_phone,
      debt.status === "unpaid" ? debt.amountPesewas ?? debt.total_owed ?? 0 : 0
    );
  });
  await transaction.table("transactions").toCollection().each((record) => {
    addCustomer(record.customerName ?? record.customer_name, record.phone ?? record.customer_phone);
  });
  if (customers.size) await transaction.table("customers").bulkAdd([...customers.values()]);
});

db.version(6).stores({
  products: "++id, name, category, default_price, updatedAt, syncStatus, synced, [name+updatedAt], [syncStatus+updatedAt], [category+name]",
  transactions: "id, type, createdAt, timestamp, updatedAt, syncStatus, synced, [type+createdAt], [syncStatus+updatedAt], [createdAt+id], [type+timestamp], [synced+timestamp]",
  debts: "id, customerName, customer_name, phone, customer_phone, status, amountPesewas, total_owed, created_at, updatedAt, syncStatus, synced, [status+updatedAt], [customerName+status], [syncStatus+updatedAt], [status+updatedAt+id], [status+amountPesewas+id], [status+created_at]",
  customers: "id, name, nameLower, phone, totalDebtPesewas, createdAt, updatedAt"
}).upgrade(async (transaction) => {
  await transaction.table("transactions").toCollection().modify((record) => {
    const isCreditSale = record.type === "credit_sale" ||
      (record.type === "sale" && record.paymentType === "credit");
    if (isCreditSale) {
      const method = record.payment_method ?? record.paymentType;
      record.payment_method = method === "momo" || method === "telecel_cash" ? "momo" : "cash";
      return;
    }

    const isSale = ["sale", "cash_sale"].includes(record.type);
    const isDebtPayment = record.type === "debt_payment" ||
      (record.type === "income" && record.note?.startsWith("Debt payment"));
    const method = record.payment_method ?? record.paymentType;
    if (isSale || isDebtPayment) {
      record.payment_method = method === "momo" || method === "telecel_cash" ? "momo" : "cash";
    } else if (method === "telecel_cash") {
      record.payment_method = "momo";
    }
  });
});

export const storagePersistPromise =
  typeof navigator !== "undefined" && navigator.storage?.persist
    ? navigator.storage.persist().catch((error) => {
        console.warn("Persistent storage could not be enabled.", error);
        return false;
      })
    : Promise.resolve(false);
