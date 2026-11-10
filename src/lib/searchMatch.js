// The matching rule of the name-or-phone search on 17 (Who owes you?) and 32 (People who owe you):
// case and spaces do not matter ("kofi b" finds "Kofi Boateng", "020 123" finds 0201234567).
// No imports.
export function squashSearchText(value) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, "");
}

// A search with only spaces is no search.
export function hasSearchText(query) {
  return squashSearchText(query) !== "";
}

// True when the squashed query is inside any of the squashed fields (name, phone). No search matches everyone.
export function matchesSearch(query, ...fields) {
  const wanted = squashSearchText(query);
  if (!wanted) return true;
  return fields.some((field) => squashSearchText(field).includes(wanted));
}