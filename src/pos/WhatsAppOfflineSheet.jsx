import { useEffect, useRef, useState } from "react";
import { setOfflineChooser } from "../lib/openWhatsApp.js";
import { useBackHandler } from "./browserBack.js";
import { posText as t } from "./i18n.js";
import { copyReceiptText } from "./receiptShare.js";
import { LeaveButton, PosPrimaryButton, PosSecondaryButton } from "./PosComponents.jsx";

// rules_global.whatsapp_links, offline (decided 21 Nov 2026): when the phone is offline and the share
// sheet is missing or fails, the shared opener (src/lib/openWhatsApp.js) asks here. PosApp mounts this
// once. "Copy reminder" / "Copy receipt" (main) copies the exact text, "Open WhatsApp anyway" (other)
// opens the direct link as online, Not now (leave), Back and Escape close it and open nothing. A
// reminder is recorded as before: Copy and Open WhatsApp anyway hand over, Not now records nothing
// (like a closed share sheet).
export default function WhatsAppOfflineSheet() {
  const [request, setRequest] = useState(null);
  const [failed, setFailed] = useState(false);
  const current = useRef(null);

  function finish(choice) {
    const open = current.current;
    current.current = null;
    setRequest(null);
    setFailed(false);
    open?.resolve(choice);
  }

  useEffect(() => setOfflineChooser((ask) => new Promise((resolve) => {
    current.current?.resolve("cancelled");
    current.current = { ...ask, resolve };
    setFailed(false);
    setRequest(current.current);
  })), []);
  useEffect(() => () => { current.current?.resolve("cancelled"); current.current = null; }, []);

  useBackHandler(Boolean(request), () => finish("cancelled"));
  if (!request) return null;
  return <WhatsAppOfflineChoices request={request} failed={failed} onCopy={async () => {
    if (await copyReceiptText(request.text)) finish("copied");
    else setFailed(true);
  }} onOpen={() => finish("open")} onNotNow={() => finish("cancelled")} />;
}

// The sheet itself: a bottom sheet on a phone, a centred dialog on wide screens (as ReminderAgainSheet).
export function WhatsAppOfflineChoices({ request, failed = false, onCopy, onOpen, onNotNow }) {
  const copyRef = useRef(null);
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const opener = document.activeElement;
    copyRef.current?.focus();
    return () => { if (typeof HTMLElement !== "undefined" && opener instanceof HTMLElement) opener.focus(); };
  }, []);

  const receipt = request?.kind === "receipt";
  function handleKeyDown(event) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onNotNow();
  }

  return (
    <div data-whatsapp-offline="" className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 sm:items-center sm:p-4" onClick={(event) => { if (event.target === event.currentTarget) onNotNow(); }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="whatsapp-offline-title"
        onKeyDown={handleKeyDown}
        className="safe-bottom flex w-full min-w-0 max-w-md flex-col gap-3 rounded-t-[28px] border-t-[3px] border-slate-950 bg-white p-5 shadow-2xl sm:rounded-[28px] sm:border-[3px]"
      >
        <h2 id="whatsapp-offline-title" className="text-[22px] font-extrabold leading-tight text-slate-950">{request?.title || "WhatsApp"}</h2>
        <PosPrimaryButton ref={copyRef} type="button" onClick={onCopy}>{receipt ? t("receipt.copy") : t("whatsappOffline.copyReminder")}</PosPrimaryButton>
        {failed && <p role="alert" className="text-center text-sm font-semibold text-slate-700">{receipt ? t("receipt.copyFailed") : t("whatsappOffline.reminderCopyFailed")}</p>}
        <PosSecondaryButton type="button" onClick={onOpen} className="w-full">{t("whatsappOffline.openAnyway")}</PosSecondaryButton>
        <LeaveButton onClick={onNotNow}>{t("reminderAgain.notNow")}</LeaveButton>
      </section>
    </div>
  );
}
