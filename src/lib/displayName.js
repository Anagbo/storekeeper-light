// A person's or supplier's name as shown on screen: the first letter in capitals ("kofi wholesale"
// shows as "Kofi wholesale"). Only the display changes; the stored name is never rewritten.
export function displayName(name) {
  const text = String(name ?? "").trim();
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}
