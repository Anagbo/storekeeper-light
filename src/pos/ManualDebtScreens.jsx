import { useRef, useState } from "react";
import { Banknote, CalendarDays, Check, Delete, Smartphone } from "lucide-react";
import { formatDate } from "../lib/formatDate.js";
import { digitsToWholeNumber } from "../lib/parsePesewas.js";
import { formatGhs } from "../lib/money.js";
import { useLiveQuery } from "dexie-react-hooks";
import { buildWhatsAppReminderText, generateWhatsAppLink } from "../utils/whatsapp.js";
import { latestReminderAt, loadReminderEvents } from "../db/reminders.js";
import { sendReceipt } from "./receiptShare.js";
import { useReminderCheck } from "./ReminderCheck.jsx";
import { isValidInstallmentPlanForBalance, localDateString } from "../utils/installments.js";
import { PosPage, PosPrimaryButton, PosSecondaryButton, PosBackButton } from "./PosComponents.jsx";
import { getDebtDueLabel } from "./money.js";
import { posText as t } from "./i18n.js";
import { displayName } from "../lib/displayName.js";
import SaveAttemptNotice from "./SaveAttemptNotice.jsx";
import { useSaveAttempt } from "./useSaveAttempt.js";
import { isSaveOutcomeUnknown } from "../lib/saveAttempt.js";
import { useBackBlock } from "./browserBack.js";

