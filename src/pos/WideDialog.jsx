import { useEffect, useRef } from "react";

// wide_layout.page_types.dialog: a centred dialog 520px wide over a dark scrim. Escape and a click on
// the scrim call onClose (37 and 38 over D9: Back). Focus starts inside and Tab stays inside.
const FOCUSABLE = "button:not([disabled]), input:not([disabled]), select, textarea, a[href], [tabindex]:not([tabindex='-1'])";

export default function WideDialog({ label, onClose, children }) {
  const panelRef = useRef(null);

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
