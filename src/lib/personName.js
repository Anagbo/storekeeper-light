// rules_global.form_fields (25 Nov 2026): a customer, person or supplier name is tidied when it is saved:
// spaces at the ends and runs of spaces go, and every word (also after a hyphen) starts with a capital.
// The rest of each word is kept as typed, so "kennedy junior Anagbo" becomes "Kennedy Junior Anagbo"
// and "Kofi McDonald" stays as it is.
export function tidyPersonName(name) {
  return String(name ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/(^|[\s-])(\S)/gu, (_, before, letter) => before + letter.toLocaleUpperCase());
}
