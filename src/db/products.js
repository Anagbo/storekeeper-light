import { db } from "./db.js";
import { runTransactionWithTimeout } from "./runTransactionWithTimeout.js";
import { toPesewas } from "../lib/money.js";

export const STARTER_CATEGORIES = Object.freeze([
  {
    id: "provisions",
    name: "Provisions shop",
    items: ["Bread", "Water", "Sugar", "Rice", "Cooking oil", "Soap", "Biscuits"]
  },
  {
    id: "food-drinks",
    name: "Food and drinks",
    items: ["Rice", "Tomatoes", "Eggs", "Soft drink", "Cooked food"]
  },
  {
    id: "hair-beauty",
    name: "Hair and beauty",
    items: ["Haircut", "Hair braiding", "Shampoo", "Hair cream", "Hair oil"]
  },
  {
    id: "clothes",
    name: "Clothes",
    items: ["T-shirt", "Dress", "Trousers", "Shoes"]
  },
  {
    id: "phone-airtime",
    name: "Phone and airtime",
    items: ["Airtime", "Phone case", "Phone charger", "Earphones"]
  },
  {
    id: "repairs",
    name: "Repairs",
    items: ["Phone repair", "Shoe repair", "Clothing repair", "Appliance repair"]
  },
  {
    id: "something-else",
    name: "Something else",
    items: ["Other item"]
  }
]);

export const STARTER_ITEMS = Object.freeze([
  ...new Set(STARTER_CATEGORIES.flatMap(({ items }) => items))
]);

export function getStarterItemsForCategories(categoryIds) {
  if (!Array.isArray(categoryIds)) throw new TypeError("Choose at least one starter category.");
  const selectedCategories = new Set(categoryIds);
  return STARTER_CATEGORIES
    .filter(({ id }) => selectedCategories.has(id))
    .flatMap(({ name: category, items }) => items.map((name) => ({ name, category })))
    .filter((item, index, allItems) =>
      allItems.findIndex((candidate) => candidate.name.toLowerCase() === item.name.toLowerCase()) === index
    );
}

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
  const defaultCategoryByItem = new Map();
  for (const { name: category, items } of STARTER_CATEGORIES) {
    for (const name of items) {
      if (!defaultCategoryByItem.has(name)) defaultCategoryByItem.set(name, category);
    }
  }
  const selectedItems = new Map();
  for (const entry of names) {
    const name = typeof entry === "string" ? entry.trim() : entry?.name?.trim();
    const category = (typeof entry === "string" ? undefined : entry?.category) ?? defaultCategoryByItem.get(name);
    const categoryEntry = STARTER_CATEGORIES.find((candidate) =>
      candidate.name === category && candidate.items.includes(name)
    );
    if (categoryEntry && !selectedItems.has(name.toLowerCase())) {
      selectedItems.set(name.toLowerCase(), { name, category: categoryEntry.name });
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
