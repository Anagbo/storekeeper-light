import { db } from "./db.js";
import { addSubscriptionMonths } from "../lib/subscriptionDates.js";

const USED_REFERENCES_KEY = "usedSubscriptionReferences";
const USED_REFERENCES_LIMIT = 50;

async function readUsedReferences() {
  const stored = await db.settings.get(USED_REFERENCES_KEY);
  try {
    const parsed = JSON.parse(stored?.value ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : [];
  } catch {
    return [];
  }
}

async function clearPendingPayment(reference) {
  const pending = await db.settings.get("pendingSubscriptionPayment");
  if (!pending?.value) return;
  try {
    if (JSON.parse(pending.value).reference === reference) {
      await db.settings.delete("pendingSubscriptionPayment");
    }
  } catch {
    await db.settings.delete("pendingSubscriptionPayment");
  }
}

// Client cache of a server-verified subscription payment. Display only:
// the server must be the source of truth for entitlement and used references.
// The client refuses to apply the same reference twice (B2, D3), but a wiped
// device loses this list, so the server must enforce it too.
export async function applyVerifiedSubscriptionPayment({ reference, paidAt, durationMonths }) {
  return db.transaction("rw", db.settings, async () => {
    const usedReferences = await readUsedReferences();
    const lastReference = (await db.settings.get("lastSubscriptionReference"))?.value;
    if (usedReferences.includes(reference) || lastReference === reference) {
      await clearPendingPayment(reference);
      const stored = await db.settings.get("subscriptionExpiry");
      return { applied: false, expiresAt: stored?.value ?? "" };
    }

    const current = await db.settings.get("subscriptionExpiry");
    const currentTime = Date.parse(current?.value ?? "");
    const renewalStart = Number.isFinite(currentTime) && currentTime > paidAt.getTime()
      ? currentTime
      : paidAt.getTime();
    const renewalExpiry = addSubscriptionMonths(renewalStart, durationMonths);
    if (!Number.isFinite(currentTime) || renewalExpiry.getTime() > currentTime) {
      await db.settings.put({ key: "subscriptionExpiry", value: renewalExpiry.toISOString() });
    }
    await db.settings.put({ key: "isSubscribed", value: true });
    await db.settings.put({ key: "lastSubscriptionReference", value: reference });
    await db.settings.put({
      key: USED_REFERENCES_KEY,
      value: JSON.stringify([...usedReferences, reference].slice(-USED_REFERENCES_LIMIT))
    });
    await clearPendingPayment(reference);
    const stored = await db.settings.get("subscriptionExpiry");
    return { applied: true, expiresAt: stored?.value ?? "" };
  });
}
