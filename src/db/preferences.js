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

// rules_global.hide_amounts: one shared setting for Home (22) and My money (33). Amounts are shown
// by default; only a stored true hides them. Carried in backup and restore (settings.hideAmounts).
export const HIDE_AMOUNTS_PREFERENCE = "hideAmounts";

export async function loadHideAmounts() {
  return (await getPreference(HIDE_AMOUNTS_PREFERENCE, false)) === true;
}

export async function saveHideAmounts(hidden) {
  if (typeof hidden !== "boolean") throw new TypeError("Hide amounts must be true or false.");
  return setPreference(HIDE_AMOUNTS_PREFERENCE, hidden);
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
