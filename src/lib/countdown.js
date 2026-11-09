// Whole seconds left until `expiresAt` (a time in ms), never below 0. A countdown that is
// recomputed from the clock on every tick stays right when the browser slows a background
// tab, unlike one that subtracts 1 per tick.
export function secondsUntil(expiresAt, now) {
  if (!Number.isFinite(expiresAt) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}