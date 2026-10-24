export function normalizeGhanaCardNumber(value) {
  return String(value ?? "").replace(/\s+/g, "").toUpperCase();
}

export function isValidGhanaCardNumber(value) {
  const normalized = normalizeGhanaCardNumber(value);
  return normalized === "" || /^(?:GHA-\d{9}-\d|\d{10})$/.test(normalized);
}
