import { db } from "../db/db.js";

const BACKUP_FORMAT_VERSION = 1;
const BACKUP_TABLES = ["transactions", "customers", "debts", "products"];
const PRIMARY_KEYS = {
  transactions: "id",
  customers: "id",
  debts: "id",
  products: "id"
};

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
    const records = backup.data[tableName];
    if (!Array.isArray(records)) {
      throw new TypeError(`The backup is missing a valid ${tableName} record list.`);
    }
    for (const record of records) {
      const id = record?.[PRIMARY_KEYS[tableName]];
      if (!record || typeof record !== "object" || Array.isArray(record) || id === undefined || id === null || id === "") {
        throw new TypeError(`The backup contains an invalid record in ${tableName}.`);
      }
      if (tableName === "products" && typeof id !== "number") {
        throw new TypeError("The backup contains a product with an invalid ID.");
      }
      if (tableName !== "products" && typeof id !== "string") {
        throw new TypeError(`The backup contains a ${tableName} record with an invalid ID.`);
      }
    }
  }
  return backup.data;
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
        const records = ["customers", "debts"].includes(tableName)
          ? data[tableName].map((record) => ({
              ...record,
              ghanaCardNumber: record.ghanaCardNumber ?? ""
            }))
          : data[tableName];
        await db.table(tableName).bulkPut(records);
      }
    }
  });
  return Object.fromEntries(BACKUP_TABLES.map((tableName) => [tableName, data[tableName].length]));
}
