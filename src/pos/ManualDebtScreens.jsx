import { useRef, useState } from "react";
import { Banknote, CalendarDays, Check, Smartphone } from "lucide-react";
import { formatDate } from "../lib/formatDate.js";
import AmountKeypad from "./AmountKeypad.jsx";
import { amountTextToPesewas, pressAmountKey } from "./amountKeypad.js";
import { formatGhs } from "../lib/money.js";
import { useLiveQuery } from "dexie-react-hooks";
import { buildWhatsAppReminderText } from "../utils/whatsapp.js";
import { latestReminderAt, loadReminderEvents } from "../db/reminders.js";
import { openWhatsApp } from "../lib/openWhatsApp.js";
import { useReminderCheck } from "./ReminderCheck.jsx";
import { getPlanPeriodFigures, isValidInstallmentPlanForBalance, localDateString } from "../utils/installments.js";
import { PosPage, PosPrimaryButton, PosSecondaryButton, PosBackButton } from "./PosComponents.jsx";
import { EventDetail, KeyValueRows } from "./EventRows.jsx";
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
  const initialText = typeof params.debtAmountText === "string" ? params.debtAmountText : "";
  const [amountText, setAmountText] = useState(initialText);
  const textRef = useRef(initialText);
  const [note, setNote] = useState(typeof params.note === "string" ? params.note : "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useBackBlock(saving);
  const saveAttempt = useSaveAttempt();
  // Taken on (brief line 372): defaults to today, can be set to an older date.
  const today = localDateString();
  const [takenOn, setTakenOn] = useState(params.takenOn ?? today);
  const [pickingDate, setPickingDate] = useState(false);
  const amountPesewas = amountTextToPesewas(amountText);
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
  // Paid and Still needed this period: the same shared figures as the plan card on 29, 43 and 54.
  const planPeriod = hasPlan ? getPlanPeriodFigures(debt) : null;
  const existingInstallmentCarry = planPeriod?.paidPesewas ?? 0;
  const existingInstallmentStillNeeded = planPeriod?.stillNeededPesewas ?? 0;
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
    // The ref holds the latest text, so two taps in one frame both count.
    const current = textRef.current;
    const next = pressAmountKey(current, key);
    if (next === current) return;
    textRef.current = next;
    setAmountText(next);
    onUpdateParams?.({ debtAmountText: next });
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
      <AmountKeypad label="Amount keypad" onKey={pressAmount} />
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
          <strong className="block text-lg">{t("manualDebt.existingTerms")}</strong>
          {/* Contract 53 existing_terms_card.rows_final (17 Nov 2026): label-value rows like the card on 72, short
              labels (rules_global.kv_labels), the period only in the Payment value. Debt replaces the line
              "Plan for the debt of …". The bar sits between Due and Paid. */}
          <KeyValueRows name="existing-terms" className="mt-1">
            <EventDetail label={t("kv.debt")} name="debt">{formatGhs(existingBalancePesewas)}</EventDetail>
            {hasPlan && (
              <>
                <EventDetail label={t("kv.payment")} name="payment">{t(`kv.paymentEvery.${frequencyKey}`, { amount: formatGhs(debt.installmentAmount) })}</EventDetail>
                <EventDetail label={t("kv.due")} name="due">
                  <span className="inline-flex min-h-8 items-center rounded-xl border-2 border-emerald-900 px-2 font-extrabold text-emerald-950">
                    {getDebtDueLabel(debt.nextDueDate)}
                  </span>
                </EventDetail>
              </>
            )}
            {hasDueDate && <EventDetail label={t("kv.due")} name="due">{existingNextDate}</EventDetail>}
          </KeyValueRows>
          {hasPlan ? (
            <>
              <div
                role="progressbar"
                aria-label={t("kv.paid")}
                aria-valuemin={0}
                aria-valuemax={debt.installmentAmount}
                aria-valuenow={existingInstallmentCarry}
                className="my-2 h-4 overflow-hidden rounded-full border-2 border-emerald-900 bg-white"
              >
                <div className="h-full bg-emerald-900" style={{ width: `${cycleProgress}%` }} />
              </div>
              <KeyValueRows name="existing-progress">
                <EventDetail label={t("kv.paid")} name="paid">{formatGhs(existingInstallmentCarry)}</EventDetail>
                <EventDetail label={t("kv.stillNeeded")} name="still-needed">{formatGhs(existingInstallmentStillNeeded)}</EventDetail>
                <EventDetail label={t("kv.paymentsLeft")} name="payments-left">{paymentsLeftNow}</EventDetail>
                <EventDetail label={t("kv.nextPayment")} name="next-payment">{existingNextDate}</EventDetail>
              </KeyValueRows>
            </>
          ) : hasPlanRecord && (
            <p className="mt-2 text-lg font-bold text-rose-950">{t("manualDebt.invalidTerms")}</p>
          )}
          {/* Change at the bottom of the card, full width, 52px, the "other" look; disabled until an amount is
              typed; goes to 18 with the amount and note. */}
          <PosSecondaryButton
            type="button"
            disabled={!amountValid}
            className="mt-3 w-full"
            onClick={() => {
              if (amountValid) onNavigate("WhenWillTheyPay", { ...params, amountPesewas, note, takenOn });
            }}
          >
            {t("manualDebt.change")}
          </PosSecondaryButton>
        </section>
      )}
      <PosPrimaryButton type="button" disabled={saving || !Number.isSafeInteger(amountPesewas) || amountPesewas <= 0} onClick={continueFlow}>
        <Check size={20} aria-hidden="true" /> Next
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
  // rules_global.reminders: this WhatsApp button goes through the same shared check and record as
  // 22, 32, 29 and 43. rules_global.whatsapp_links: the shared opener, the person's chat with a valid
  // number, the share sheet with the reminder text without one, as on 29/43.
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
  const shareReminder = () => openWhatsApp({ text: reminderText, phone: params.customer?.phone ?? "", title: t("collect.remindOnWhatsApp") });
  return (
    <PosPage className="flex flex-col gap-4 text-center">
      <div className="pt-2 text-center">
        <div className="mx-auto mb-4 grid h-24 w-24 place-items-center rounded-full bg-emerald-900 text-white"><Check size={56} aria-hidden="true" /></div>
        <h1 className="text-2xl font-extrabold">Saved as credit</h1>
        <p className="mt-2 text-xl font-bold">{displayName(params.customer?.name)}</p>
        <p className="mt-2 text-3xl font-extrabold text-rose-900 sm:text-4xl">{displayName(params.customer?.name)} owes {formatGhs(balance)}</p>
      </div>
      {/* Debt saved layout (wiring ManualDebtSaved rules, 17 Nov 2026): the card is only label-value rows
          in the What happened row style (grey label left, bold value right, thin dividers): Before, Added
          to debt, and For only when a reason was written. A long reason wraps in the right column. */}
      <dl data-debt-saved-rows="" className="flex min-w-0 flex-col rounded-2xl border-2 border-slate-400 bg-white px-4 py-2 text-left text-lg [&>div:first-child]:border-t-0 [&>div:first-child]:pt-0">
        <EventDetail label={t("debtSaved.before")} name="before">{formatGhs(previousDebt)}</EventDetail>
        <EventDetail label={t("debtSaved.added")} name="added">{formatGhs(params.amountPesewas ?? 0)}</EventDetail>
        {params.note?.trim() && <EventDetail label={t("debtSaved.for")} name="for">{params.note.trim()}</EventDetail>}
      </dl>
      {initialPaymentPesewas > 0 && (
        <div data-paying-today="" className="rounded-2xl border-2 border-emerald-800 bg-emerald-50 p-3 text-left" aria-live="polite">
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
                  <span data-paying-today-amount="" className="shrink-0 tabular-nums">{formatGhs(part.amountPesewas)}</span>
                </div>
              ))
            ) : (
              <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 font-bold text-slate-900">
                <span className="flex min-w-0 items-center gap-2">
                  <Banknote size={18} aria-hidden="true" />
                  <span className="truncate">{t("credit.method.cash")}</span>
                </span>
                <span data-paying-today-amount="" className="shrink-0 tabular-nums">{formatGhs(initialPaymentPesewas)}</span>
              </div>
            )}
          </div>
          <div data-total-today="" className="mt-2 flex items-center justify-between gap-3 border-t border-emerald-200 px-3 pt-2 font-extrabold text-emerald-950">
            <span>{t("credit.paymentRecordedTotal")}</span>
            <span data-paying-today-amount="" className="tabular-nums">{formatGhs(initialPaymentPesewas)}</span>
          </div>
        </div>
      )}
      {/* Buttons on this screen (wiring ManualDebtSaved rules): "WhatsApp {Name}" and "See {Name}’s details"
          are other buttons, full width, 52px, stacked; Done is the main button at the bottom. */}
      <div data-debt-saved-actions="" className="flex flex-col gap-2">
        <PosSecondaryButton type="button" disabled={!reminderText} onClick={(event) => reminders.onReminder(event, { person: reminderPerson, lastReminderAt, share: shareReminder })} className="w-full">{t("debtSaved.whatsapp", { name: displayName(params.customer?.name) })}</PosSecondaryButton>
        <PosSecondaryButton type="button" className="w-full" onClick={() => onNavigate("DebtorDetail", { customerId: result?.customer?.id ?? params.customer?.id, customerName: params.customer?.name, debtId: result?.debt?.id })}>{t("credit.seeDetails", { name: displayName(params.customer?.name) })}</PosSecondaryButton>
      </div>
      <div className="mt-auto grid gap-2">
        <PosPrimaryButton type="button" onClick={onDone}>Done</PosPrimaryButton>
      </div>
      {reminders.sheet}
    </PosPage>
  );
}
