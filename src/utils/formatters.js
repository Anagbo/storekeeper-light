export function formatGhanaCard(value) {
  const compact = String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!compact) return "";

  if (compact === "GHA") return "";

  const digits = (compact.startsWith("GHA") ? compact.slice(3) : compact)
    .replace(/\D/g, "")
    .slice(0, 10);
  if (!digits) return "GHA-";

  const idDigits = digits.slice(0, 9);
  const checksum = digits.slice(9);
  return `GHA-${idDigits}${idDigits.length === 9 ? `-${checksum}` : ""}`;
}

// A Ghana Card number shown masked: only the last 4 characters of the number (person details).
export function maskGhanaCard(value) {
  const compact = String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length <= 4) return compact ? "••••" : "";
  return `••••${compact.slice(-4)}`;
}
