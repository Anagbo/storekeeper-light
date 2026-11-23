// Wiring 20 "Wide keyboard" (decided 23 Nov 2026): on the combined D9 screen Enter means Done, but never
// while the cursor is in Find item or any text field, and never on a focused button or link (Enter
// presses that one). No digits: D9 has no keypad.
export function isDoneEnter(event) {
  if (!event || event.key !== "Enter" || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
  const target = event.target;
  const element = target && typeof target.matches === "function" ? target : null;
  if (element && (element.isContentEditable || element.matches("input, textarea, select, button, a[href], [role='button']"))) return false;
  return true;
}

// Wiring 15 "Keyboard" (decided 23 Nov 2026, all widths): what one key press on Sell does.
// A focused keypad key counts as no focus, so after a mouse click on the pad digits, "." and ","
// still go to the pad and Enter means Done instead of pressing that key again. Delete does what
// Backspace does. Any other focused button keeps its normal Enter and Space, and keys typed in a
// text field are never taken by the pad.
// Returns null (leave the key alone), { key } (a pad key: a digit, "." or "Delete") or { done: true }.
export function getSellKeyAction(event) {
  if (!event || event.ctrlKey || event.metaKey || event.altKey) return null;
  const target = event.target;
  const element = target && typeof target.matches === "function" ? target : null;
  const onPadKey = Boolean(element?.closest?.("[data-amount-keypad]"));
  if (element && !onPadKey && (element.isContentEditable || element.matches("input, textarea, select, button, a[href], [role='button']"))) return null;
  if (/^\d$/.test(event.key)) return { key: event.key };
  if (event.key === "." || event.key === ",") return { key: "." };
  if (event.key === "Backspace" || event.key === "Delete") return { key: "Delete" };
  if (event.key === "Enter") return { done: true };
  return null;
}
