import { useEffect, useRef, useState } from "react";
import { formatGhs } from "../lib/money.js";
import { posText as t } from "./i18n.js";
import { isLargeAmount } from "./largeAmount.js";

// Brief 3.12. One hook per screen that saves a sale:
//   if (largeAmount.guard(totalPesewas, () => void save(true))) return;
// A MoMo amount that is about to go to 61 asks with { momo: true } ("This MoMo payment is ...").
// guard() returns false when the amount is not above the limit (the save goes on as usual) and
// true when it opened the dialog (the caller stops). It runs before the save starts, so the save
// attempt key and the double-tap guards are not touched. Change amount closes the dialog and the
// screen keeps everything; Yes, save runs the continuation once.
export function useLargeAmountConfirm() {
  const [pending, setPending] = useState(null);
  // A ref as well as the state, so a second tap in the same frame sees the first one.
  const pendingRef = useRef(null);

  function guard(totalPesewas, proceed, { momo = false } = {}) {
    if (!isLargeAmount(totalPesewas)) return false;
    if (pendingRef.current) return true;
    pendingRef.current = { totalPesewas, proceed, momo };
    setPending(pendingRef.current);
    return true;
  }

  function change() {
    pendingRef.current = null;
    setPending(null);
  }

  function confirm() {
    const current = pendingRef.current;
    if (!current) return;
    pendingRef.current = null;
    setPending(null);
    current.proceed();
  }

  return {
    guard,
    open: pending !== null,
    dialog: pending ? <LargeAmountDialog amountPesewas={pending.totalPesewas} momo={pending.momo} onChange={change} onConfirm={confirm} /> : null
  };
}

function LargeAmountDialog({ amountPesewas, momo = false, onChange, onConfirm }) {
  const changeRef = useRef(null);
  const confirmRef = useRef(null);

  // Focus starts on Change amount (the safe choice) and goes back to where it was on close.
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const opener = document.activeElement;
    changeRef.current?.focus();
    return () => { if (opener instanceof HTMLElement) opener.focus(); };
  }, []);

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onChange();
    } else if (event.key === "Tab") {
      // Keep Tab inside the two choices while the dialog is open.
      event.preventDefault();
      const goingBack = Boolean(event.shiftKey);
      const active = typeof document === "undefined" ? null : document.activeElement;
      const onChangeButton = active === changeRef.current;
      (onChangeButton !== goingBack ? confirmRef : changeRef).current?.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 p-3 sm:items-center">
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="large-amount-title"
        aria-describedby="large-amount-body"
        onKeyDown={handleKeyDown}
        className="safe-bottom flex w-full max-w-md flex-col gap-3 rounded-[24px] border-[3px] border-slate-900 bg-white p-5 shadow-2xl"
      >
        <h2 id="large-amount-title" className="text-2xl font-extrabold">{t("largeAmount.title")}</h2>
        <p id="large-amount-body" className="text-lg font-semibold text-slate-900">{t(momo ? "largeAmount.momoBody" : "largeAmount.body", { amount: formatGhs(amountPesewas) })}</p>
        <button
          ref={changeRef}
          type="button"
          autoFocus
          onClick={onChange}
          className="min-h-[60px] rounded-[18px] border-[3px] border-emerald-900 bg-emerald-900 px-4 text-xl font-extrabold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
        >
          {t("largeAmount.change")}
        </button>
        <button
          ref={confirmRef}
          type="button"
          onClick={onConfirm}
          className="min-h-[60px] rounded-[18px] border-[3px] border-slate-900 bg-white px-4 text-xl font-extrabold text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
        >
          {t("largeAmount.save")}
        </button>
      </section>
    </div>
  );
}
