// Phone search rule (rules_global.phone_search): a Ghana number typed as 024 123 4567, 24 123 4567,
// +233 24 123 4567, 233 24 123 4567 or 00233 24 123 4567 finds the same person, whatever form the
// number was stored in. No imports. Never changes stored data.

// Digits only, then a leading 00233 or 233 removed, then one leading 0 removed: 241234567.
export function nationalNumber(value) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("00233")) digits = digits.slice(5);
  else if (digits.startsWith("233")) digits = digits.slice(3);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return digits;
}

// Case and spaces do not matter in a name search.
export function squashSearchText(value) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, "");
}

const HAS_LETTER = /\p{L}/u;

// A search with letters is a name search. Without letters it is a phone search, and when nothing
// is left after cleaning ("0", "+", "233", "00233", spaces) it is no search at all: nobody is hidden.
export function hasSearchText(query) {
  const text = String(query ?? "");
  if (HAS_LETTER.test(text)) return squashSearchText(text) !== "";
  return nationalNumber(text) !== "";
}

// True when the person (name, phone) matches the typed text. No search matches everyone.
export function matchesSearch(query, name, phone) {
  const text = String(query ?? "");
  if (!hasSearchText(text)) return true;
  const wanted = squashSearchText(text);
  if (squashSearchText(name).includes(wanted)) return true;
  if (HAS_LETTER.test(text)) return squashSearchText(phone).includes(wanted);
  const national = nationalNumber(text);
  return nationalNumber(phone).includes(national) || squashSearchText(phone).includes(wanted);
}
