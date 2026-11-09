import { db } from "../db/db.js";

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

  await db.transaction("rw", ...BACKUP_TABLES.map((tableName) => db.table(tableName)), async () => {
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
        const records = incomingRecords.filter((record, index) => (
          shouldRestoreBackupRecord(existingRecords[index], record)
        ));
        if (!records.length) continue;
        await table.bulkPut(records);
      }
    }
  });
  return Object.fromEntries(BACKUP_TABLES.map((tableName) => [tableName, data[tableName].length]));
}
