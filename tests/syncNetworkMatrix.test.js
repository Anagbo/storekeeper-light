import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isRetryableSyncStatus,
  postSyncBatch,
  SYNC_REQUEST_TIMEOUT_MS
} from "../src/lib/syncPayload.js";

test("Ghana network matrix retries transient failures but not permanent client errors", () => {
  for (const status of [408, 425, 429, 500, 502, 503, 504]) {
    assert.equal(isRetryableSyncStatus(status), true, `HTTP ${status}`);
  }
  for (const status of [400, 401, 403, 404, 409, 422]) {
    assert.equal(isRetryableSyncStatus(status), false, `HTTP ${status}`);
  }
});

test("sync requests include the idempotency key and abort after the network deadline", async () => {
  let request;
  const response = await postSyncBatch(
    "/sync",
    { schemaVersion: 2, records: {} },
    "batch-key",
    async (_endpoint, options) => {
      request = options;
      return { ok: true, status: 200 };
    }
  );
  assert.equal(response.ok, true);
  assert.equal(request.headers["Idempotency-Key"], "batch-key");
  assert.equal(request.signal.aborted, false);

  await assert.rejects(
    postSyncBatch(
      "/sync",
      { schemaVersion: 2, records: {} },
      "slow-batch",
      (_endpoint, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
      5
    ),
    (error) => error.name === "AbortError"
  );
  assert.equal(SYNC_REQUEST_TIMEOUT_MS, 30_000);
});
