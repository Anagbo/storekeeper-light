import { useEffect, useRef, useState } from "react";
import { posText as t } from "./i18n.js";
import { useOnline } from "./useOnline.js";
import { copyReceiptText, sendReceipt } from "./receiptShare.js";
import { PosSecondaryButton } from "./PosComponents.jsx";

const COPIED_MS = 2000;

function WhatsAppIcon({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z" fill="#25D366" />
      <path d="M8.5 7.2c.3-.5.8-.5 1.1-.3l1 2c.1.3 0 .6-.2.8l-.6.7c.7 1.3 1.7 2.3 3 3l.8-.6c.2-.2.5-.2.8-.1l1.9 1c.3.2.4.6.2 1-.4 1-1.4 1.6-2.4 1.4-3.2-.7-6-3.4-6.8-6.5-.1-.6.1-1.1.3-1.6z" fill="#fff" />
    </svg>
  );
}

// State for the receipt buttons on 28, 30 and 31: Send receipt, Copy receipt ("Copied" for two
// seconds) and the offline line. `text` is the exact receipt text; `phone` addresses the app link.
export function useReceiptActions(text, phone = "") {
  const online = useOnline();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState("");
  const timer = useRef(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function send() {
    setFailed("");
    try {
      await sendReceipt({ text, phone, title: t("collect.receipt") });
    } catch (error) {
      console.error("Could not open WhatsApp for the receipt.", error);
      setFailed(t("receipt.sendFailed"));
    }
  }

  async function copy() {
    setFailed("");
    if (!(await copyReceiptText(text))) {
      setFailed(t("receipt.copyFailed"));
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  }

  return { online, copied, failed, send, copy };
}

// look="other" (30, "Buttons on 30", 17 Nov 2026): the shared "other" button (PosSecondaryButton), full
// width; Send receipt keeps its WhatsApp icon. Without it (28, 31) the buttons keep their own looks.
export function SendReceiptButton({ onClick, disabled = false, label = t("saleRecorded.sendReceipt"), ariaLabel, look = "", className = "" }) {
  if (look === "other") {
    return (
      <PosSecondaryButton type="button" data-send-receipt="" aria-label={ariaLabel} onClick={onClick} disabled={disabled} className={`w-full ${className}`}>
        <WhatsAppIcon size={26} />
        <span>{label}</span>
      </PosSecondaryButton>
    );
  }
  return (
    <button type="button" aria-label={ariaLabel} onClick={onClick} disabled={disabled} className={`flex h-14 min-w-0 items-center justify-center gap-2 rounded-2xl border-2 border-emerald-900 bg-white px-2 text-center text-[17px] font-extrabold text-emerald-900 disabled:border-slate-400 disabled:bg-slate-100 disabled:text-slate-600 ${className}`}>
      <WhatsAppIcon size={26} />
      <span>{label}</span>
    </button>
  );
}

export function CopyReceiptButton({ onClick, copied, disabled = false, label = t("receipt.copy"), ariaLabel, look = "", className = "" }) {
  if (look === "other") {
    return (
      <PosSecondaryButton type="button" aria-label={ariaLabel} onClick={onClick} disabled={disabled} className={`w-full ${className}`}>
        <span aria-live="polite">{copied ? t("receipt.copied") : label}</span>
      </PosSecondaryButton>
    );
  }
  return (
    <button type="button" aria-label={ariaLabel} onClick={onClick} disabled={disabled} className={`flex h-12 w-full items-center justify-center rounded-2xl border-2 border-slate-900 bg-white px-3 text-[17px] font-extrabold text-slate-900 disabled:border-slate-400 disabled:text-slate-600 ${className}`}>
      <span aria-live="polite">{copied ? t("receipt.copied") : label}</span>
    </button>
  );
}

// The quiet offline line (wiring "Receipts offline", 14 Nov 2026): it explains Send receipt, so
// each screen puts it directly under that button (8px, gap-2) and above Copy receipt. Offline only.
// wide: 17px (wide_layout.design_principles: all text 17px or larger) instead of the phone's 14px.
export function ReceiptOfflineLine({ online, className = "", wide = false }) {
  if (online) return null;
  return <p role="status" data-receipt-offline="" className={`text-center ${wide ? "text-[17px]" : "text-sm"} font-semibold text-slate-700 ${className}`}>{t("receipt.offline")}</p>;
}

// Shown when Send or Copy could not open; it is about either button, so it sits under Copy receipt.
export function ReceiptFailedLine({ failed, wide = false }) {
  if (!failed) return null;
  return <p role="alert" className={`text-center ${wide ? "text-[17px]" : "text-sm"} font-semibold text-slate-700`}>{failed}</p>;
}

// Wide D11 (wiring "30, 31, 28 results", 23 Nov 2026): Send receipt and Copy receipt side by side, the
// offline line full width directly under the pair (it still explains Send receipt), then the failed line.
export function ReceiptPair({ send, copy, online, failed }) {
  return (
    <>
      <div data-receipt-pair="" className="grid grid-cols-2 gap-2">
        {send}
        {copy}
        <ReceiptOfflineLine online={online} wide className="col-span-full" />
      </div>
      <ReceiptFailedLine failed={failed} wide />
    </>
  );
}