export function ManualDebtAmount({ params, onBack, onNavigate, onUpdateParams, onSaveManualDebt }) {
  // The typed amount and note are kept in the route params (as the split parts on 16 are), so
  // Menu > Settings > Back > Close menu, or Back from the next screen, restores them.
  const initialDigits = typeof params.amountDigits === "string" ? params.amountDigits : "";
  const [amountDigits, setAmountDigits] = useState(initialDigits);
  const digitsRef = useRef(initialDigits);
  const [note, setNote] = useState(typeof params.note === "string" ? params.note : "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useBackBlock(saving);
  const saveAttempt = useSaveAttempt();
  // Taken on (brief line 372): defaults to today, can be set to an older date.
  const today = localDateString();
  const [takenOn, setTakenOn] = useState(params.takenOn ?? today);
  const [pickingDate, setPickingDate] = useState(false);
  const amountPesewas = digitsToWholeNumber(amountDigits);
  const amountValid = Number.isSafeInteger(amountPesewas) && amountPesewas > 0;
  const debt = params.customer?.debt;
  const hasPlanRecord = Boolean(debt?.isInstallmentPlan && debt.installmentAmount > 0);
  const existingBalancePesewas = debt?.amountPesewas ?? debt?.total_owed ?? 0;
  const hasValidPlan = hasPlanRecord &&
    isValidInstallmentPlanForBalance(debt, existingBalancePesewas);
  const hasPlan = hasPlanRecord && hasValidPlan;
  const hasDueDate = !hasPlan && Boolean(debt?.dueDate);
  // The card's wording follows the plan's frequency (contract 53 existing_terms_card).
  const frequencyKey = ["weekly", "bi-weekly", "monthly"].includes(debt?.frequency) ? debt.frequency : "weekly";
  const existingInstallmentCarry = hasPlan
    ? debt.installmentPaymentCarryPesewas ?? 0
    : 0;
  const existingInstallmentStillNeeded = hasPlan
    ? Math.max(0, debt.installmentAmount - existingInstallmentCarry)
    : 0;
  // This cycle's progress: paid toward this installment out of the installment amount.
  const cycleProgress = hasPlan
    ? Math.min(100, (existingInstallmentCarry / debt.installmentAmount) * 100)
    : 0;
  // Payments left after adding the amount typed now, worked out here, not read from the
  // stored counter (contract 53: "{n} payments left now").
  const paymentsLeftNow = hasPlan
    ? Math.ceil((existingBalancePesewas + (amountValid ? amountPesewas : 0)) / debt.installmentAmount)
    : 0;
  const existingNextDate = hasPlan
    ? formatDate(debt.nextDueDate)
    : debt?.dueDate
      ? formatDate(debt.dueDate)
      : "";
  const inheritedPlan = hasPlan ? {
    isInstallmentPlan: true,
    installmentAmount: debt.installmentAmount,
    frequency: debt.frequency,
    nextDueDate: debt.nextDueDate,
    installmentsRemaining: paymentsLeftNow,
    totalInstallments: debt.totalInstallments ?? debt.installmentsRemaining
  } : null;

  function continueFlow() {
    if (!amountValid) return;
    if (hasPlanRecord && !hasValidPlan) {
      setError(t("manualDebt.invalidTermsSave"));
      return;
    }
    const nextParams = {
      ...params,
      amountPesewas,
      note,
      takenOn
    };
    if (inheritedPlan || hasDueDate) {
      setSaving(true);
      setError("");
      const content = {
        ...nextParams,
        dueDate: hasDueDate ? debt.dueDate : "",
        installmentPlan: inheritedPlan
      };
      void saveAttempt.run(content, (attemptId) => onSaveManualDebt({ ...content, attemptId })).catch((saveError) => {
        console.error("Could not save the manual debt.", saveError);
        setError(isSaveOutcomeUnknown(saveError) ? "" : saveError?.message === "The manual debt installment plan is invalid."
          ? t("manualDebt.invalidTermsSave")
          : "This debt could not be saved. No changes were committed. Try again.");
      }).finally(() => setSaving(false));
      return;
    }
    onNavigate("WhenWillTheyPay", nextParams);
  }

  function pressAmount(key) {
    // The ref holds the latest digits, so two taps in one frame both count.
    const current = digitsRef.current;
    const next = key === "delete"
      ? current.slice(0, -1)
      : current.length >= 9 ? current : `${current}${key}`.replace(/^0+(?=\d)/, "");
    if (next === current) return;
    digitsRef.current = next;
    setAmountDigits(next);
    onUpdateParams?.({ amountDigits: next });
  }

  return (
    <PosPage className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <PosBackButton onClick={onBack} />
        <h1 className="min-w-0 text-2xl font-extrabold">How much do they owe?</h1>
      </div>
      <div className="flex min-h-12 items-center gap-3 rounded-2xl border-2 border-emerald-900 bg-green-100 px-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-900 font-extrabold text-white">{displayName(params.customer?.name).slice(0, 1)}</span>
        <strong className="truncate text-lg">{displayName(params.customer?.name)}</strong>
      </div>
      <div className="rounded-2xl border-2 border-slate-500 bg-white px-4 py-2 text-right">
        <span className="block text-base font-bold text-slate-700">Amount owed</span>
        <strong className="block text-4xl font-extrabold text-rose-900 sm:text-5xl">{formatGhs(amountPesewas)}</strong>
      </div>
      <div className="grid grid-cols-3 gap-2" aria-label="Amount keypad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0"].map((key) => (
          <button key={key} type="button" onClick={() => pressAmount(key)} className="h-14 rounded-2xl border-2 border-slate-500 bg-white text-2xl font-extrabold sm:h-16">{key}</button>
        ))}
        <button type="button" aria-label="Delete amount digit" onClick={() => pressAmount("delete")} className="grid h-14 place-items-center rounded-2xl bg-slate-300 sm:h-16"><Delete size={27} aria-hidden="true" /></button>
      </div>
      <label className="block">
        <span className="sr-only">What for (optional)</span>
        <input value={note} onChange={(event) => { setNote(event.target.value); onUpdateParams?.({ note: event.target.value }); }} placeholder="What for? (optional)" className="h-14 w-full rounded-2xl border-[3px] border-slate-500 px-3 text-lg" />
      </label>
      <button type="button" aria-expanded={pickingDate} onClick={() => setPickingDate((open) => !open)} className="flex h-14 w-full items-center justify-between rounded-2xl border-[3px] border-slate-500 bg-white px-3 text-lg font-bold">
        <span>{t("manualDebt.takenOn", { date: takenOn === today ? t("manualDebt.today") : formatDate(takenOn) })}</span>
        <CalendarDays size={24} aria-hidden="true" />
      </button>
      {pickingDate && (
        <input
          type="date"
          aria-label={t("manualDebt.takenOnLabel")}
          value={takenOn}
          max={today}
          onChange={(event) => {
            const value = event.target.value;
            if (value && value <= today) {
              setTakenOn(value);
              // Kept in the route params with the amount and the note.
              onUpdateParams?.({ takenOn: value });
            }
          }}
          className="h-14 w-full rounded-2xl border-[3px] border-slate-500 bg-white px-3 text-lg"
        />
      )}
      {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
      <SaveAttemptNotice saveAttempt={saveAttempt} busy={saving} onTryAgain={continueFlow} />
      {(hasPlanRecord || hasDueDate) && (
        <section className="min-w-0 rounded-3xl border-2 border-emerald-900 bg-green-100 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong className="text-lg">{t("manualDebt.existingTerms")}</strong>
            <button
              type="button"
              disabled={!amountValid}
              className="min-h-11 rounded-xl border-2 border-emerald-900 bg-white px-3 font-extrabold text-emerald-900 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => {
                if (amountValid) onNavigate("WhenWillTheyPay", { ...params, amountPesewas, note, takenOn });
              }}
            >
              {t("manualDebt.change")}
            </button>
          </div>
          <p className="mt-1 text-base text-slate-800">
            {t(hasPlanRecord ? "manualDebt.planForDebt" : "manualDebt.dueForDebt", { amount: formatGhs(existingBalancePesewas) })}
          </p>
          {hasPlan ? (
            <>
              <div className="mt-2 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <p className="min-w-0 truncate text-[clamp(0.9rem,5vw,1.125rem)]">
                  {t(`manualDebt.every.${frequencyKey}`, { amount: formatGhs(debt.installmentAmount) })}
                </p>
                <span className="inline-flex min-h-8 shrink-0 items-center rounded-xl border-2 border-emerald-900 px-2 font-extrabold text-emerald-950">
                  {getDebtDueLabel(debt.nextDueDate)}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label={t(`manualDebt.paidThis.${frequencyKey}`, { amount: formatGhs(existingInstallmentCarry) })}
                aria-valuemin={0}
                aria-valuemax={debt.installmentAmount}
                aria-valuenow={existingInstallmentCarry}
                className="mt-2 h-4 overflow-hidden rounded-full border-2 border-emerald-900 bg-white"
              >
                <div className="h-full bg-emerald-900" style={{ width: `${cycleProgress}%` }} />
              </div>
              <div className="mt-2 grid min-w-0 grid-cols-1 gap-1 text-sm font-bold sm:grid-cols-2 sm:gap-x-3">
                <span>{t(`manualDebt.paidThis.${frequencyKey}`, { amount: formatGhs(existingInstallmentCarry) })}</span>
                <span className="sm:text-right">{t(`manualDebt.stillNeeded.${frequencyKey}`, { amount: formatGhs(existingInstallmentStillNeeded) })}</span>
              </div>
              <div className="mt-2 flex flex-wrap justify-between gap-2 font-extrabold">
                <span>{paymentsLeftNow === 1 ? t("manualDebt.paymentLeftNow") : t("manualDebt.paymentsLeftNow", { count: paymentsLeftNow })}</span>
                <span>{t("manualDebt.next", { date: existingNextDate })}</span>
              </div>
            </>
          ) : hasPlanRecord ? (
            <p className="mt-2 text-lg font-bold text-rose-950">{t("manualDebt.invalidTerms")}</p>
          ) : (
            <p className="mt-2 text-lg">{t("manualDebt.due", { date: existingNextDate })}</p>
          )}
        </section>
      )}
      <PosPrimaryButton type="button" disabled={saving || !Number.isSafeInteger(amountPesewas) || amountPesewas <= 0} onClick={continueFlow}>
        <Check size={20} aria-hidden="true" /> Next ›
      </PosPrimaryButton>
    </PosPage>
  );
}

