const TABLES = ["products", "transactions", "debts"];
export const SYNC_REQUEST_TIMEOUT_MS = 30_000;

export function createSyncPayload(records) {
  const normalizedRecords = Object.fromEntries(
    TABLES.map((tableName) => [
      tableName,
      (records[tableName] || [])
        .slice()
        .sort((left, right) => String(left.id).localeCompare(String(right.id)))
    ])
  );
  const body = { schemaVersion: 2, records: normalizedRecords };
  return { body, serializedBody: JSON.stringify(body) };
}

export async function createIdempotencyKey(serializedBody) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(serializedBody)
  );
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `storekeeper-sync-v2-${hash}`;
}

export function isRetryableSyncStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export async function postSyncBatch(
  endpoint,
  body,
  idempotencyKey,
  fetchImpl = fetch,
  timeoutMs = SYNC_REQUEST_TIMEOUT_MS
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) {
      const error = new Error(`Sync server returned HTTP ${response.status}.`);
      error.status = response.status;
      error.retryable = isRetryableSyncStatus(response.status);
      throw error;
    }
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

export { TABLES };
