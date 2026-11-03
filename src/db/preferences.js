import { db } from "./db.js";
import { runTransactionWithTimeout } from "./runTransactionWithTimeout.js";

export async function getPreference(key, fallback = null) {
  const record = await db.settings.get(key);
  return record?.value ?? fallback;
}

export async function setPreference(key, value) {
  if (typeof key !== "string" || !key.trim()) throw new TypeError("A preference key is required.");
  return runTransactionWithTimeout(db, [db.settings], async () => {
    await db.settings.put({ key, value });
    return value;
  });
}

export async function saveSellMode(sellMode) {
  if (!["numbers", "items"].includes(sellMode)) {
    throw new TypeError("Choose numbers or items as the sell mode.");
  }
  return setPreference("sellMode", sellMode);
}

export async function shouldShowPosSetup() {
  if (await getPreference("posSetupCompleted", false)) return false;
  const [products, transactions, debts, customers, suppliers] = await Promise.all([
    db.products.count(),
    db.transactions.count(),
    db.debts.count(),
    db.customers.count(),
    db.suppliers.count()
  ]);
  return products + transactions + debts + customers + suppliers === 0;
}
