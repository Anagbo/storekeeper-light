import { useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { formatDate } from "../lib/formatDate.js";
import AmountKeypad from "./AmountKeypad.jsx";
import { amountTextToPesewas, pressAmountKey } from "./amountKeypad.js";
import { formatGhs } from "../lib/money.js";
import { useLiveQuery } from "dexie-react-hooks";
import { buildDebtAddedReceipt, isReceiptTemplatesEnabled } from "./receiptTemplates.js";
import { db } from "../db/db.js";
import SavedCreditReceiptActions, { useSavedCreditPhone } from "./SavedCreditReceiptActions.jsx";
import { getPlanPeriodFigures, isValidInstallmentPlanForBalance, localDateString } from "../utils/installments.js";
import { PosPage, PosPrimaryButton, PosSecondaryButton, PosBackButton, useTaskColumn } from "./PosComponents.jsx";
import { EventDetail, KeyValueRows } from "./EventRows.jsx";
import { getDebtDueLabel } from "./money.js";
import { posText as t } from "./i18n.js";
import { displayName } from "../lib/displayName.js";
import SaveAttemptNotice from "./SaveAttemptNotice.jsx";
import SavedCreditSummary from "./SavedCreditSummary.jsx";
import { useSaveAttempt } from "./useSaveAttempt.js";
import { isSaveOutcomeUnknown } from "../lib/saveAttempt.js";
import { useBackBlock } from "./browserBack.js";
import { SOFT_TILE, SOFT_TILE_DIVIDERS } from "./softTile.js";

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
  // Phone review item 5 (25 Nov 2026): while "What for?" has focus the phone keyboard is open, and the
  // on-screen keypad above the field pushed the amount out of view. The keypad hides while the field
  // has focus, so the amount stays on screen. It comes back a moment after the field loses focus, so a
  // tap on Next is not moved away from under the finger by the keypad reappearing.
  const [typingNote, setTypingNote] = useState(false);
  const keypadTimer = useRef(0);
  useEffect(() => () => clearTimeout(keypadTimer.current), []);
  const noteFocus = () => { clearTimeout(keypadTimer.current); setTypingNote(true); };
  const noteBlur = () => { clearTimeout(keypadTimer.current); keypadTimer.current = setTimeout(() => setTypingNote(false), 300); };
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
      <div className={`flex min-h-12 items-center gap-3 ${SOFT_TILE} px-3`}>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-900 font-extrabold text-white">{displayName(params.customer?.name).slice(0, 1)}</span>
        <strong className="truncate text-lg">{displayName(params.customer?.name)}</strong>
      </div>
      <div data-debt-amount="" className="rounded-2xl border-2 border-slate-500 bg-white px-4 py-2 text-right">
        <span className="block text-base font-bold text-slate-700">Amount owed</span>
        <strong className="block text-4xl font-extrabold text-[#0F172A] sm:text-5xl">{formatGhs(amountPesewas)}</strong>
      </div>
      {!typingNote && <AmountKeypad label="Amount keypad" onKey={pressAmount} />}
      <label className="block">
        <span className="sr-only">What for (optional)</span>
        <input onFocus={noteFocus} onBlur={noteBlur} value={note} onChange={(event) => { setNote(event.target.value); onUpdateParams?.({ note: event.target.value }); }} placeholder="What for? (optional)" className="h-14 w-full rounded-2xl border-[3px] border-slate-500 px-3 text-lg" />
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
        <section className={`min-w-0 ${SOFT_TILE} p-4`}>
          <strong className="block text-lg">{t("manualDebt.existingTerms")}</strong>
          {/* Contract 53 existing_terms_card.rows_final (17 Nov 2026): label-value rows like the card on 72, short
              labels (rules_global.kv_labels), the period only in the Payment value. Debt replaces the line
              "Plan for the debt of …". The bar sits between Due and Paid. */}
          <KeyValueRows name="existing-terms" className={`mt-1 ${SOFT_TILE_DIVIDERS}`}>
            <EventDetail label={t("kv.debt")} name="debt">{formatGhs(existingBalancePesewas)}</EventDetail>
            {hasPlan && (
              <>
                <EventDetail label={t("kv.payment")} name="payment">{t(`kv.paymentEvery.${frequencyKey}`, { amount: formatGhs(debt.installmentAmount) })}</EventDetail>
                <EventDetail label={t("kv.due")} name="due">
                  <span className="inline-flex min-h-8 items-center rounded-xl border-2 border-emerald-900 bg-white px-2 font-extrabold text-emerald-950">
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
        Next
      </PosPrimaryButton>
    </PosPage>
  );
}

export function ManualDebtSaved({ params, onDone, onNavigate, onSaveCustomerContact, shopName }) {
  const result = params.manualDebtResult;
  const balance = result?.debt?.amountPesewas ?? params.customer?.totalDebtPesewas ?? params.amountPesewas ?? 0;
  const previousDebt = result?.debt?.amountPesewas !== undefined && params.amountPesewas !== undefined
    ? Math.max(0, result.debt.amountPesewas - (params.amountPesewas - (result.initialPaymentPesewas ?? params.initialPaymentPesewas ?? 0)))
    : 0;
  const initialPaymentPesewas = result?.initialPaymentPesewas ?? params.initialPaymentPesewas ?? 0;
  const initialPaymentParts = result?.initialPaymentParts ?? params.initialPaymentParts ?? [];
  // rules_global.saved_credit_layout (25 Nov 2026): the same receipt block as Sell → Owe's Saved as credit
  // (SavedCreditReceiptActions). Send receipt is always there; the dashed add-phone button only without a phone.
  const reminderCustomerId = result?.customer?.id ?? params.customer?.id ?? "";
  const reminderName = params.customer?.name ?? "";
  const storedCustomer = useLiveQuery(async () => {
    if (reminderCustomerId) return db.customers.get(reminderCustomerId);
    return reminderName.trim() ? db.customers.where("nameLower").equals(reminderName.trim().toLowerCase()).first() : null;
  }, ["manualDebtSavedCustomer", reminderCustomerId, reminderName], null);
  const stored = storedCustomer && typeof storedCustomer === "object" ? storedCustomer : null;
  const { phone, hasPhone, setAddedContact } = useSavedCreditPhone(stored?.phone || params.customer?.phone || "");
  const wide = Boolean(useTaskColumn());
  // Same flag as Sell → Owe: with VITE_ENABLE_POS_RECEIPTS off, no Send receipt, Copy receipt or add-phone button.
  const receiptsOn = isReceiptTemplatesEnabled();
  let receiptText = null;
  try {
    receiptText = buildDebtAddedReceipt({
      shopName: shopName || "StoreKeeper Light",
      customerName: reminderName,
      addedPesewas: params.amountPesewas ?? 0,
      paidPesewas: initialPaymentPesewas,
      balancePesewas: balance,
      reason: params.note
    });
  } catch (receiptError) {
    console.error("Could not build the debt receipt.", receiptError);
  }
  const contact = { customerId: reminderCustomerId, id: reminderCustomerId, name: reminderName, phone, ghanaCardNumber: stored?.ghanaCardNumber ?? params.customer?.ghanaCardNumber ?? "" };
  return (
    <PosPage className="flex flex-col gap-4 text-center">
      <SavedCreditSummary
        name={displayName(params.customer?.name)}
        owesPesewas={balance}
        subline={params.note?.trim() ? t("credit.forLine", { reason: params.note.trim() }) : null}
        beforePesewas={previousDebt}
        addedLabel={t("debtSaved.added")}
        addedPesewas={params.amountPesewas ?? 0}
        paidPesewas={initialPaymentPesewas}
        parts={initialPaymentParts}
        planLine={params.installmentPlan?.isInstallmentPlan ? params.payBackLabel ?? null : null}
      />
      {/* Buttons on this screen (wiring ManualDebtSaved rules): "WhatsApp {Name}" and "See {Name}’s details"
          are other buttons, full width, 52px, stacked; Done is the main button at the bottom. */}
      <div data-debt-saved-actions="" className="flex flex-col gap-2">
        {receiptsOn && receiptText && (
          <SavedCreditReceiptActions
            text={receiptText}
            phone={phone}
            hasPhone={hasPhone}
            customer={contact}
            onSaveCustomerContact={onSaveCustomerContact}
            onSaved={setAddedContact}
            wide={wide}
          />
        )}
        <PosSecondaryButton type="button" className="w-full" onClick={() => onNavigate("DebtorDetail", { customerId: result?.customer?.id ?? params.customer?.id, customerName: params.customer?.name, debtId: result?.debt?.id })}>{t("credit.seeDetails", { name: displayName(params.customer?.name) })}</PosSecondaryButton>
      </div>
      <div className="mt-auto grid gap-2">
        <PosPrimaryButton type="button" onClick={onDone}>Done</PosPrimaryButton>
      </div>
    </PosPage>
  );
}
