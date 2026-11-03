import { db } from "./db.js";
import { runTransactionWithTimeout } from "./runTransactionWithTimeout.js";
import { toPesewas } from "../lib/money.js";

export const STARTER_ITEMS = Object.freeze([
  "Bread",
  "Water",
  "Sugar",
  "Rice",
  "Cooking oil",
  "Soap",
  "Biscuits"
]);

export function normalizeProductInput({ name, price = "" }) {
  const cleanName = typeof name === "string" ? name.trim() : "";
  const priceText = String(price).trim();
  const pricePesewas = priceText ? toPesewas(priceText) : 0;
  if (!cleanName) throw new TypeError("Enter an item name.");
  if (cleanName.length > 80) throw new TypeError("Item names must be 80 characters or fewer.");
  if (!Number.isSafeInteger(pricePesewas) || (priceText && pricePesewas <= 0)) {
    throw new TypeError("Enter a valid item price greater than GHS 0.00.");
  }
  return {
    name: cleanName,
    default_price: pricePesewas / 100
  };
}

async function assertUniqueProductName(name, excludedId) {
  const products = await db.products.toArray();
  const duplicate = products.find((product) =>
    product.id !== excludedId &&
    product.active !== false &&
    product.name.trim().toLowerCase() === name.toLowerCase()
  );
  if (duplicate) throw new TypeError("An item with this name already exists.");
}

function pendingProduct(details, current = {}) {
  const now = Date.now();
  return {
    ...current,
    ...details,
    category: current.category ?? "Other",
    unit: current.unit ?? "unit",
    active: true,
    updatedAt: now,
    synced: false,
    syncStatus: "pending"
  };
}

export async function createProduct(input) {
  const details = normalizeProductInput(input);
  return runTransactionWithTimeout(db, [db.products], async () => {
    await assertUniqueProductName(details.name);
    const id = await db.products.add(pendingProduct(details));
    return db.products.get(id);
  });
}

export async function updateProduct(productId, input) {
  if (!Number.isSafeInteger(productId)) throw new TypeError("Choose a valid item.");
  const details = normalizeProductInput(input);
  return runTransactionWithTimeout(db, [db.products], async () => {
    const current = await db.products.get(productId);
    if (!current || current.active === false) throw new TypeError("This item is no longer available.");
    await assertUniqueProductName(details.name, productId);
    await db.products.update(productId, pendingProduct(details, current));
    return db.products.get(productId);
  });
}

export async function removeProduct(productId) {
  if (!Number.isSafeInteger(productId)) throw new TypeError("Choose a valid item.");
  return runTransactionWithTimeout(db, [db.products], async () => {
    const current = await db.products.get(productId);
    if (!current || current.active === false) throw new TypeError("This item is no longer available.");
    await db.products.update(productId, {
      active: false,
      updatedAt: Date.now(),
      synced: false,
      syncStatus: "pending"
    });
  });
}

export async function addStarterProducts(names) {
  if (!Array.isArray(names)) throw new TypeError("Choose items from the starter list.");
  const selectedNames = [...new Set(names
    .filter((name) => typeof name === "string")
    .map((name) => name.trim())
    .filter((name) => STARTER_ITEMS.includes(name)))];
  return runTransactionWithTimeout(db, [db.products], async () => {
    const existing = await db.products.toArray();
    const existingNames = new Set(existing
      .filter((product) => product.active !== false)
      .map((product) => product.name.trim().toLowerCase()));
    const newNames = selectedNames.filter((name) => !existingNames.has(name.toLowerCase()));
    const products = newNames.map((name) => pendingProduct({ name, default_price: 0 }));
    if (products.length) await db.products.bulkAdd(products);
    return products.length;
  });
}
