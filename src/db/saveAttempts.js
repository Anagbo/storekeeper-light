import { fingerprintSave } from "../lib/saveAttempt.js";
import { runTransactionWithTimeout } from "./runTransactionWithTimeout.js";
import { db as defaultDb } from "./db.js";

// D11: one key per save attempt. The writer records the attempt key, a fingerprint of the
// content and the result in the same transaction as the save. A second save with the same
// key returns the stored result and writes nothing; with different content it is refused.
// Kept in `settings` (not synced, not in backups); only the last SAVE_ATTEMPT_LIMIT kept.
export const SAVE_ATTEMPT_KEY_PREFIX = "saveAttempt:";
export const SAVE_ATTEMPT_LIMIT = 50;

export class SaveAttemptMismatchError extends Error {
  constructor() {
    super("This save attempt was already used for different details.");
    this.name = "SaveAttemptMismatchError";
  }
}

export function runIdempotentSave({ db = defaultDb, tables, attemptId, content, now = Date.now() }, operation) {
  if (attemptId === undefined || attemptId === null || attemptId === "") {
    return runTransactionWithTimeout(db, tables, operation);
  }
  if (typeof attemptId !== "string") throw new TypeError("A save attempt key must be text.");
  const key = `${SAVE_ATTEMPT_KEY_PREFIX}${attemptId}`;
  const fingerprint = fingerprintSave(content);

  return runTransactionWithTimeout(db, [...tables, db.settings], async () => {
    const stored = await db.settings.get(key);
    if (stored) {
      if (stored.value?.fingerprint !== fingerprint) throw new SaveAttemptMismatchError();
      return stored.value.result;
    }
    const result = await operation();
    await db.settings.put({ key, value: { fingerprint, result, savedAt: now } });
    const attempts = await db.settings.where(":id").startsWith(SAVE_ATTEMPT_KEY_PREFIX).toArray();
    if (attempts.length > SAVE_ATTEMPT_LIMIT) {
      attempts.sort((left, right) => (left.value?.savedAt ?? 0) - (right.value?.savedAt ?? 0));
      await db.settings.bulkDelete(attempts.slice(0, attempts.length - SAVE_ATTEMPT_LIMIT).map((row) => row.key));
    }
    return result;
  });
}