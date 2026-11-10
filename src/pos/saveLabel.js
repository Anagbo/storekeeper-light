// A long customer name would wrap the Save button on 18 and 19; the button shows a short name.
export function shortSaveName(name = "") {
  const clean = String(name).trim();
  return clean.length > 10 ? clean.slice(0, 9).trimEnd() + "…" : clean;
}
