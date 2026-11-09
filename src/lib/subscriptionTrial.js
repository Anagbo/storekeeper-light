export function normalizeTrialDays(value) {
  const days = Number(value);
  return Number.isInteger(days) && days > 0 ? days : 0;
}

export function getEffectiveTrialNow(now, lastObservedAt) {
  const observedTimestamp = Date.parse(lastObservedAt ?? "");
  return Number.isFinite(observedTimestamp) ? Math.max(now, observedTimestamp) : now;
}

// Is the saved expiry still in the future? The clock used is the later of "now" and the last
// time the app was seen running, so setting the device clock back does not bring an expired
// subscription back (D12). A display cache only: the server decides entitlement.
export function isSubscriptionActive(expiry, now, lastObservedAt) {
  const expiryTimestamp = Date.parse(expiry ?? "");
  return Number.isFinite(expiryTimestamp) && expiryTimestamp > getEffectiveTrialNow(now, lastObservedAt);
}

export function getTrialExpiry(startedAt, trialDays) {
  const startTimestamp = Date.parse(startedAt ?? "");
  if (!Number.isFinite(startTimestamp) || trialDays <= 0) return "";
  return new Date(startTimestamp + trialDays * 24 * 60 * 60 * 1000).toISOString();
}
