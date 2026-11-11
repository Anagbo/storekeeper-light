import { useEffect, useRef } from "react";
import { formatGhs } from "../lib/money.js";
import { posText as t } from "./i18n.js";

// Wiring 16 (11 Nov 2026): leaving a sale draft that holds MoMo money already received asks first.
// Stay is the default (focused first, and what Escape and the phone back do); only Leave continues.
export default function LeaveDraftDialog({ amountPesewas, onStay, onLeave }) {
  const stayRef = useRef(null);
  const leaveRef = useRef(null);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const opener = document.activeElement;
    stayRef.current?.focus();
    return () => { if (typeof HTMLElement !== "undefined" && opener instanceof HTMLElement) opener.focus(); };
  }, []);

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onStay();
    } else if (event.key === "Tab") {
      // Keep Tab inside the two choices while the question is open.
      event.preventDefault();
      const goingBack = Boolean(event.shiftKey);
      const active = typeof document === "undefined" ? null : document.activeElement;
      const onStayButton = active === stayRef.current;
      (onStayButton !== goingBack ? leaveRef : stayRef).current?.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 p-3 sm:items-center">
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="leave-draft-question"
        onKeyDown={handleKeyDown}
        className="safe-bottom flex w-full min-w-0 max-w-md flex-col gap-3 rounded-[24px] border-[3px] border-slate-900 bg-white p-5 shadow-2xl"
      >
        <p id="leave-draft-question" className="text-xl font-extrabold text-slate-950 [overflow-wrap:anywhere]">
          {t("leaveDraft.receivedMomo", { amount: formatGhs(amountPesewas) })}
        </p>
        <button
          ref={stayRef}
          type="button"
          autoFocus
          onClick={onStay}
          className="min-h-[60px] rounded-[18px] border-[3px] border-emerald-900 bg-emerald-900 px-4 text-xl font-extrabold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
        >
          {t("leaveDraft.stay")}
        </button>
        <button
          ref={leaveRef}
          type="button"
          onClick={onLeave}
          className="min-h-[60px] rounded-[18px] border-[3px] border-slate-900 bg-white px-4 text-xl font-extrabold text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
        >
          {t("leaveDraft.leave")}
        </button>
      </section>
    </div>
  );
}
