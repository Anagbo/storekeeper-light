export const SYNC_CONFLICT_POLICIES = Object.freeze({
  products: "manual-review",
  transactions: "append-only",
  debts: "manual-review"
});

const SYNC_FIELDS = new Set(["syncStatus", "synced"]);

function comparableRecord(record) {
  return Object.fromEntries(
    Object.entries(record || {})
      .filter(([key]) => !SYNC_FIELDS.has(key))
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function recordsMatch(left, right) {
  return JSON.stringify(comparableRecord(left)) === JSON.stringify(comparableRecord(right));
}

export function classifySyncRecord(tableName, existingRecord, incomingRecord) {
  if (!existingRecord) return { action: "accept", reason: "new-record" };
  if (recordsMatch(existingRecord, incomingRecord)) {
    return { action: "acknowledge", reason: "idempotent-duplicate" };
  }
  if (tableName === "transactions") {
    return { action: "conflict", reason: "immutable-record-changed" };
  }
  return { action: "conflict", reason: "mutable-record-version-conflict" };
}
