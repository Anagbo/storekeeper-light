export function normalizeTrialDays(value) {
  const days = Number(value);
  return Number.isInteger(days) && days > 0 ? days : 0;
}

export function getEffectiveTrialNow(now, lastObservedAt) {
  const observedTimestamp = Date.parse(lastObservedAt ?? "");
  return Number.isFinite(observedTimestamp) ? Math.max(now, observedTimestamp) : now;
}

export function getTrialExpiry(startedAt, trialDays) {
  const startTimestamp = Date.parse(startedAt ?? "");
  if (!Number.isFinite(startTimestamp) || trialDays <= 0) return "";
  return new Date(startTimestamp + trialDays * 24 * 60 * 60 * 1000).toISOString();
}
