// Saved item names: trimmed, and a first word made only of lowercase letters gets a capital first
// letter ("coffee" -> "Coffee"). Words with a capital or a digit ("iPhone case", "Fanta 500ml") stay as typed.
export function cleanItemName(name) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  const first = trimmed.split(/\s+/, 1)[0];
  if (!first || first !== first.toLowerCase() || first === first.toUpperCase()) return trimmed;
  if (/[0-9]/.test(first)) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}
