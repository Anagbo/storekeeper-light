import { db } from "./db.js";
import { runTransactionWithTimeout } from "./runTransactionWithTimeout.js";
import { formatGhs, toPesewas } from "../lib/money.js";
import { cleanItemName } from "../lib/itemName.js";

import { findStarterItem, STARTER_CATEGORIES } from "./starterItems.js";

export { getStarterItemsForCategories, STARTER_CATEGORIES, STARTER_ITEMS } from "./starterItems.js";

// The price comes either as text (the item forms) or as whole pesewas (the 37 number pad,
// which never builds a decimal). Either way it is checked as whole pesewas.
// What the owner paid for one (wiring 40/41 COST PRICE): integer pesewas or null. Blank text is
// null, never zero; 0 is a real cost. Undefined means "not sent": the saved cost is kept.
export function normalizeCostInput({ cost, costPricePesewas }) {
  if (costPricePesewas !== undefined) {
    if (costPricePesewas === null) return null;
    if (!Number.isSafeInteger(costPricePesewas) || costPricePesewas < 0) throw new TypeError(COST_PROBLEM);
    return costPricePesewas;
  }
  if (cost === undefined) return undefined;
  if (cost === null) return null;
  const text = String(cost).trim();
  if (!text) return null;
  const pesewas = toPesewas(text);
  if (!Number.isSafeInteger(pesewas) || pesewas < 0) throw new TypeError(COST_PROBLEM);
  return pesewas;
}

const COST_PROBLEM = "Enter a valid amount for what you paid, or leave it empty.";

export function normalizeProductInput({ name, price = "", pricePesewas: givenPesewas, cost, costPricePesewas }) {
  const cleanName = cleanItemName(name);
  const hasPesewas = givenPesewas !== undefined;
  const priceText = hasPesewas ? "" : String(price).trim();
  const pricePesewas = hasPesewas ? givenPesewas : priceText ? toPesewas(priceText) : 0;
  if (!cleanName) throw new TypeError("Enter an item name.");
  if (cleanName.length > 80) throw new TypeError("Item names must be 80 characters or fewer.");
  if (!Number.isSafeInteger(pricePesewas) || ((priceText || hasPesewas) && pricePesewas <= 0)) {
    throw new TypeError(`Enter a valid item price greater than ${formatGhs(0)}.`);
  }
  const costPesewas = normalizeCostInput({ cost, costPricePesewas });
  return {
    name: cleanName,
    default_price: pricePesewas / 100,
    // Absent key: updateProduct keeps the saved cost (the 37 Set price path sends no cost).
    ...(costPesewas !== undefined && { cost_price_pesewas: costPesewas })
  };
}

// The cost snapshot for each sale line (wiring COST IS PRIVATE): the item's cost now, looked up by
// productId; null when the line has no item or the item has no cost. Old sales are never given one.
// Runs inside the sale's own transaction, so db.products must be in its table list.
export async function withCostAtSale(items) {
  const lines = [];
  for (const item of items) {
    const product = Number.isSafeInteger(item.productId) ? await db.products.get(item.productId) : null;
    const cost = product?.cost_price_pesewas;
    lines.push({ ...item, cost_at_sale_pesewas: Number.isSafeInteger(cost) && cost >= 0 ? cost : null });
  }
  return lines;
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
    category: current.category ?? details.category ?? "Other",
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
  const selectedItems = new Map();
  for (const entry of names) {
    const name = typeof entry === "string" ? entry.trim() : entry?.name?.trim();
    const requested = typeof entry === "string" ? undefined : entry?.category;
    const defaultCategory = STARTER_CATEGORIES.find((candidate) => findStarterItem(name, candidate.name))?.name;
    const category = requested && findStarterItem(name, requested) ? requested : defaultCategory;
    if (category && !selectedItems.has(name.toLowerCase())) {
      selectedItems.set(name.toLowerCase(), { name, category });
    }
  }
  return runTransactionWithTimeout(db, [db.products], async () => {
    const existing = await db.products.toArray();
    const existingNames = new Set(existing
      .filter((product) => product.active !== false)
      .map((product) => product.name.trim().toLowerCase()));
    const newItems = [...selectedItems.values()].filter((item) => !existingNames.has(item.name.toLowerCase()));
    const products = newItems.map(({ name, category }) => pendingProduct({ name, category, default_price: 0 }));
    if (products.length) await db.products.bulkAdd(products);
    return products.length;
  });
}