export function ManualDebtSaved({ params, onDone, onNavigate, shopName }) {
  const result = params.manualDebtResult;
  const balance = result?.debt?.amountPesewas ?? params.customer?.totalDebtPesewas ?? params.amountPesewas ?? 0;
  const previousDebt = result?.debt?.amountPesewas !== undefined && params.amountPesewas !== undefined
    ? Math.max(0, result.debt.amountPesewas - (params.amountPesewas - (result.initialPaymentPesewas ?? params.initialPaymentPesewas ?? 0)))
    : 0;
  const initialPaymentPesewas = result?.initialPaymentPesewas ?? params.initialPaymentPesewas ?? 0;
  const initialPaymentParts = result?.initialPaymentParts ?? params.initialPaymentParts ?? [];
  const whatsappLink = generateWhatsAppLink(params.customer?.phone, params.customer?.name, balance, shopName);
  // rules_global.reminders: this WhatsApp link goes through the same shared check and record as
  // 22, 32, 29 and 43. Without a valid phone it opens the share sheet with the reminder text, as on 29/43.
  const reminders = useReminderCheck();
  const reminderCustomerId = result?.customer?.id ?? params.customer?.id ?? "";
  const reminderName = params.customer?.name ?? "";
  const lastReminderResult = useLiveQuery(
    async () => latestReminderAt(await loadReminderEvents(), { customerId: reminderCustomerId, customerName: reminderName }),
    ["manualDebtSavedReminder", reminderCustomerId, reminderName],
    0
  );
  const lastReminderAt = typeof lastReminderResult === "number" ? lastReminderResult : 0;
  const reminderPerson = { customerId: reminderCustomerId, name: reminderName };
  const reminderText = buildWhatsAppReminderText(reminderName, balance, shopName);
  const shareReminder = () => sendReceipt({ text: reminderText, title: t("collect.remindOnWhatsApp") });
  const whatsappClass = "flex min-h-14 items-center justify-center rounded-2xl border-2 border-emerald-900 px-2 text-center font-extrabold text-emerald-900";
  return (
    <PosPage className="flex flex-col gap-4 text-center">
      <div className="pt-2 text-center">
        <div className="mx-auto mb-4 grid h-24 w-24 place-items-center rounded-full bg-emerald-900 text-white"><Check size={56} aria-hidden="true" /></div>
        <h1 className="text-2xl font-extrabold">Saved as credit</h1>
        <p className="mt-2 text-xl font-bold">{displayName(params.customer?.name)}</p>
        <p className="mt-2 text-3xl font-extrabold text-rose-900 sm:text-4xl">{displayName(params.customer?.name)} owes {formatGhs(balance)}</p>
      </div>
      <div className="rounded-2xl border-2 border-slate-400 bg-white p-4 text-left">
        <div className="flex justify-between gap-3 text-lg"><span>Before</span><strong>{formatGhs(previousDebt)}</strong></div>
        <div className="flex justify-between gap-3 text-lg"><span>Added to debt</span><strong>{formatGhs(params.amountPesewas ?? 0)}</strong></div>
        {params.note && <div className="mt-2 text-sm font-semibold">What for: {params.note}</div>}
      </div>
      {initialPaymentPesewas > 0 && (
        <div className="rounded-2xl border-2 border-emerald-800 bg-emerald-50 p-3 text-left" aria-live="polite">
          <p className="mb-2 font-extrabold text-emerald-950">{t("credit.paymentRecorded")}</p>
          <div className="flex flex-col gap-2">
            {initialPaymentParts.length > 0 ? (
              initialPaymentParts.map((part) => (
                <div key={`${part.paymentMethod}-${part.amountPesewas}`} className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 font-bold text-slate-900">
                  <span className="flex min-w-0 items-center gap-2">
                    {part.paymentMethod === "cash"
                      ? <Banknote size={18} aria-hidden="true" />
                      : <Smartphone size={18} aria-hidden="true" />}
                    <span className="truncate">{t(`credit.method.${part.paymentMethod}`)}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">{formatGhs(part.amountPesewas)}</span>
                </div>
              ))
            ) : (
              <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 font-bold text-slate-900">
                <span className="flex min-w-0 items-center gap-2">
                  <Banknote size={18} aria-hidden="true" />
                  <span className="truncate">{t("credit.method.cash")}</span>
                </span>
                <span className="shrink-0 tabular-nums">{formatGhs(initialPaymentPesewas)}</span>
              </div>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-emerald-200 pt-2 font-extrabold text-emerald-950">
            <span>{t("credit.paymentRecordedTotal")}</span>
            <span className="tabular-nums">{formatGhs(initialPaymentPesewas)}</span>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {whatsappLink ? (
          <a href={whatsappLink} target="_blank" rel="noreferrer" onClick={(event) => reminders.onReminder(event, { person: reminderPerson, lastReminderAt, href: whatsappLink })} className={whatsappClass}>WhatsApp {displayName(params.customer?.name)}</a>
        ) : (
          <button type="button" disabled={!reminderText} onClick={(event) => reminders.onReminder(event, { person: reminderPerson, lastReminderAt, share: shareReminder })} className={whatsappClass}>WhatsApp {displayName(params.customer?.name)}</button>
        )}
        <PosSecondaryButton type="button" onClick={() => onNavigate("DebtorDetail", { customerId: result?.customer?.id ?? params.customer?.id, customerName: params.customer?.name, debtId: result?.debt?.id })}>See details ›</PosSecondaryButton>
      </div>
      <div className="mt-auto grid gap-2">
        <PosPrimaryButton type="button" onClick={onDone}>Done</PosPrimaryButton>
      </div>
      {reminders.sheet}
    </PosPage>
  );
}
