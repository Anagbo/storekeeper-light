// wide_layout.keyboard_and_mouse and wiring "30, 31, 28 results" (23 Nov 2026): on 30 Sale recorded, on
// a wide layout, Enter means New sale. It is ignored while a button, link or text field has focus (Enter
// there is that control's own action), while a dialog is open over the page, and for a held key.
const OWN_ENTER = "button, a[href], input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='button'], [role='link']";

export function enterMeansNewSale(event, doc = globalThis.document) {
  if (event.key !== "Enter" || event.repeat || event.isComposing) return false;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  const active = doc?.activeElement;
  if (active && active !== doc.body && active.closest?.(OWN_ENTER)) return false;
  if (doc?.querySelector?.("[role='dialog'], [role='alertdialog']")) return false;
  return true;
}
