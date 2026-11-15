import { db } from "../db/db.js";
import { recalculateCustomerDebtBalance } from "../db/debtLedger.js";

const BACKUP_FORMAT_VERSION = 1;
const BACKUP_TABLES = ["transactions", "customers", "debts", "products", "payments", "suppliers"];
const PRIMARY_KEYS = {
  transactions: "id",
  customers: "id",
  debts: "id",
  products: "id",
  payments: "id",
  suppliers: "id"
};

// The ledger is append-only: a restore may add missing rows but never change a saved one (D4).
// Debts are included so a backup cannot change a stored debt balance (Batch 6b).
const LEDGER_TABLES = new Set(["transactions", "payments", "debts"]);
const TRANSACTION_TYPES = new Set([
  "sale", "cash_sale", "credit_sale", "installment_sale", "installment_addon",
  "income", "income_reversal", "debt_payment", "expense", "supplier_payment",
  "manual_debt", "debt_adjustment"
]);
const PAYMENT_METHODS = new Set(["cash", "momo"]);
const DEBT_STATUSES = new Set(["unpaid", "paid"]);
const RESTORE_LOG_KEY = "backupRestoreLog";
const RESTORE_LOG_LIMIT = 20;

function isPesewas(value, { positive = false } = {}) {
  return Number.isSafeInteger(value) && (positive ? value > 0 : value >= 0);
}

function validateRecordValues(tableName, record) {
  const amountFields = { transactions: ["amountPesewas", "total_amount"], payments: ["amountPesewas"], debts: ["amountPesewas", "total_owed"] }[tableName] ?? [];
  for (const field of amountFields) {
    const required = tableName === "payments";
    if (record[field] === undefined && !required) continue;
    if (!isPesewas(record[field], { positive: tableName === "payments" })) {
      throw new TypeError(`The backup contains a ${tableName} record with an invalid amount.`);
    }
  }
  // The amount confirmed on 62, stored next to the saved MoMo amount (brief 3.8 rule 2).
  if (record.momoConfirmedPesewas !== undefined && !isPesewas(record.momoConfirmedPesewas)) {
    throw new TypeError(`The backup contains a ${tableName} record with an invalid amount.`);
  }
  if (tableName === "transactions" && record.type !== undefined && !TRANSACTION_TYPES.has(record.type)) {
    throw new TypeError("The backup contains an unknown transaction type.");
  }
  if (tableName === "payments" && !PAYMENT_METHODS.has(record.paymentMethod)) {
    throw new TypeError("The backup contains an unknown payment method.");
  }
  if (tableName === "debts" && record.status !== undefined && !DEBT_STATUSES.has(record.status)) {
    throw new TypeError("The backup contains an unknown debt status.");
  }
}

export function shouldRestoreBackupRecord(existing, incoming) {
  if (!existing) return true;
  if (Number.isFinite(existing.updatedAt) && Number.isFinite(incoming.updatedAt)) {
    return existing.updatedAt <= incoming.updatedAt;
  }
  return true;
}

function localTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("") + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function validateBackupData(backup) {
  if (
    !backup ||
    typeof backup !== "object" ||
    backup.app !== "StoreKeeper Light" ||
    backup.formatVersion !== BACKUP_FORMAT_VERSION ||
    !backup.data ||
    typeof backup.data !== "object"
  ) {
    throw new TypeError("This is not a supported StoreKeeper Light backup file.");
  }

  for (const tableName of BACKUP_TABLES) {
    const records = backup.data[tableName] ?? (["payments", "suppliers"].includes(tableName) ? [] : undefined);
    if (!Array.isArray(records)) {
      throw new TypeError(`The backup is missing a valid ${tableName} record list.`);
    }
    const ids = new Set();
    for (const record of records) {
      const id = record?.[PRIMARY_KEYS[tableName]];
      if (!record || typeof record !== "object" || Array.isArray(record) || id === undefined || id === null || id === "") {
        throw new TypeError(`The backup contains an invalid record in ${tableName}.`);
      }
      if (ids.has(id)) {
        throw new TypeError(`The backup contains duplicate IDs in ${tableName}.`);
      }
      ids.add(id);
      if (tableName === "products" && typeof id !== "number") {
        throw new TypeError("The backup contains a product with an invalid ID.");
      }
      if (tableName !== "products" && typeof id !== "string") {
        throw new TypeError(`The backup contains a ${tableName} record with an invalid ID.`);
      }
    }
  }
  const customerIds = new Set(backup.data.customers.map((record) => record.id));
  const debtIds = new Set(backup.data.debts.map((record) => record.id));
  for (const debt of backup.data.debts) {
    if (debt.customerId !== undefined && !customerIds.has(debt.customerId)) {
      throw new TypeError(`The backup contains a debt with an unknown customer ID.`);
    }
  }
  for (const payment of backup.data.payments ?? []) {
    if (payment.debtId !== undefined && !debtIds.has(payment.debtId)) {
      throw new TypeError(`The backup contains a payment with an unknown debt ID.`);
    }
  }
  // Amounts, types, methods and statuses are checked after IDs and relationships.
  for (const tableName of BACKUP_TABLES) {
    for (const record of backup.data[tableName] ?? []) validateRecordValues(tableName, record);
  }
  return { ...backup.data, payments: backup.data.payments ?? [], suppliers: backup.data.suppliers ?? [] };
}

