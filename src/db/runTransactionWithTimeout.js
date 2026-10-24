import Dexie from "dexie";

export class SaveTimeoutError extends Error {
  constructor() {
    super("Saving took too long and was canceled.");
    this.name = "SaveTimeoutError";
  }
}

export function runTransactionWithTimeout(db, tables, operation, timeoutMs = 15000) {
  let activeTransaction;
  let timedOut = false;
  let timeoutId;
  const timeoutError = new SaveTimeoutError();
  const transactionPromise = db.transaction("rw", ...tables, async () => {
    activeTransaction = Dexie.currentTransaction;
    if (timedOut) throw timeoutError;
    return operation();
  });
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      reject(timeoutError);
      if (activeTransaction?.active) activeTransaction.abort();
    }, timeoutMs);
  });

  return Promise.race([transactionPromise, timeoutPromise])
    .finally(() => clearTimeout(timeoutId));
}
