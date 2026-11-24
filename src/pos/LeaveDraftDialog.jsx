import { useEffect, useRef } from "react";
import { formatGhs } from "../lib/money.js";
import { posText as t } from "./i18n.js";
import { LeaveButton, PosPrimaryButton } from "./PosComponents.jsx";
import WideDialog, { useWideDialogs } from "./WideDialog.jsx";

// Wiring 16 (11 Nov 2026): leaving a sale draft that holds MoMo money already received asks first.
// Stay is the default (focused first, and what Escape and the phone back do); only Leave continues.
// `question` replaces the MoMo text for other drafts (wide Items D8: unsaved changes in the pane).
export default function LeaveDraftDialog({ amountPesewas, question, onStay, onLeave }) {
  const stayRef = useRef(null);
  const leaveRef = useRef(null);
  const wideDialog = useWideDialogs();

  // On wide the WideDialog starts focus (Stay, autoFocus) and returns it.
  useEffect(() => {
    if (wideDialog || typeof document === "undefined") return undefined;
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

  const body = (
    <>
        <p id="leave-draft-question" className="text-xl font-extrabold text-slate-950 [overflow-wrap:anywhere]">
          {question ?? t("leaveDraft.receivedMomo", { amount: formatGhs(amountPesewas) })}
        </p>
        {/* open_text_sweep (17 Nov 2026): the shared main and leave buttons (Leave goes without doing it), kept 60px. */}
        <PosPrimaryButton ref={stayRef} type="button" autoFocus onClick={onStay} className="min-h-[60px]!">
          {t("leaveDraft.stay")}
        </PosPrimaryButton>
        <LeaveButton ref={leaveRef} onClick={onLeave} className="min-h-[60px]!">
          {t("leaveDraft.leave")}
        </LeaveButton>
    </>
  );
  // wide_layout.page_types.dialog: on wide the shared WideDialog; Escape and a scrim click are Stay.
  if (wideDialog) {
    return (
      <WideDialog role="alertdialog" labelledBy="leave-draft-question" onClose={onStay}>
        <div className="flex min-w-0 flex-col gap-3">{body}</div>
      </WideDialog>
    );
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
        {body}
      </section>
    </div>
  );
}