export async function exportDatabaseToJson() {
  const data = {};
  await db.transaction("r", ...BACKUP_TABLES.map((tableName) => db.table(tableName)), async () => {
    for (const tableName of BACKUP_TABLES) {
      data[tableName] = await db.table(tableName).toArray();
    }
  });

  const now = new Date();
  const backup = {
    app: "StoreKeeper Light",
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    data
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `storekeeper_backup_${localTimestamp(now)}.json`;
  link.style.display = "none";
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return backup;
}

export async function importDatabaseFromJson(jsonFile) {
  if (!jsonFile || typeof jsonFile.text !== "function") {
    throw new TypeError("Choose a backup JSON file to restore.");
  }
  const contents = await jsonFile.text();
  let backup;
  try {
    backup = JSON.parse(contents);
  } catch {
    throw new TypeError("The selected file is not valid JSON.");
  }
  const data = validateBackupData(backup);
  const added = Object.fromEntries(BACKUP_TABLES.map((tableName) => [tableName, 0]));
  let skippedLedgerRows = 0;

  await db.transaction("rw", ...BACKUP_TABLES.map((tableName) => db.table(tableName)), db.settings, async () => {
    for (const tableName of BACKUP_TABLES) {
      if (data[tableName].length) {
        const incomingRecords = ["customers", "debts"].includes(tableName)
          ? data[tableName].map((record) => ({
              ...record,
              ghanaCardNumber: record.ghanaCardNumber ?? ""
            }))
          : data[tableName];
        const table = db.table(tableName);
        const existingRecords = await table.bulkGet(incomingRecords.map((record) => record[PRIMARY_KEYS[tableName]]));
        const isLedger = LEDGER_TABLES.has(tableName);
        const records = incomingRecords.filter((record, index) => {
          if (isLedger && existingRecords[index]) {
            skippedLedgerRows += 1;
            return false;
          }
          return shouldRestoreBackupRecord(existingRecords[index], record);
        });
        if (!records.length) continue;
        if (isLedger) await table.bulkAdd(records);
        else await table.bulkPut(records);
        added[tableName] = records.length;
      }
    }
    // A customer's total owed is derived from the debts on this phone, never taken
    // from the backup file (Batch 6b).
    const customerIds = new Set([
      ...data.customers.map((record) => record.id),
      ...data.debts.map((record) => record.customerId).filter((id) => typeof id === "string" && id)
    ]);
    for (const customerId of customerIds) {
      if (await db.customers.get(customerId)) {
        await recalculateCustomerDebtBalance({ customerId }, db);
      }
    }
    // Local record of each restore. Not synced: a real audit trail needs the server.
    const stored = await db.settings.get(RESTORE_LOG_KEY);
    let log = [];
    try {
      const parsed = JSON.parse(stored?.value ?? "[]");
      log = Array.isArray(parsed) ? parsed : [];
    } catch {
      log = [];
    }
    log.push({ restoredAt: new Date().toISOString(), exportedAt: typeof backup.exportedAt === "string" ? backup.exportedAt : "", added, skippedLedgerRows });
    await db.settings.put({ key: RESTORE_LOG_KEY, value: JSON.stringify(log.slice(-RESTORE_LOG_LIMIT)) });
  });
  return {
    ...Object.fromEntries(BACKUP_TABLES.map((tableName) => [tableName, data[tableName].length])),
    skippedLedgerRows
  };
}

// Message for the restore screen. Counts are records in the backup file; skipped
// ledger rows were already on this phone and were kept unchanged (D4).
export function describeRestoreResult(result) {
  const total = BACKUP_TABLES.reduce((sum, tableName) => sum + (Number.isSafeInteger(result?.[tableName]) ? result[tableName] : 0), 0);
  const skipped = Number.isSafeInteger(result?.skippedLedgerRows) ? result.skippedLedgerRows : 0;
  const base = `Backup restored and merged (${total} records).`;
  if (skipped === 0) return base;
  return skipped === 1
    ? `${base} 1 saved sale, payment or debt was already on this phone and was kept as it is.`
    : `${base} ${skipped} saved sales, payments or debts were already on this phone and were kept as they are.`;
}
