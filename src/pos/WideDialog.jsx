import { useEffect, useRef } from "react";
import { useLayoutContext } from "./layout.js";
import { FOCUSABLE, focusElement, openerSelector, returnFocusTarget, trapTabTarget } from "./dialogFocus.js";

// wide_layout.page_types.dialog: every phone sheet and confirmation (25, 54, the 46 Pay sheet, the
// large-amount confirm, the leave question, the restore confirm, 42) and 37 and 38 over D9 are this
// centred dialog, 520px wide, over a dark scrim, when the layout mode is not phone. Escape and a click
// on the scrim call onClose (the sheet's Cancel or Close; Stay on the leave question). Focus starts
// inside (the sheet's own autoFocus if it has one, else the first control), Tab stays inside, and on
// close it returns to the button that opened it, or to the page's main heading when that is gone.

// True when the sheets are drawn as WideDialogs (layout mode from layout.js, never a width read).
export function useWideDialogs() {
  return useLayoutContext().wide;
}

// The open dialogs, newest last: only the top one answers Escape and Tab.
const openDialogs = [];

export default function WideDialog({ label, labelledBy, describedBy, role = "dialog", onClose, children }) {
  const panelRef = useRef(null);
  const selfRef = useRef(null);
  selfRef.current ??= {};
  // Read while rendering, before the page behind is replaced (the focused tile is gone after the commit).
  const openerRef = useRef(undefined);
  if (openerRef.current === undefined) {
    const active = typeof document === "undefined" ? null : document.activeElement;
    openerRef.current = { element: active, selector: openerSelector(active) };
  }

  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const me = selfRef.current;
    openDialogs.push(me);
    const panel = panelRef.current;
    const active = typeof document === "undefined" ? null : document.activeElement;
    if (!panel?.contains?.(active)) panel?.querySelector?.(FOCUSABLE)?.focus?.();

    const win = globalThis.window;
    function onKey(event) {
      if (openDialogs.at(-1) !== me) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      } else if (event.key === "Tab") {
        const items = [...(panelRef.current?.querySelectorAll?.(FOCUSABLE) ?? [])];
        const now = typeof document === "undefined" ? null : document.activeElement;
        const target = trapTabTarget(items, now, { shift: Boolean(event.shiftKey), inside: Boolean(panelRef.current?.contains?.(now)) });
        if (target) { event.preventDefault(); target.focus(); }
      }
    }
    win?.addEventListener?.("keydown", onKey);
    return () => {
      win?.removeEventListener?.("keydown", onKey);
      openDialogs.splice(openDialogs.indexOf(me), 1);
      if (typeof document === "undefined") return;
      const { element, selector } = openerRef.current;
      // After the commit that removed the dialog (and drew the page behind again, if it was).
      setTimeout(() => {
        const target = returnFocusTarget({ opener: element, selector, doc: document });
        const current = document.activeElement;
        // The heading is the fallback only: a page that already put focus somewhere keeps it.
        if (target && target !== element && target.tagName === "H1" && current && current !== document.body && current.isConnected) return;
        focusElement(target);
      }, 0);
    };
  }, []);

  return (
    <div
      data-wide-dialog-scrim=""
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        data-wide-dialog=""
        className="flex max-h-[calc(100dvh-32px)] w-[520px] max-w-full flex-col overflow-y-auto rounded-[24px] border-2 border-slate-300 bg-white p-6 shadow-2xl"
      >
        {children}
      </section>
    </div>
  );
}
