import { db } from "./db.js";
import { runTransactionWithTimeout } from "./runTransactionWithTimeout.js";
import { getCreditEventAmountPesewas, getCreditReason, isCreditEvent } from "../lib/creditReason.js";
import { hasSignatureFields, isValidSignature, thinSignature } from "../lib/signature.js";

// Done on 72: the signature goes on the credit event's transactions row with a snapshot of the amount
// and the reason as they are now. Only those four fields are written: updatedAt, synced and syncStatus
// are left alone, so signing never marks the event pending. An event already signed is never replaced.
export async function signCreditEvent({ transactionId, strokes, now = Date.now() }) {
  const signature = thinSignature(strokes);
  if (!isValidSignature(signature)) throw new TypeError("Draw a signature first.");
  return runTransactionWithTimeout(db, [db.transactions], async () => {
    const record = transactionId ? await db.transactions.get(transactionId) : null;
    if (!isCreditEvent(record)) throw new Error("This credit could not be found.");
    if (hasSignatureFields(record)) throw new Error("This credit is already signed.");
    const fields = {
      signature,
      signedAt: now,
      signedAmountPesewas: getCreditEventAmountPesewas(record),
      signedReason: getCreditReason(record)
    };
    await db.transactions.update(transactionId, fields);
    return { ...record, ...fields };
  });
}
