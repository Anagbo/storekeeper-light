// wide_layout.page_types.dialog: focus rules for the wide dialogs (WideDialog.jsx). Plain functions over
// DOM-like objects, so tests can check them without a browser.
export const FOCUSABLE = "button:not([disabled]), input:not([disabled]), select, textarea, a[href], [tabindex]:not([tabindex='-1'])";

const escape = (value) => (globalThis.CSS?.escape ? globalThis.CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&"));

// What opened the dialog, found again when it closes if the element itself is gone: the page behind may
// be drawn again under the dialog (so the tile that had focus is a new element), and a tile's label
// changes when its item is added.
export function openerSelector(el) {
  if (!el?.hasAttribute || !el.getAttribute) return null;
  if (el.hasAttribute("data-item-tile")) return `[data-item-tile="${escape(el.getAttribute("data-item-tile"))}"]`;
  for (const attr of ["data-other-amount", "data-split-55"]) if (el.hasAttribute(attr)) return `[${attr}]`;
  const label = el.getAttribute("aria-label");
  return label ? `[aria-label="${escape(label)}"]` : null;
}

// Usable for focus: still on the page, not disabled, not behind an inert layer, not inside a dialog.
function usable(el) {
  if (!el || el.isConnected === false || el.disabled) return false;
  if (el.closest?.("[inert], [data-wide-dialog-scrim]")) return false;
  return typeof el.focus === "function";
}

// The page's main heading: the first h1 in the page area outside any dialog.
export function mainHeading(doc) {
  const headings = [...(doc?.querySelectorAll?.("[data-page-area] h1, main h1") ?? [])];
  return headings.find((el) => usable(el)) ?? null;
}

// Where focus goes when a dialog closes: the button that opened it; else the same control drawn again
// (openerSelector); else, when the opener is not on the page behind, that page's main heading.
export function returnFocusTarget({ opener, selector, doc }) {
  if (usable(opener) && !(doc?.body && opener === doc.body)) return opener;
  const again = selector ? [...(doc?.querySelectorAll?.(selector) ?? [])].find(usable) : null;
  if (again) return again;
  return mainHeading(doc);
}

export function focusElement(el) {
  if (!el) return;
  // A heading is not focusable by itself; tabindex -1 lets focus land there without adding a Tab stop.
  if (/^H[1-6]$/.test(el.tagName ?? "") && !el.hasAttribute?.("tabindex")) el.setAttribute?.("tabindex", "-1");
  el.focus();
}

// Tab inside the dialog: from the last control to the first, Shift+Tab from the first to the last, and
// back inside when focus has left the panel (after a click on its plain text). Returns the control to
// focus, or null when the browser's own Tab stays inside.
export function trapTabTarget(items, active, { shift = false, inside = true } = {}) {
  if (!items.length) return null;
  const first = items[0];
  const last = items[items.length - 1];
  if (!inside) return shift ? last : first;
  if (shift && active === first) return last;
  if (!shift && active === last) return first;
  return null;
}
