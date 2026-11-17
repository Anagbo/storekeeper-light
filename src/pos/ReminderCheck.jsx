import { useEffect, useRef, useState } from "react";
import { recordReminderSent } from "../db/reminders.js";
import { useBackHandler } from "./browserBack.js";
import { posText as t } from "./i18n.js";
import { LeaveButton } from "./PosComponents.jsx";
import { needsReminderCheck, reminderAgainText } from "./reminderLabel.js";

// rules_global.reminders: ONE shared path for every WhatsApp reminder button (Home Collect first 22,
// Owed rows 32, debtor detail 29/43, wide D3). A tap that hands over to WhatsApp records a local
// "reminder sent" event for the person (works offline: it is only written on this phone). Receipts
// never come through here, so they never record a reminder and never trigger the check.
//
// The 7-day check: when a reminder to this person was recorded within the last 7 days, the tap first
// opens "Send another reminder?" (a bottom sheet; a dialog on wide screens). Send again opens WhatsApp
// and records a new reminder; Not now (and Back, and Escape) closes it, records nothing and leaves the
// merchant on the same screen. After 7 days, or with no reminder, WhatsApp opens directly.
//
// Each screen calls useReminderCheck() once, renders `sheet`, and passes every reminder control's tap
// to onReminder:
//   <a href={waLink} onClick={(event) => reminders.onReminder(event, { person, lastReminderAt, href: waLink })}>
//   <button onClick={(event) => reminders.onReminder(event, { person, lastReminderAt, share })}>
// `person` is { customerId, name }. `share` (no valid phone) opens the share sheet and returns
// "cancelled" when the merchant closed it; nothing is recorded then.
// The window and the wording live in reminderLabel.js (needsReminderCheck, reminderAgainText).
export function useReminderCheck({ record = recordReminderSent, now = () => Date.now() } = {}) {
  const [pending, setPending] = useState(null);
  const close = () => setPending(null);
  useBackHandler(Boolean(pending), close);

  async function save(person) {
    try {
      await record({ customerId: person?.customerId ?? "", customerName: person?.name ?? "" });
    } catch (error) {
      console.error("Could not record the reminder.", error);
    }
  }

  // Double taps (A6): while one reminder tap is being handled (the record, or the share sheet), every
  // further tap on any reminder button of this screen is ignored, so two quick taps record one
  // reminder. A reminder recorded here also counts for the 7-day check at once, before the screen's
  // query has re-read the log.
  const busy = useRef(false);
  const recordedHere = useRef(new Map());
  const personKey = (person) => person?.customerId || `name:${(person?.name ?? "").trim().toLowerCase()}`;

  async function save(person) {
    try {
      const event = await record({ customerId: person?.customerId ?? "", customerName: person?.name ?? "" });
      recordedHere.current.set(personKey(person), event?.createdAt ?? now());
    } catch (error) {
      console.error("Could not record the reminder.", error);
    }
  }

  async function handOver({ person, share }) {
    if (!share) return save(person);
    let result;
    try {
      result = await share();
    } catch (error) {
      console.error("Could not open WhatsApp for the reminder.", error);
      return undefined;
    }
    if (result !== "cancelled") await save(person);
    return result;
  }

  async function guarded(run) {
    busy.current = true;
    try {
      return await run();
    } finally {
      busy.current = false;
    }
  }

  function onReminder(event, request) {
    if (busy.current || pending) {
      event?.preventDefault?.();
      return undefined;
    }
    const lastReminderAt = Math.max(
      typeof request?.lastReminderAt === "number" ? request.lastReminderAt : 0,
      recordedHere.current.get(personKey(request?.person)) ?? 0
    );
    if (needsReminderCheck(lastReminderAt, now())) {
      event?.preventDefault?.();
      setPending({ ...request, lastReminderAt });
      return undefined;
    }
    return guarded(() => handOver(request));
  }

  // Send again: a link opens WhatsApp itself (the tap is the browser's), so only the record is ours.
  function sendAgain(event) {
    const request = pending;
    if (busy.current || !request) {
      event?.preventDefault?.();
      return undefined;
    }
    close();
    return guarded(() => (request.href ? save(request.person) : handOver(request)));
  }

  const sheet = pending ? (
    <ReminderAgainSheet
      text={reminderAgainText(pending.person?.name ?? "", pending.lastReminderAt, new Date(now()))}
      href={pending.href}
      onSendAgain={sendAgain}
      onNotNow={close}
    />
  ) : null;

  return { onReminder, sheet, pending };
}

const STRONG = "flex min-h-[60px] w-full items-center justify-center rounded-[18px] border-[3px] border-emerald-900 bg-emerald-900 px-4 text-xl font-extrabold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800";

// "Send another reminder?": a bottom sheet on a phone, a centred dialog on wide screens.
export function ReminderAgainSheet({ text, href, onSendAgain, onNotNow }) {
  const notNowRef = useRef(null);
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const opener = document.activeElement;
    notNowRef.current?.focus();
    return () => { if (typeof HTMLElement !== "undefined" && opener instanceof HTMLElement) opener.focus(); };
  }, []);

  function handleKeyDown(event) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onNotNow();
  }

  return (
    <div data-reminder-again="" className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 sm:items-center sm:p-4" onClick={(event) => { if (event.target === event.currentTarget) onNotNow(); }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="reminder-again-title"
        aria-describedby="reminder-again-text"
        onKeyDown={handleKeyDown}
        className="safe-bottom flex w-full min-w-0 max-w-md flex-col gap-3 rounded-t-[28px] border-t-[3px] border-slate-950 bg-white p-5 shadow-2xl sm:rounded-[28px] sm:border-[3px]"
      >
        <h2 id="reminder-again-title" className="text-[22px] font-extrabold leading-tight text-slate-950">{t("reminderAgain.title")}</h2>
        <p id="reminder-again-text" className="text-lg text-slate-900 [overflow-wrap:anywhere]">{text}</p>
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" onClick={onSendAgain} className={STRONG}>{t("reminderAgain.sendAgain")}</a>
        ) : (
          <button type="button" onClick={onSendAgain} className={STRONG}>{t("reminderAgain.sendAgain")}</button>
        )}
        {/* rules_global.button_system.leave: Not now is the grey leave look, as tall as Send again. */}
        <LeaveButton ref={notNowRef} onClick={onNotNow} className="min-h-[60px]!">{t("reminderAgain.notNow")}</LeaveButton>
      </section>
    </div>
  );
}
