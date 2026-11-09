export function addSubscriptionMonths(date, months) {
  const expiry = new Date(date);
  const originalDay = expiry.getUTCDate();
  expiry.setUTCDate(1);
  expiry.setUTCMonth(expiry.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth() + 1, 0)).getUTCDate();
  expiry.setUTCDate(Math.min(originalDay, lastDay));
  return expiry;
}
