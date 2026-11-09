import Dexie from "dexie";

export const SAVE_TIMEOUT_MS = 15000;
export const SAVE_OUTCOME_GRACE_MS = 5000;

// Thrown only when the save is known NOT to be recorded (the transaction was cancelled).
export class SaveTimeoutError extends Error {
  constructor() {
    super("Saving took too long and was canceled.");
    this.name = "SaveTimeoutError";
  }
}

// Thrown when the timeout passed and the transaction still has not said whether it was
// recorded (D11). The caller must not say "not recorded"; a retry must reuse the same
// save attempt key so it cannot record twice.
export class SaveOutcomeUnknownError extends Error {
  constructor() {
    super("The save could not be confirmed.");
    this.name = "SaveOutcomeUnknownError";
  }
}

// D11: when the timer fires, cancel the transaction and then wait (up to graceMs) for its
// real result. A transaction that still commits is a success; a cancelled one is a
// SaveTimeoutError; no answer at all is a SaveOutcomeUnknownError.
export function runTransactionWithTimeout(db, tables, operation, timeoutMs = SAVE_TIMEOUT_MS, graceMs = SAVE_OUTCOME_GRACE_MS) {
  let activeTransaction;
  let timedOut = false;
  let timeoutId;
  let graceId;
  const transactionPromise = db.transaction("rw", ...tables, async () => {
    activeTransaction = Dexie.currentTransaction;
    if (timedOut) throw new SaveTimeoutError();
    return operation();
  });
  // Keep a late rejection from being reported as unhandled.
  transactionPromise.catch(() => {});

  const timeoutPromise = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      try {
        if (activeTransaction?.active) activeTransaction.abort();
      } catch {
        // Already finishing: the transaction promise reports what happened.
      }
      resolve();
    }, timeoutMs);
  });

  const raced = Promise.race([
    transactionPromise.then((value) => ({ settled: true, value })),
    timeoutPromise.then(() => ({ settled: false }))
  ]);

  return raced.then((first) => {
    clearTimeout(timeoutId);
    if (first.settled) return first.value;
    return Promise.race([
      transactionPromise.then(
        (value) => value,
        () => { throw new SaveTimeoutError(); }
      ),
      new Promise((_, reject) => {
        graceId = setTimeout(() => reject(new SaveOutcomeUnknownError()), graceMs);
      })
    ]).finally(() => clearTimeout(graceId));
  }, (error) => {
    clearTimeout(timeoutId);
    throw error;
  });
}