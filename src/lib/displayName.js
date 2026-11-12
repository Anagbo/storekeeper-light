// A person's or supplier's name as shown on screen (wiring rules_global.person_names). A name stored
// all lower case or all upper case is shown in Title Case (also after a hyphen): "kofi mensah" and "KOFI MENSAH" both show
// "Kofi Mensah". A name typed in mixed case ("Nana Yaa", "Kofi McDonald") is shown as typed with a
// capital first letter. Only the display changes; the stored name is never rewritten.
export function displayName(name) {
  const text = String(name ?? "").trim();
  const lower = text.toLocaleLowerCase();
  const upper = text.toLocaleUpperCase();
  if (lower === upper) return text;
  if (text === lower || text === upper) {
    return lower.replace(/(^|[\s-])(\S)/gu, (_, space, letter) => space + letter.toLocaleUpperCase());
  }
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}
