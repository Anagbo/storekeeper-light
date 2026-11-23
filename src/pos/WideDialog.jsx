import { useEffect, useRef } from "react";

// wide_layout.page_types.dialog: a centred dialog 520px wide over a dark scrim. Escape and a click on
// the scrim call onClose (37 and 38 over D9: Back). Focus starts inside and Tab stays inside.
const FOCUSABLE = "button:not([disabled]), input:not([disabled]), select, textarea, a[href], [tabindex]:not([tabindex='-1'])";

// What opened the dialog, found again when it closes: the page behind is drawn again under the dialog
// (so the tile that had focus is a new element), and a tile's label changes when its item is added.
function openerSelector(el) {
  if (!el || el === document.body) return null;
  if (el.hasAttribute("data-item-tile")) return `[data-item-tile="${CSS.escape(el.getAttribute("data-item-tile"))}"]`;
  for (const attr of ["data-other-amount", "data-split-55"]) if (el.hasAttribute(attr)) return `[${attr}]`;
  const label = el.getAttribute("aria-label");
  return label ? `[aria-label="${CSS.escape(label)}"]` : null;
}

function focusOpener(selector) {
  const target = selector && [...document.querySelectorAll(selector)].find((el) => !el.closest("[inert]") && !el.disabled);
  if (target) target.focus();
}

export default function WideDialog({ label, onClose, children }) {
  const panelRef = useRef(null);
  // Read while rendering, before the page behind is replaced (the focused tile is gone after the commit).
  const openerRef = useRef(undefined);
  if (openerRef.current === undefined) openerRef.current = typeof document === "undefined" ? null : openerSelector(document.activeElement);

  // When the dialog closes, focus goes back to the tile or button that opened it.
  useEffect(() => () => {
    const selector = openerRef.current;
    if (typeof document !== "undefined") setTimeout(() => focusOpener(selector), 0);
  }, []);

  useEffect(() => {
    const first = panelRef.current?.querySelector?.(FOCUSABLE);
    first?.focus?.();
  }, []);

  // Escape closes wherever the focus is (also after a click on the panel's plain text).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const win = globalThis.window;
    if (!win?.addEventListener) return undefined;
    function onKey(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeRef.current();
    }
    win.addEventListener("keydown", onKey);
    return () => win.removeEventListener("keydown", onKey);
  }, []);

  function handleKeyDown(event) {
    if (event.key === "Tab") {
      const items = [...(panelRef.current?.querySelectorAll?.(FOCUSABLE) ?? [])];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = typeof document === "undefined" ? null : document.activeElement;
      if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    }
  }

  return (
    <div
      data-wide-dialog-scrim=""
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onKeyDown={handleKeyDown}
        className="flex max-h-[calc(100dvh-32px)] w-[520px] max-w-full flex-col overflow-y-auto rounded-[24px] border-2 border-slate-300 bg-white p-6 shadow-2xl"
      >
        {children}
      </section>
    </div>
  );
}
