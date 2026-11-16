import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Banknote, Check, Clock3, Phone, Plus, ReceiptText, Smartphone, Undo2, UserRoundPen, X } from "lucide-react";
import { db } from "../db/db.js";
import { COLLECTION_UNDO_WINDOW_MS, undoDebtCollection } from "../db/debts.js";
import { correctDebtBalance } from "../db/debtLedger.js";
import { formatLastReminder } from "./reminderLabel.js";
import { useReminderCheck } from "./ReminderCheck.jsx";
import { latestReminderAt, loadReminderEvents } from "../db/reminders.js";
import { formatDate } from "../lib/formatDate.js";
import { formatGhs, toPesewas } from "../lib/money.js";
import { formatGhanaCard } from "../utils/formatters.js";
import { loadCustomerHistory } from "../utils/loadCustomerDebtHistory.js";
import { getOutstandingDebtPesewas } from "../lib/money.js";
import { buildWhatsAppReminderText, generateWhatsAppLink, normalizeWhatsAppPhone } from "../utils/whatsapp.js";
import { sendReceipt } from "./receiptShare.js";
import { CopyReceiptButton, ReceiptFailedLine, ReceiptOfflineLine, SendReceiptButton, useReceiptActions } from "./ReceiptActions.jsx";
import { buildLatestPaymentReceipt, getCollectionReceiptText, isReceiptTemplatesEnabled } from "./receiptTemplates.js";
import AmountKeypad from "./AmountKeypad.jsx";
import { pressAmountKey } from "./amountKeypad.js";
import { getDebtDueLabel, getDebtDueLine } from "./money.js";
import { getInstallmentsLeft, getPlanProgress } from "../utils/installments.js";
import { getCustomerLedgerRecords, getPlanPaidPesewas } from "../utils/debtLedgerMath.js";
import { posText as t } from "./i18n.js";
import { getDebtEntryReason } from "../lib/creditReason.js";
import { PosBackButton, PosPage, PosPrimaryButton, PosSecondaryButton, PosStatusTag, SplitIcons } from "./PosComponents.jsx";
import CustomerContactEditor from "./CustomerContactEditor.jsx";
import SaveAttemptNotice from "./SaveAttemptNotice.jsx";
import { useSaveAttempt } from "./useSaveAttempt.js";
import { isSaveOutcomeUnknown } from "../lib/saveAttempt.js";
import SplitPayment from "./SplitPayment.jsx";
import { getInitialPaymentParts } from "./paymentAmount.js";
import { confirmDirectMomoParts, describeSplitPart, isUnconfirmedDirectMomo } from "./splitTender.js";
import { getMomoDisplayLabel } from "./momoMapping.js";
import { secondsUntil } from "../lib/countdown.js";
import { useBackBlock, useBackHandler } from "./browserBack.js";
import { displayName } from "../lib/displayName.js";
import { DueTag } from "./PartyCard.jsx";
import { useFormErrors } from "./formErrors.js";
import AmountTextInput from "./AmountTextInput.jsx";
import { CREDIT_ROW_TYPES, formatHistoryRowTimestamp, groupCollectionHistory, paidParts, rowReason, rowWhen } from "./historyRows.js";
import { needsSignature } from "../config/features.js";
import CorrectionLines from "./CorrectionLines.jsx";
import SignedTag from "./SignedTag.jsx";

const PAYMENT_METHODS = [
  { value: "cash", label: "collect.cash", icon: Banknote },
  { value: "momo", label: "collect.momo", icon: Smartphone }
];

// One cell of the 29/43 action row: icon above the label, 64px tall, equal columns, never wrapped.
const ACTION_BUTTON = "flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-2xl border-2 px-1 py-2 text-base font-extrabold leading-tight whitespace-nowrap sm:h-[72px] sm:text-[17px]";

function WhatsAppIcon({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z" fill="#25D366" />
      <path d="M8.5 7.2c.3-.5.8-.5 1.1-.3l1 2c.1.3 0 .6-.2.8l-.6.7c.7 1.3 1.7 2.3 3 3l.8-.6c.2-.2.5-.2.8-.1l1.9 1c.3.2.4.6.2 1-.4 1-1.4 1.6-2.4 1.4-3.2-.7-6-3.4-6.8-6.5-.1-.6.1-1.1.3-1.6z" fill="#fff" />
    </svg>
  );
}

// A payment row that cannot make a receipt (a broken amount or time) never stops the screen: no receipt.
function latestPaymentReceiptOrNull(details) {
  try {
    return buildLatestPaymentReceipt(details);
  } catch (error) {
    console.error("Could not build the receipt for the latest payment.", error);
    return null;
  }
}

function useCollectionDebt(debtId, customerName) {
  return useLiveQuery(async () => {
    let debt = debtId ? await db.debts.get(debtId) : null;
    if (!debt && customerName) {
      const normalizedName = customerName.trim().toLowerCase();
      const matchingDebts = await db.debts.where("status").equals("unpaid").filter((record) => (
        (record.customer_name ?? record.customerName ?? "").trim().toLowerCase() === normalizedName
      )).toArray();
      matchingDebts.sort((left, right) => (right.amountPesewas ?? right.total_owed ?? 0) - (left.amountPesewas ?? left.total_owed ?? 0));
      debt = matchingDebts[0] ?? null;
    }
    if (!debt) return null;

    const name = debt.customerName ?? debt.customer_name ?? customerName ?? "";
    const customer = debt.customerId
      ? await db.customers.get(debt.customerId)
      : await db.customers.where("nameLower").equals(name.trim().toLowerCase()).first();
    return {
      ...debt,
      customerName: name,
      phone: customer?.phone || debt.phone || debt.customer_phone || "",
      amountPesewas: debt.amountPesewas ?? debt.total_owed
    };
  }, [debtId, customerName], undefined);
}

function PaymentMethodPicker({ value, onChange, onSplit, splitDisabled = false }) {
  return (
    <fieldset>
      <legend className="mb-2 text-lg font-extrabold">{t("collect.howPaying")}</legend>
      <div className="grid grid-cols-3 gap-2">
        {PAYMENT_METHODS.map(({ value: method, label, icon: Icon }) => (
          <button
            key={method}
            type="button"
            aria-pressed={value === method}
            onClick={() => onChange(method)}
            className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-2xl border-[3px] px-1 text-xs font-extrabold sm:min-h-16 sm:gap-1 sm:px-2 sm:text-base ${value === method ? "border-emerald-900 bg-green-200 text-slate-950" : "border-slate-500 bg-white text-slate-950"}`}
          >
            <Icon size={20} className="shrink-0 sm:h-[22px] sm:w-[22px]" aria-hidden="true" />
            <span className="w-full min-w-0 truncate text-center">{t(label)}</span>
          </button>
        ))}
        <button
          type="button"
          disabled={splitDisabled}
          onClick={onSplit}
          className="flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-2xl border-[3px] border-emerald-900 bg-white px-1 text-xs font-extrabold text-emerald-900 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-16 sm:gap-1 sm:px-2 sm:text-base"
        >
          <SplitIcons size={16} />
          <span className="w-full min-w-0 truncate text-center">{t("collect.splitPayment")}</span>
        </button>
      </div>
    </fieldset>
  );
}

function CollectionError({ children }) {
  return children ? <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{children}</p> : null;
}

function SheetAmount({ amountPesewas }) {
  return (
    <div className="amount-fit-container amount-fit-row flex min-h-16 items-center justify-between gap-2 rounded-2xl border-[3px] border-slate-500 px-4">
      <span className="text-lg font-bold text-slate-700">GH₵</span>
      <span className="amount-fit text-right font-extrabold">{formatGhs(amountPesewas)}</span>
    </div>
  );
}

function CollectionSheet({ debt, params = {}, onClose, onNavigate, onUpdateParams, onRecordCollection }) {
  // draft_survives_trip_away: Due now / Pay all is also kept in the route params, so 26, 61 or 43 and
  // Back show the same choice. Close (Home) drops it.
  const [mode, setMode] = useState(params.collectMode === "all" ? "all" : "due");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [busy, setBusy] = useState(false);
  useBackBlock(busy);
  const [error, setError] = useState("");
  const saveAttempt = useSaveAttempt();
  const dueAmount = debt.isInstallmentPlan && Number.isSafeInteger(debt.installmentAmount) && debt.installmentAmount > 0
    ? Math.min(debt.amountPesewas, debt.installmentAmount)
    : debt.amountPesewas;
  const amountPesewas = mode === "all" ? debt.amountPesewas : dueAmount;
  // Wiring 25: only for Due now, from money (never "Payment x of y").
  const paymentsLeft = getInstallmentsLeft(debt);
  const dueNowLine = mode !== "due" || paymentsLeft <= 0
    ? ""
    : paymentsLeft === 1
      ? t("collect.lastPayment")
      : t("collect.leftAfterThis", { left: paymentsLeft - 1 });

  async function receivePayment() {
    if (busy || amountPesewas <= 0) return;
    setBusy(true);
    setError("");
    try {
      const parts = [{ paymentMethod, amountPesewas }];
      await saveAttempt.run({ debtId: debt.id, parts }, (attemptId) => onRecordCollection(debt.id, parts, attemptId));
    } catch (recordError) {
      console.error("Could not record the debt collection.", recordError);
      setError(isSaveOutcomeUnknown(recordError) ? "" : t("collect.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 p-0 sm:items-center sm:p-4" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <section role="dialog" aria-modal="true" aria-labelledby="collect-title" className="safe-bottom max-h-[94dvh] w-full max-w-xl overflow-y-auto rounded-t-[28px] border-t-[3px] border-slate-950 bg-white p-4 shadow-2xl sm:rounded-[28px] sm:border-2">
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-500" aria-hidden="true" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 id="collect-title" className="text-2xl font-extrabold">{t("collect.from", { name: displayName(debt.customerName) })}</h1>
            <p className="mt-1 text-base font-semibold">{t("collect.owes")} <strong className="text-rose-900">{formatGhs(debt.amountPesewas)}</strong></p>
            <div className="mt-1"><PosStatusTag tone={getDebtDueLabel(debt.isInstallmentPlan ? debt.nextDueDate : debt.dueDate).startsWith("Late ") ? "red" : "amber"}>
              {getDebtDueLabel(debt.isInstallmentPlan ? debt.nextDueDate : debt.dueDate)}
            </PosStatusTag></div>
          </div>
          <button type="button" disabled={busy} onClick={onClose} aria-label={t("collect.close")} className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border-2 border-slate-900 text-slate-900 disabled:opacity-50">
            <X size={25} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            ["due", "collect.dueNow"],
            ["all", "collect.payAll"]
          ].map(([value, label]) => (
            <button key={value} type="button" aria-pressed={mode === value} onClick={() => { setMode(value); onUpdateParams?.({ collectMode: value }); }} className={`min-h-12 rounded-xl border-2 px-2 text-sm font-extrabold sm:text-base ${mode === value ? "border-emerald-900 bg-emerald-900 text-white" : "border-slate-500 bg-white text-slate-950"}`}>
              {t(label)}
            </button>
          ))}
          <button type="button" disabled={busy} onClick={() => onNavigate("CollectPayPart", { debtId: debt.id })} className="min-h-12 rounded-xl border-2 border-slate-500 bg-white px-2 text-sm font-extrabold text-slate-950 disabled:opacity-50 sm:text-base">
            {t("collect.payPart")}
          </button>
        </div>

        <div className="mt-3"><SheetAmount amountPesewas={amountPesewas} /></div>
        {dueNowLine && <p className="mt-2 text-sm font-semibold text-slate-700">{dueNowLine}</p>}
        <div className="mt-4">
          <PaymentMethodPicker
            value={paymentMethod}
            onChange={(method) => {
              if (method === "momo") {
                onNavigate("MoMoChoice", { debtId: debt.id, amountPesewas });
              } else {
                setPaymentMethod(method);
              }
            }}
            splitDisabled={busy || amountPesewas <= 0}
            onSplit={() => {
              // Wiring 27 (12 Nov 2026, as from 26): the parts kept after Back from 27 come back while
              // the amount (Due now / Pay all) is unchanged; a changed amount clears them.
              const kept = params.collectSplitDraft;
              const keptParts = kept?.totalPesewas === amountPesewas ? kept.splitParts : [];
              if (kept && !keptParts.length) onUpdateParams?.({ collectSplitDraft: undefined });
              onNavigate("SplitPayment", {
                debtId: debt.id,
                customerName: debt.customerName,
                amount: (amountPesewas / 100).toFixed(2),
                splitParts: keptParts
              });
            }}
          />
        </div>
        <CollectionError>{error}</CollectionError>
        <SaveAttemptNotice saveAttempt={saveAttempt} busy={busy} onTryAgain={() => void receivePayment()} />
        <PosPrimaryButton type="button" onClick={() => void receivePayment()} disabled={busy || amountPesewas <= 0} className="mt-4 h-[68px] min-h-0 rounded-[20px] text-2xl">
          <Check size={28} aria-hidden="true" /> {busy ? t("collect.saving") : t("collect.received")}
        </PosPrimaryButton>
        <button type="button" onClick={() => onNavigate("DebtorDetail", { debtId: debt.id, customerName: debt.customerName })} className="mt-2 min-h-12 w-full text-center text-lg font-extrabold text-emerald-900 underline">
          {t("collect.seeDetails", { name: displayName(debt.customerName) })}
        </button>
      </section>
    </div>
  );
}

export function CollectPayment({ params, onClose, onNavigate, onUpdateParams, onRecordCollection }) {
  const debt = useCollectionDebt(params?.debtId, params?.customerName);
  if (debt === undefined) return <CollectionSheetError loading={true} onClose={onClose} />;
  if (!debt) return <CollectionSheetError loading={false} onClose={onClose} />;
  return <CollectionSheet debt={debt} params={params ?? {}} onClose={onClose} onNavigate={onNavigate} onUpdateParams={onUpdateParams} onRecordCollection={onRecordCollection} />;
}

function CollectionSheetError({ loading, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 sm:items-center sm:p-4">
      <section role="dialog" aria-modal="true" className="safe-bottom w-full max-w-xl rounded-t-[28px] bg-white p-6 sm:rounded-[28px]">
        <p role={loading ? "status" : "alert"} className="font-bold">{loading ? t("collect.loading") : t("collect.notFound")}</p>
        <PosSecondaryButton type="button" onClick={onClose} className="mt-4">{t("collect.close")}</PosSecondaryButton>
      </section>
    </div>
  );
}

export function CollectPayPart(props) {
  return <CollectPayPartScreen {...props} />;
}

export function CollectSplitPayment({ params, onBack, onNavigate, onUpdateParams, onRecordCollection }) {
  const debt = useCollectionDebt(params?.debtId, params?.customerName);
  const [busy, setBusy] = useState(false);
  useBackBlock(busy);
  const [error, setError] = useState("");
  // E8: a ref, not the state, so a second tap in the same frame sees the first one.
  const busyRef = useRef(false);
  const saveAttempt = useSaveAttempt();
  const lastPartsRef = useRef(null);
  const totalPesewas = toPesewas(params?.amount ?? "");

  // Money received on 62 after Received (MOMO16 on 27): record the collection once, straight away,
  // as soon as the debt is loaded. A failed save leaves the draft here with the MoMo part locked.
  const commitStarted = useRef(false);
  useEffect(() => {
    if (!params?.commitNow || !debt || commitStarted.current) return;
    commitStarted.current = true;
    onUpdateParams?.({ commitNow: undefined });
    void receive(getInitialPaymentParts({ ...params, splitTotalPesewas: totalPesewas }, totalPesewas));
  }, [debt]);

  if (debt === undefined) return <PosPage><p role="status">{t("collect.loading")}</p></PosPage>;
  if (!debt || !Number.isSafeInteger(totalPesewas) || totalPesewas <= 0 || totalPesewas > debt.amountPesewas) {
    return <PosPage><CollectionError>{t("collect.notFound")}</CollectionError></PosPage>;
  }

  async function receive(parts) {
    if (busyRef.current) return;
    // MOMO16 on 27: a Direct MoMo part not confirmed yet is confirmed on 62 first; Money received
    // there brings the draft back with the part received and the collection is recorded once
    // (commitNow above). Back on 62 returns here with nothing confirmed or saved.
    const unconfirmed = parts.find(isUnconfirmedDirectMomo);
    if (unconfirmed) {
      onNavigate("MoMoDirect", {
        ...params,
        splitTotalPesewas: totalPesewas,
        splitParts: parts.filter((part) => part !== unconfirmed),
        pendingMomoAmountPesewas: unconfirmed.amountPesewas,
        momoMethod: "direct",
        confirmFor: "collect27",
        confirmedParams: { splitParts: confirmDirectMomoParts(parts) }
      });
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    lastPartsRef.current = parts;
    try {
      await saveAttempt.run({ debtId: debt.id, parts }, (attemptId) => onRecordCollection(debt.id, parts, attemptId));
    } catch (recordError) {
      console.error("Could not record the split debt collection.", recordError);
      setError(isSaveOutcomeUnknown(recordError) ? "" : t("collect.saveFailed"));
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <SplitPayment
      totalPesewas={totalPesewas}
      totalLabel={t("split.collectPays", { name: displayName(debt.customerName) })}
      // Audit item 4: 27 shows what Kofi pays but not the balance; this line shows it (= 26 Left to pay, 28).
      stillOwed={{ amountPesewas: Math.max(0, debt.amountPesewas - totalPesewas), customerName: debt.customerName }}
      doneLabel={t("split.done")}
      busy={busy}
      error={error}
      onPartsChange={(parts) => onUpdateParams?.({ splitParts: parts })}
      notice={<SaveAttemptNotice saveAttempt={saveAttempt} busy={busy} onTryAgain={() => lastPartsRef.current && void receive(lastPartsRef.current)} />}
      onBack={onBack}
      onDone={(parts) => void receive(parts)}
      onMoMo={(parts, pendingMomoAmountPesewas, extra = {}) => onNavigate("MoMoChoice", {
        ...params,
        splitTotalPesewas: totalPesewas,
        splitParts: parts,
        pendingMomoAmountPesewas,
        ...extra,
        returnRoute: "SplitPayment",
        pickOnly: true,
        confirmAtDone: true
      })}
      initialParts={getInitialPaymentParts({ ...params, splitTotalPesewas: totalPesewas }, totalPesewas)}
      partDetail={(part) => describeSplitPart(part, params)}
    />
  );
}

function CollectPayPartScreen({ params, onBack, onNavigate, onUpdateParams, onRecordCollection }) {
  const debt = useCollectionDebt(params?.debtId, params?.customerName);
  const [amount, setAmount] = useState(() => params?.amount ?? "");
  const [paymentMethod, setPaymentMethod] = useState(() => (
    ["cash", "momo"].includes(params?.paymentMethod) ? params.paymentMethod : "cash"
  ));
  const [busy, setBusy] = useState(false);
  useBackBlock(busy);
  const [error, setError] = useState("");
  const saveAttempt = useSaveAttempt();
  const amountPesewas = toPesewas(amount);
  const canReceive = debt && Number.isSafeInteger(amountPesewas) && amountPesewas > 0 && amountPesewas <= debt.amountPesewas;

  async function receivePayment() {
    if (busy || !canReceive) return;
    setBusy(true);
    setError("");
    try {
      const parts = [{ paymentMethod, amountPesewas }];
      await saveAttempt.run({ debtId: debt.id, parts }, (attemptId) => onRecordCollection(debt.id, parts, attemptId));
    } catch (recordError) {
      console.error("Could not record the partial debt collection.", recordError);
      setError(isSaveOutcomeUnknown(recordError) ? "" : t("collect.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PosPage className="!min-h-[calc(100vh-4rem)] !pb-6 mx-auto flex max-w-2xl flex-col gap-3 px-4 sm:px-6 lg:justify-center">
      {debt === undefined ? <p role="status">{t("collect.loading")}</p> : !debt ? <CollectionError>{t("collect.notFound")}</CollectionError> : (
        <>
          <div className="flex items-center gap-2">
            <PosBackButton onClick={onBack} />
            <h1 className="text-2xl font-extrabold">{t("collect.collectFrom", { name: displayName(debt.customerName) })}</h1>
          </div>
          <section className="amount-fit-container rounded-[20px] border-2 border-slate-500 bg-white px-4 py-2 text-right">
            <p className="text-[17px] font-bold text-slate-800">{t("collect.namePays", { name: displayName(debt.customerName) })}</p>
            {/* Decided 15 Nov 2026: the amount is shown like every other pad (GH₵8.00), typed only on the keypad. */}
            <output aria-live="polite" aria-label={t("collect.amountToCollect")} className="amount-fit block font-extrabold">{formatGhs(amountPesewas ?? 0)}</output>
            <p className="text-lg font-bold text-rose-900">{t("collect.leftToPay", { amount: formatGhs(Math.max(0, debt.amountPesewas - (amountPesewas ?? 0))) })}</p>
          </section>
          {amountPesewas > debt.amountPesewas && <CollectionError>{t("collect.amountTooHigh")}</CollectionError>}
          <AmountKeypad label={t("collect.enterAmount")} onKey={(digit) => {
            const next = pressAmountKey(amount, digit);
            setAmount(next);
            onUpdateParams({ amount: next });
            setError("");
          }} disabled={busy} />
          <PaymentMethodPicker
            value={paymentMethod}
            onChange={(method) => {
              if (method === "momo") {
                onNavigate("MoMoChoice", { ...params, amountPesewas });
              } else {
                setPaymentMethod(method);
                onUpdateParams({ paymentMethod: method });
                setError("");
              }
            }}
            splitDisabled={!canReceive || busy}
            onSplit={() => {
              // Wiring 27 (12 Nov 2026): the parts kept after Back from 27 come back while the amount
              // is unchanged; a changed amount clears them and 27 starts with the new amount.
              const kept = params?.collectSplitDraft;
              const keptParts = kept?.totalPesewas === amountPesewas ? kept.splitParts : [];
              if (kept && !keptParts.length) onUpdateParams({ collectSplitDraft: undefined });
              onNavigate("SplitPayment", { ...params, amount, collectSplitDraft: undefined, splitParts: keptParts });
            }}
          />
          <CollectionError>{error}</CollectionError>
          <SaveAttemptNotice saveAttempt={saveAttempt} busy={busy} onTryAgain={() => void receivePayment()} />
          <PosPrimaryButton type="button" disabled={!canReceive || busy} onClick={() => void receivePayment()} className="h-[68px] min-h-0 rounded-[20px] text-2xl">
            {busy ? t("collect.saving") : <><Check size={28} aria-hidden="true" /> {t("collect.received")}</>}
          </PosPrimaryButton>
        </>
      )}
    </PosPage>
  );
}


export function PaymentReceived({ params, onHome, onNavigate, onSaveCustomerContact, shopName }) {
  const result = params;
  const [remainingSeconds, setRemainingSeconds] = useState(() => Math.max(0, Math.ceil((result.undoExpiresAt - Date.now()) / 1000)));
  const [busy, setBusy] = useState(false);
  useBackBlock(busy);
  const [error, setError] = useState("");
  const [undone, setUndone] = useState(false);
  const [contact, setContact] = useState({
    customerId: result.customerId,
    name: result.customerName,
    phone: result.phone ?? "",
    ghanaCardNumber: result.ghanaCardNumber ?? ""
  });
  const savedCustomer = useLiveQuery(async () => {
    if (result.customerId) return db.customers.get(result.customerId);
    const customerName = result.customerName ?? "";
    if (!customerName.trim()) return null;
    return db.customers.where("nameLower").equals(customerName.trim().toLowerCase()).first();
  }, [result.customerId, result.customerName], null);
  const [contactEditorOpen, setContactEditorOpen] = useState(false);
  const totalCash = result.parts.filter((part) => part.paymentMethod === "cash").reduce((sum, part) => sum + part.amountPesewas, 0);
  const totalMomo = result.parts.filter((part) => part.paymentMethod === "momo").reduce((sum, part) => sum + part.amountPesewas, 0);
  // Send receipt, its wait line and its add-phone prompt show only with VITE_ENABLE_POS_RECEIPTS
  // on (FEATURE_FLAGS.SHOW_POS_RECEIPTS).
  const receiptsOn = isReceiptTemplatesEnabled();
  const receiptMessage = getCollectionReceiptText(result, shopName);
  const receiptPhone = normalizeWhatsAppPhone(contact.phone);
  const actions = useReceiptActions(receiptMessage, receiptPhone ?? "");
  // Undo is open for a while: the receipt is held back until it has passed, so a payment that is undone is never receipted.
  const receiptReady = remainingSeconds <= 0 && !undone;

  useEffect(() => {
    if (!savedCustomer) return;
    setContact((current) => ({
      ...current,
      customerId: savedCustomer.id ?? current.customerId,
      name: savedCustomer.name ?? current.name,
      phone: savedCustomer.phone ?? current.phone,
      ghanaCardNumber: savedCustomer.ghanaCardNumber ?? current.ghanaCardNumber
    }));
  }, [savedCustomer]);

  // E6: the timer stops itself once the Undo window has passed (it used to tick forever).
  useEffect(() => {
    if (secondsUntil(result.undoExpiresAt, Date.now()) <= 0) return undefined;
    const timer = window.setInterval(() => {
      const left = secondsUntil(result.undoExpiresAt, Date.now());
      setRemainingSeconds(left);
      if (left <= 0) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [result.undoExpiresAt]);

  async function undo() {
    if (busy || remainingSeconds <= 0 || undone) return;
    setBusy(true);
    setError("");
    try {
      await undoDebtCollection({ collectionId: result.collectionId });
      setUndone(true);
      onHome();
    } catch (undoError) {
      console.error("Could not undo the debt collection.", undoError);
      setError(t("collect.undoFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PosPage className="!min-h-[calc(100vh-4rem)] !pb-6 mx-auto flex max-w-xl flex-col gap-3 px-4 sm:px-6">
      <section className="amount-fit-container pt-2 text-center">
        <div className="mx-auto mb-2 grid h-24 w-24 place-items-center rounded-full bg-emerald-900 text-white">
          <Check size={56} strokeWidth={2.2} aria-hidden="true" />
        </div>
        <h1 className="text-xl font-bold">{undone ? t("collect.paymentUndone") : t("collect.paymentReceived")}</h1>
        <p className="amount-fit mx-auto font-extrabold">{formatGhs(result.amountPesewas)}</p>
        <p className="text-lg text-slate-800">{t("collect.fromLower", { name: displayName(result.customerName) })}</p>
      </section>

      <section className="flex flex-col gap-2 rounded-[18px] border-2 border-slate-500 bg-white px-4 py-3 text-lg">
        {totalCash > 0 && <div className="flex justify-between"><span>{t("collect.cash")}</span><strong>{formatGhs(totalCash)}</strong></div>}
        {totalMomo > 0 && <div className="flex justify-between"><span>{result.momoVerification ? getMomoDisplayLabel(result) : t("collect.momo")}</span><strong>{formatGhs(totalMomo)}</strong></div>}
        <div className="border-t-2 border-dashed border-slate-400 pt-2">
          <div className="flex justify-between gap-2">
            <span>{t("collect.customerStillOwes", { name: displayName(result.customerName) })}</span>
            <strong className="text-rose-900">{formatGhs(result.remainingPesewas)}</strong>
          </div>
        </div>
      </section>

      <CollectionError>{error}</CollectionError>
      <div className={`grid gap-2 ${receiptsOn ? "grid-cols-2" : "grid-cols-1"}`}>
        <PosSecondaryButton type="button" disabled={busy || remainingSeconds <= 0 || undone} onClick={() => void undo()} className="h-14 min-h-0 rounded-2xl border-rose-900 text-[17px] text-rose-900">
          <Undo2 size={22} aria-hidden="true" /> {t("collect.undo")}
        </PosSecondaryButton>
        {/* Without a valid phone, Send receipt opens the share sheet (receiptShare.sendReceipt). Only the Undo window holds it back. */}
        {receiptsOn && <SendReceiptButton onClick={() => void actions.send()} disabled={!receiptReady} label={t("collect.receiptShare")} />}
        {receiptsOn && receiptReady && <ReceiptOfflineLine online={actions.online} className="col-span-full" />}
      </div>
      {receiptsOn && <CopyReceiptButton onClick={() => void actions.copy()} copied={actions.copied} disabled={!receiptReady} />}
      {receiptsOn && receiptReady && <ReceiptFailedLine failed={actions.failed} />}
      {receiptsOn && remainingSeconds > 0 && !undone && (
        <p role="status" className="text-center text-sm font-semibold text-slate-700">{t("collect.receiptWait", { seconds: remainingSeconds })}</p>
      )}
      {receiptsOn && !receiptPhone && !undone && (
        <div className="text-center">
          <button type="button" onClick={() => setContactEditorOpen(true)} className="min-h-11 text-center font-extrabold text-emerald-900 underline">
            {t("collect.addPhoneForReceipt")}
          </button>
          <p className="text-sm font-semibold text-slate-700">{t("collect.addPhoneForReceiptHint")}</p>
        </div>
      )}
      <p className="text-center text-[17px] text-slate-800">
        <Clock3 size={16} className="mr-1 inline" aria-hidden="true" />{t("collect.undoWindow", { seconds: Math.floor(COLLECTION_UNDO_WINDOW_MS / 1000) })}
      </p>
      <button type="button" onClick={() => onNavigate("DebtorDetail", { debtId: result.debtId, customerName: result.customerName })} className="min-h-12 text-center text-lg font-extrabold text-emerald-900 underline">
        {t("collect.seeDetails", { name: displayName(result.customerName) })}
      </button>
      <div className="flex-1" />
      <PosPrimaryButton type="button" onClick={onHome} className="h-[68px] min-h-0 rounded-[20px] text-2xl">{t("collect.done")}</PosPrimaryButton>
      {contactEditorOpen && (
        <CustomerContactEditor
          customer={contact}
          onClose={() => setContactEditorOpen(false)}
          onSave={async (details) => setContact(await onSaveCustomerContact(details))}
        />
      )}
    </PosPage>
  );
}

export function DebtorDetail({ params, onBack, onNavigate, onCollect, onSaveCustomerContact, shopName }) {
  const [contactEditorOpen, setContactEditorOpen] = useState(false);
  const editContactOpened = useRef(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionAmount, setCorrectionAmount] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionNote, setCorrectionNote] = useState("");
  const [correctionDebtSnapshot, setCorrectionDebtSnapshot] = useState(null);
  const [correctionError, setCorrectionError] = useState("");
  const [correctionSaving, setCorrectionSaving] = useState(false);
  // Wiring 54 "When the sheet first opens": no message until the owner changes the pre-filled value.
  const [correctionChanged, setCorrectionChanged] = useState(false);
  useBackBlock(correctionSaving);
  useBackHandler(correctionOpen, () => setCorrectionOpen(false));
  const data = useLiveQuery(async () => {
    const selectedDebt = params?.debtId ? await db.debts.get(params.debtId) : null;
    const name = selectedDebt?.customerName ?? selectedDebt?.customer_name ?? params?.customerName ?? "";
    const customerId = selectedDebt?.customerId ?? params?.customerId ?? "";
    if (!name) return null;
    const normalizedName = name.trim().toLowerCase();
    const debts = await db.debts.toArray();
    const customerDebts = debts.filter((debt) => (
      (customerId && debt.customerId === customerId) ||
      (!customerId && (debt.customer_name ?? debt.customerName ?? "").trim().toLowerCase() === normalizedName)
    ));
    const debtIds = new Set(customerDebts.map((debt) => debt.id));
    const customer = customerId
      ? await db.customers.get(customerId)
      : await db.customers.where("nameLower").equals(normalizedName).first();
    const history = await loadCustomerHistory(customer?.id, name);
    // rules_global.reminders: the latest reminder recorded for this person (any screen).
    const lastReminderAt = latestReminderAt(await loadReminderEvents(), { customerId: customer?.id ?? customerId, customerName: name });
    const historyRows = groupCollectionHistory(history.events);
    const selectedOpenDebt = customerDebts.find((debt) => debt.id === selectedDebt?.id && debt.status === "unpaid");
    const unpaidDebts = customerDebts.filter((debt) => debt.status === "unpaid");
    const shownDebt = selectedOpenDebt ?? unpaidDebts[0] ?? selectedDebt ?? customerDebts[0];
    // Money paid against the plan's debt, for the plan card (getPlanProgress).
    const planPaidPesewas = shownDebt?.isInstallmentPlan
      ? getPlanPaidPesewas(getCustomerLedgerRecords({
          customerId: customer?.id ?? customerId,
          customerName: name,
          debts,
          transactions: await db.transactions.toArray(),
          payments: await db.payments.toArray()
        }), shownDebt.id)
      : 0;
    return {
      name,
      customerId: customer?.id ?? customerId,
      phone: customer?.phone || selectedDebt?.phone || selectedDebt?.customer_phone || "",
      ghanaCardNumber: customer?.ghanaCardNumber || selectedDebt?.ghanaCardNumber || "",
      balancePesewas: getOutstandingDebtPesewas(customerDebts),
      debt: shownDebt,
      planPaidPesewas,
      unpaidDebts: unpaidDebts.sort((left, right) => (
        (right.createdAt ?? right.created_at ?? 0) - (left.createdAt ?? left.created_at ?? 0)
      )),
      unpaidDebtCount: unpaidDebts.length,
      lastReminderAt,
      history: historyRows
    };
  }, [params?.debtId, params?.customerName], undefined);
  useEffect(() => {
    if (!params?.editContact) {
      editContactOpened.current = false;
      return;
    }
    if (data && !editContactOpened.current) {
      editContactOpened.current = true;
      setContactEditorOpen(true);
    }
  }, [params?.editContact, data]);
  const phone = normalizeWhatsAppPhone(data?.phone);
  const reminderLink = data && generateWhatsAppLink(data.phone, data.name, data.balancePesewas, shopName);
  const lastReminderAt = data?.lastReminderAt ?? 0;
  const lastReminderLabel = formatLastReminder(lastReminderAt);
  // rules_global.reminders: both WhatsApp reminder controls go through the shared path, which
  // records a reminder for this person when the app hands over to WhatsApp.
  const reminders = useReminderCheck();
  const reminderPerson = data ? { customerId: data.customerId ?? "", name: data.name } : null;
  // 29/43 with no valid phone: WhatsApp stays on and opens the share sheet with the reminder text, the
  // owner picks the chat (the same share logic as the receipts). A closed share sheet records nothing.
  const reminderText = data ? buildWhatsAppReminderText(data.name, data.balancePesewas, shopName) : null;
  const shareReminder = () => sendReceipt({ text: reminderText, title: t("collect.remindOnWhatsApp") });
  // The WhatsApp control: a direct link to the saved number, or the share sheet without one.
  function reminderControl({ label, ariaLabel, className, children }) {
    if (phone && reminderLink) {
      return <a href={reminderLink} target="_blank" rel="noopener noreferrer" onClick={(event) => reminders.onReminder(event, { person: reminderPerson, lastReminderAt, href: reminderLink })} aria-label={ariaLabel} className={className}>{children}</a>;
    }
    return <button type="button" disabled={!reminderText} onClick={(event) => (reminderText ? reminders.onReminder(event, { person: reminderPerson, lastReminderAt, share: shareReminder }) : undefined)} aria-label={ariaLabel ?? label} className={className}>{children}</button>;
  }
  // Wiring 29/43 "Collection receipt" (15 Nov 2026): Receipt and Copy receipt cover the person's latest
  // payment only, and the label says so. A person who never paid has no receipt buttons. They show only
  // with VITE_ENABLE_POS_RECEIPTS on. Send goes through the same share logic as 28, 30 and 31.
  const latestPayment = data?.history?.find((row) => row.type === "payment" && row.amountPesewas > 0) ?? null;
  const balanceReceiptText = isReceiptTemplatesEnabled() && data && latestPayment
    ? latestPaymentReceiptOrNull({ shopName, customerName: data.name, payment: latestPayment, balancePesewas: data.balancePesewas, plan: data.debt?.status === "unpaid" ? data.debt : null })
    : null;
  const balanceActions = useReceiptActions(balanceReceiptText ?? "", phone ?? "");
  const receiptLabel = latestPayment ? t("collect.receiptForPayment", { amount: formatGhs(latestPayment.amountPesewas) }) : "";
  const balanceReceiptButton = balanceReceiptText && (
    <button type="button" onClick={() => void balanceActions.send()} className="flex min-h-14 w-full min-w-0 items-center justify-center gap-2 rounded-2xl border-2 border-emerald-900 bg-white px-2 text-base font-extrabold text-emerald-900 sm:text-[17px]">
      <ReceiptText size={26} aria-hidden="true" /> <span className="min-w-0 truncate">{receiptLabel}</span>
    </button>
  );
  const dueDate = data?.debt?.isInstallmentPlan ? data.debt.nextDueDate : data?.debt?.dueDate;
  const dueLabel = data?.debt && getDebtDueLabel(dueDate);
  const isLate = Boolean(dueLabel?.startsWith("Late "));
  // 29 and 43: a fixed due date with no plan gets "Due dd/mm/yyyy · In N days" under the balance.
  // An installment plan keeps its own line (the plan card), and a late plan its late line.
  const dueLine = data?.debt && !data.debt.isInstallmentPlan && dueDate ? getDebtDueLine(dueDate) : "";
  // Plan card (wiring 25/43): paid, left and the bar from money only, never the stored counters.
  const planProgress = getPlanProgress({
    balancePesewas: getInstallmentsLeft(data?.debt) > 0 ? data.debt.amountPesewas ?? data.debt.total_owed : 0,
    installmentAmountPesewas: data?.debt?.installmentAmount,
    paidPesewas: data?.planPaidPesewas ?? 0
  });
  const installmentProgress = planProgress.progress * 100;
  const nextDueDate = dueDate ? formatDate(dueDate) : t("collect.notSet");
  const installmentFrequency = ["weekly", "bi-weekly", "monthly"].includes(data?.debt?.frequency)
    ? t(`collect.installmentFrequency.${data.debt.frequency}`)
    : t("collect.notSet");
  const correctionCurrentBalancePesewas = correctionDebtSnapshot?.amountPesewas ?? 0;
  const correctionNewBalancePesewas = toPesewas(correctionAmount);
  const correctionAmountValid = correctionAmount.trim() !== "" &&
    Number.isSafeInteger(correctionNewBalancePesewas) &&
    correctionNewBalancePesewas >= 0 &&
    correctionNewBalancePesewas < correctionCurrentBalancePesewas;
  const correctionReasonValid = Boolean(correctionReason) &&
    (correctionReason !== "other" || correctionNote.trim() !== "");
  const correctionCanSave = correctionAmountValid && correctionReasonValid && !correctionSaving;
  const singleDebtMatchesTotal = data?.unpaidDebtCount === 1 &&
    (data.debt?.amountPesewas ?? data.debt?.total_owed ?? 0) === data?.balancePesewas;
  const correctionTargetGuidance = correctionDebtSnapshot?.openDebtCount > 1
    ? "This customer has multiple open debt records. Choose an individual entry below to correct it."
    : "The selected debt record does not match the customer total. Choose the individual entry below to correct it.";
  const correctionHasSingleDebtTarget = correctionDebtSnapshot?.individual === true ||
    (correctionDebtSnapshot?.openDebtCount === 1 &&
      correctionDebtSnapshot.targetAmountPesewas === correctionDebtSnapshot.customerTotalPesewas &&
      correctionDebtSnapshot.targetAmountPesewas === correctionCurrentBalancePesewas);
  // rules_global.form_errors: shown after Save correction with a problem, gone as soon as it is fixed.
  const correctionAmountUsable = correctionAmount.trim() !== "" && Number.isSafeInteger(correctionNewBalancePesewas) && correctionNewBalancePesewas >= 0;
  const correctionErrors = useFormErrors([
    ["amount", correctionAmountUsable ? "" : "Enter a valid non-negative balance."],
    ["increase", correctionAmountUsable && correctionNewBalancePesewas > correctionCurrentBalancePesewas ? "Corrections cannot increase debt. Use Add to debt." : ""],
    ["lower", correctionAmountUsable && correctionNewBalancePesewas === correctionCurrentBalancePesewas ? "New balance must be lower." : ""],
    ["target", correctionHasSingleDebtTarget ? "" : "Choose Correct this entry beside an individual debt before saving."],
    ["reason", correctionReason ? "" : "Choose a reason for correcting the balance."],
    ["note", correctionReason === "other" && !correctionNote.trim() ? "Add a note when the correction reason is Other." : ""]
  ]);

  function openCorrection(targetDebt = data?.debt, individual = false) {
    const targetAmountPesewas = targetDebt?.amountPesewas ?? targetDebt?.total_owed ?? 0;
    const debtSnapshot = targetDebt ? {
      id: targetDebt.id,
      updatedAt: targetDebt.updatedAt,
      amountPesewas: individual ? targetAmountPesewas : data.balancePesewas,
      targetAmountPesewas,
      individual,
      openDebtCount: data.unpaidDebtCount,
      customerTotalPesewas: data.balancePesewas
    } : null;
    setCorrectionDebtSnapshot(debtSnapshot);
    setCorrectionAmount(debtSnapshot ? (debtSnapshot.amountPesewas / 100).toFixed(2) : "");
    setCorrectionReason("");
    setCorrectionChanged(false);
    setCorrectionNote("");
    setCorrectionError("");
    correctionErrors.clear();
    setCorrectionOpen(true);
  }

  async function saveCorrection(event) {
    event.preventDefault();
    const newBalancePesewas = correctionNewBalancePesewas;
    setCorrectionError("");
    if (!correctionErrors.check()) return;
    setCorrectionSaving(true);
    setCorrectionError("");
    try {
      await correctDebtBalance({
        debtId: correctionDebtSnapshot.id,
        expectedUpdatedAt: correctionDebtSnapshot.updatedAt,
        newBalancePesewas,
        reasonCode: correctionReason,
        reasonNote: correctionNote
      });
      setCorrectionOpen(false);
    } catch (error) {
      console.error("Could not correct the POS customer debt.", error);
      setCorrectionError(
        error.message === "The debt changed before the balance could be corrected."
          ? "This debt changed after you opened the editor. Close and reopen the correction form."
          : error.message || "The balance could not be corrected."
      );
    } finally {
      setCorrectionSaving(false);
    }
  }

  return (
    <PosPage className="!min-h-[calc(100vh-4rem)] !pb-6 mx-auto flex max-w-2xl flex-col gap-3 px-4 sm:px-6">
      {data === undefined ? <p role="status">{t("collect.loading")}</p> : !data ? <CollectionError>{t("collect.notFound")}</CollectionError> : (
        <>
          {/* Wiring 29/43 Back (to BACK: the previous screen in history, so the place on 32 or 22 is kept),
              top left on the name's row; it takes the place of the initial circle, so a long name still has
              room at 340px. Edit contact (polish 16 Nov 2026) is on its own row under them, 48px high, its
              left edge on Back's left edge. */}
          <section data-row="debtor-header" className="flex flex-col items-start gap-2 rounded-[20px] border-2 border-slate-500 bg-white px-3 py-3">
            <span className="flex w-full min-w-0 items-start gap-3">
              <PosBackButton onClick={onBack} />
              <span className="flex min-h-[52px] min-w-0 flex-1 flex-col justify-center">
                <strong className="line-clamp-2 break-words text-[22px] leading-tight">{displayName(data.name)}</strong>
                {data.ghanaCardNumber && <span className="text-base text-slate-800">{t("collect.customerId", { number: formatGhanaCard(data.ghanaCardNumber) })}</span>}
              </span>
            </span>
            <button type="button" data-edit-contact="" onClick={() => setContactEditorOpen(true)} className="flex h-12 items-center gap-1.5 whitespace-nowrap rounded-xl border-2 border-emerald-900 px-2 text-sm font-extrabold text-emerald-900">
              <UserRoundPen size={20} className="shrink-0" aria-hidden="true" />{t("collect.editContact")}
            </button>
          </section>
          <section className="amount-fit-container rounded-[20px] bg-rose-200 px-4 py-3">
            <p className="text-lg font-bold text-rose-950">{t("collect.balanceOwed", { name: displayName(data.name) })}</p>
            <p className="amount-fit font-extrabold text-rose-950">{formatGhs(data.balancePesewas)}</p>
            {dueLine
              ? <p className="mt-1 font-bold text-rose-950">{dueLine}</p>
              : dueLabel?.startsWith("Late ") && <p className="mt-1 font-bold text-rose-950">{dueLabel}</p>}
          </section>
          {/* 43: the wide WhatsApp reminder on top (with or without a saved number). */}
          {isLate && reminderText && (
            <div className="flex flex-col gap-1">
              {reminderControl({
                label: t("collect.remindOnWhatsApp"),
                className: "flex h-16 w-full items-center justify-center gap-2.5 rounded-[18px] border-[3px] border-emerald-900 bg-white px-3 text-lg font-extrabold text-emerald-900",
                children: <><WhatsAppIcon /> {t("collect.remindOnWhatsApp")}</>
              })}
            </div>
          )}
          {/* Action buttons (wiring 29 and 43): one row that never wraps at 340px and wider, icon above
              the label, 48px or taller. 29: Collect | WhatsApp | Call. 43: Collect | Call. Call is greyed
              and disabled without a valid phone. Add contact is not here (Edit contact in the header). */}
          <div data-row="debtor-actions" className={`grid gap-2 sm:gap-3 ${isLate ? "grid-cols-2" : "grid-cols-3"}`}>
            <button type="button" disabled={data.balancePesewas <= 0 || !data.debt?.id} onClick={() => onCollect(data.debt)} className={`${ACTION_BUTTON} border-emerald-900 bg-emerald-900 text-white disabled:opacity-50`}>
              <Banknote size={26} aria-hidden="true" /><span>{t("collect.collect")}</span>
            </button>
            {!isLate && reminderControl({
              label: "Reminder",
              ariaLabel: `WhatsApp reminder for ${displayName(data.name)}`,
              className: `${ACTION_BUTTON} border-emerald-900 bg-white text-emerald-900 disabled:opacity-50`,
              children: <><WhatsAppIcon size={26} /><span>Reminder</span></>
            })}
            {phone
              ? <a href={`tel:${phone}`} className={`${ACTION_BUTTON} border-slate-500 bg-slate-300 text-slate-950`}>
                  <Phone size={26} aria-hidden="true" /><span>{t("collect.call")}</span>
                </a>
              : <button type="button" disabled aria-disabled="true" className={`${ACTION_BUTTON} cursor-not-allowed border-slate-300 bg-slate-100 text-slate-500`}>
                  <Phone size={26} aria-hidden="true" /><span>{t("collect.call")}</span>
                </button>}
          </div>
          {/* Wiring 29/43: Last reminder, under the action buttons and above Correct balance. Per
              person; it says when the reminder was handed to WhatsApp, never that it was delivered. */}
          <p data-last-reminder="" className="text-center text-base text-slate-800">{lastReminderLabel}</p>
          {/* Wiring 29/43 (16 Nov 2026): "Show {Name} the record" under the Last reminder line opens 73,
              look-only, for the customer to read. One line: a long name is cut, never the words around it. */}
          <button
            type="button"
            data-show-record=""
            aria-label={t("record.show", { name: displayName(data.name) })}
            onClick={() => onNavigate("CustomerRecordView", { customerId: data.customerId, customerName: data.name })}
            className="flex h-[52px] w-full min-w-0 items-center justify-center gap-1 whitespace-nowrap rounded-[14px] border-2 border-[#0F172A] bg-white px-3 text-lg font-extrabold text-[#0F172A]"
          >
            <span className="shrink-0">Show</span>{" "}
            <span className="min-w-0 truncate">{displayName(data.name)}</span>{" "}
            <span className="shrink-0">the record</span>
          </button>
          {balanceReceiptText && (
            <>
              <div className="flex flex-col gap-2">
                {balanceReceiptButton}
                <ReceiptOfflineLine online={balanceActions.online} />
              </div>
              <CopyReceiptButton onClick={() => void balanceActions.copy()} copied={balanceActions.copied} />
              <ReceiptFailedLine failed={balanceActions.failed} />
            </>
          )}
          {singleDebtMatchesTotal && (
            <button type="button" onClick={() => openCorrection()} disabled={!data.debt?.id || data.balancePesewas <= 0} className="mt-2 h-[54px] w-full rounded-2xl border-2 border-slate-500 bg-white px-4 text-lg font-extrabold text-slate-900 disabled:opacity-50">
              Correct balance
            </button>
          )}
          {data.debt?.isInstallmentPlan && (
            <section className="flex flex-col gap-1.5 rounded-[18px] border-2 border-emerald-900 bg-green-100 px-3.5 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <strong className="text-lg">{t("collect.installmentTitle")}</strong>
                {/* The shared due tag colours: grey more than 3 days, amber 3 days or less or today, red late. */}
                <DueTag dueDate={dueDate} />
              </div>
              <p>{formatGhs(data.debt.installmentAmount)} {installmentFrequency}</p>
              <div
                role="progressbar"
                aria-label={t("collect.installmentTitle")}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(installmentProgress)}
                className="h-3.5 w-full overflow-hidden rounded-md border-2 border-emerald-900 bg-white"
              >
                <span className="block h-full bg-emerald-900" style={{ width: `${installmentProgress}%` }} />
              </div>
              {/* Wiring 29/43 plan card (12 Nov 2026): two full-width lines, never two wrapped columns. */}
              <div data-plan-lines="" className="flex flex-col gap-0.5 text-sm font-extrabold">
                <p data-plan-line="paid" className="w-full">{t(planProgress.left === 1 ? "collect.installmentPaidOne" : "collect.installmentPaid", {
                  paid: formatGhs(data?.planPaidPesewas ?? 0),
                  left: planProgress.left
                })}</p>
                <p data-plan-line="next" className="w-full">{t("collect.nextPaymentLine", { date: nextDueDate })}</p>
              </div>
            </section>
          )}
          {/* Wiring 29/43 "No open debt entries" (15 Nov 2026): no heading and no line without an open entry. */}
          {data.unpaidDebtCount > 0 && (data.unpaidDebtCount > 1 || !singleDebtMatchesTotal) && (
            <section className="mt-2">
              <h2 className="mb-2 text-[22px] font-extrabold leading-tight">Open debt entries</h2>
              <ul className="overflow-hidden rounded-[18px] border-2 border-slate-500 bg-white">
                {data.unpaidDebts.map((debt) => {
                  const amountPesewas = debt.amountPesewas ?? debt.total_owed ?? 0;
                  // Each entry shows its own reason, generated words hidden, or "No reason written".
                  const detail = getDebtEntryReason(debt) || t("creditRow.noReason");
                  return (
                    <li key={debt.id} className="flex flex-wrap items-center gap-3 border-b-2 border-slate-300 px-3.5 py-3 last:border-b-0">
                      <span className="min-w-0 flex-1">
                        <strong className="block text-lg">{formatGhs(amountPesewas)}</strong>
                        <span className="block text-sm text-slate-800">
                          {detail} · {formatHistoryRowTimestamp(debt.createdAt ?? debt.created_at)}
                        </span>
                      </span>
                      <button type="button" onClick={() => openCorrection(debt, true)} className="min-h-11 rounded-xl border-2 border-emerald-900 bg-white px-3 text-sm font-extrabold text-emerald-900">
                        Correct this entry
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[22px] font-extrabold leading-tight">{t("collect.onTimeHistory")}</h2>
              <button
                type="button"
                onClick={() => onNavigate("ManualDebtAmount", {
                  manualDebt: true,
                  customer: {
                    id: data.customerId,
                    name: data.name,
                    phone: data.phone,
                    ghanaCardNumber: data.ghanaCardNumber,
                    totalDebtPesewas: data.balancePesewas,
                    debt: data.debt
                  },
                  debtId: data.debt?.id
                })}
                className="h-[54px] shrink-0 rounded-2xl border-2 border-emerald-900 bg-white px-4 text-lg font-extrabold text-emerald-900"
              >
                + Add to debt
              </button>
            </div>
            {data.history.length ? (
              <ul className="overflow-hidden rounded-[18px] border-2 border-slate-500 bg-white">
                {data.history.map((event) => (CREDIT_ROW_TYPES.has(event.type) ? (
                  // rules_global.customer_proof (16 Nov 2026): every credit row says what it was for ("No reason
                  // written" when nothing was given) and whether the customer signed it. An unsigned credit at or
                  // above the threshold offers Get signature, which opens 72 for that entry; 72 returns here.
                  <li key={event.id} data-credit-row="" className="flex min-w-0 flex-col gap-1 border-b-2 border-slate-300 px-3.5 py-3 last:border-b-0">
                    <span className="flex min-w-0 items-center gap-3">
                      <strong className="min-w-0 flex-1 truncate text-lg">{event.type === "addon" ? t("collect.creditAdded") : t("collect.creditTaken")}</strong>
                      <strong className="shrink-0 whitespace-nowrap text-lg text-rose-900">{formatGhs(event.amountPesewas)}</strong>
                    </span>
                    {/* Polish 16 Nov 2026: title and amount, then the date, then the reason (both 16px), then the tag; the same order as 73. */}
                    <span data-when="" className="block text-base text-slate-800">{rowWhen(event)}</span>
                    <span data-reason="" className="block break-words text-base text-slate-900">{rowReason(event)}</span>
                    <span className="flex min-w-0 items-center justify-between gap-2">
                      <SignedTag signed={event.signed} />
                      {!event.signed && event.transactionId && needsSignature(event.amountPesewas) && (
                        <button type="button" onClick={() => onNavigate("CustomerSignature", { transactionId: event.transactionId })} className="min-h-12 shrink-0 whitespace-nowrap rounded-xl border-2 border-emerald-900 bg-white px-3 text-base font-extrabold text-emerald-900">
                          {t("creditRow.getSignature")}
                        </button>
                      )}
                    </span>
                  </li>
                ) : event.type === "adjustment" ? (
                  // Wiring 29/43 (16 Nov 2026): Balance corrected on its own line, then old → new, then date and reason.
                  <li key={event.id} data-correction-row="" className="flex min-w-0 flex-col gap-1 border-b-2 border-slate-300 px-3.5 py-3 last:border-b-0">
                    <CorrectionLines event={event} />
                  </li>
                ) : (
                  <li key={event.id} className="flex min-h-12 items-center gap-3 border-b-2 border-slate-300 px-3.5 py-3 last:border-b-0">
                    <span className="min-w-0 flex-1">
                      <strong className="block text-lg">{t("collect.paid")}</strong>
                      <span className="block text-sm text-slate-800">
                        {formatHistoryRowTimestamp(event.timestamp)}
                        {/* rules_global.customer_proof.paid_order: Cash first, then MoMo (the shared helper 73 uses). */}
                        <> · {paidParts(event)}</>
                      </span>
                    </span>
                    <strong className="shrink-0 text-lg text-emerald-900">+ {formatGhs(event.amountPesewas)}</strong>
                  </li>
                )))}
              </ul>
            ) : <p className="mt-2 text-slate-700">{t("collect.noPaymentHistory")}</p>}
          </section>
          <div className="flex-1" />
          <PosPrimaryButton type="button" onClick={onBack} className="h-[68px] min-h-0 rounded-[20px] text-2xl">
            {t("collect.done")}
          </PosPrimaryButton>
        </>
      )}
      {contactEditorOpen && data && (
        <CustomerContactEditor
          customer={data}
          onClose={() => setContactEditorOpen(false)}
          onSave={async (details) => {
            const customer = await onSaveCustomerContact(details);
            if (params?.returnToOwed) onBack();
            return customer;
          }}
        />
      )}
      {correctionOpen && data?.debt && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="pos-correction-title" className="safe-bottom max-h-[92dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-[28px] border-t-[3px] border-slate-900 bg-white px-4 pb-4 pt-3 shadow-xl sm:rounded-t-[28px]">
            <div className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-slate-500" aria-hidden="true" />
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <h2 id="pos-correction-title" className="text-2xl font-extrabold">Correct balance</h2>
                <p className="text-base text-slate-800">{displayName(data.name)} · now owed <strong>{formatGhs(correctionCurrentBalancePesewas)}</strong></p>
              </div>
              <button type="button" onClick={() => setCorrectionOpen(false)} aria-label="Close balance correction" className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-[14px] border-2 border-slate-900 bg-white text-slate-900">
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <form onSubmit={saveCorrection} className="space-y-3">
              <label className="block text-[19px] font-extrabold" htmlFor="pos-correction-amount">New balance
                {/* rules_global.amount_entry: right-aligned, GH₵ on the left, focus selects the amount. */}
                <span className="mt-1 flex h-14 items-center gap-2 rounded-[14px] border-[3px] border-emerald-900 px-3 focus-within:ring-2 focus-within:ring-emerald-900/20">
                  <span className="shrink-0 text-lg font-bold text-slate-700">GH₵</span>
                  {/* Focused on open, so the shared field selects the pre-filled balance (the first digit replaces it). */}
                  <AmountTextInput id="pos-correction-amount" autoFocus value={correctionAmount} onValue={(value) => { setCorrectionAmount(value); setCorrectionChanged(true); setCorrectionError(""); }} className="h-full w-full min-w-0 bg-transparent text-[28px] font-extrabold outline-none" />
                </span>
              </label>
              {/* Wiring 54 (16 Nov 2026): no line when the sheet first opens (until the value changes) and
                  none for an empty field; Save correction is only disabled. */}
              {correctionChanged && correctionAmount.trim() !== "" && (
                <p className={`text-lg font-extrabold ${correctionNewBalancePesewas < correctionCurrentBalancePesewas ? "text-emerald-900" : "text-slate-700"}`}>
                  {Number.isSafeInteger(correctionNewBalancePesewas) && correctionNewBalancePesewas < correctionCurrentBalancePesewas
                    ? `This lowers the debt by ${formatGhs(correctionCurrentBalancePesewas - correctionNewBalancePesewas)}`
                    : correctionNewBalancePesewas > correctionCurrentBalancePesewas
                      ? "Corrections cannot increase debt. Use Add to debt."
                      : "New balance must be lower."}
                </p>
              )}
              <fieldset>
                <legend className="text-[19px] font-extrabold">Reason</legend>
                <div className="mt-1 flex flex-wrap gap-2">
                  {[
                    ["wrong_amount", "Wrong amount entered"],
                    ["customer_dispute", "Customer dispute"],
                    ["returned_goods", "Goods returned"],
                    ["debt_forgiven", "Debt forgiven"],
                    ["other", "Other"]
                  ].map(([value, label]) => (
                    <button key={value} type="button" aria-pressed={correctionReason === value} onClick={() => { setCorrectionReason(value); setCorrectionError(""); }} className={`min-h-12 rounded-full border-[3px] px-3.5 text-[17px] font-extrabold ${correctionReason === value ? "border-emerald-900 bg-emerald-900 text-white" : "border-slate-500 bg-white text-slate-900"}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </fieldset>
              {correctionReason === "other" && (
                <label className="block text-sm font-bold" htmlFor="pos-correction-note">Correction note
                  <textarea id="pos-correction-note" rows="3" value={correctionNote} onChange={(event) => setCorrectionNote(event.target.value)} className="mt-1 w-full rounded-xl border-2 border-slate-300 px-3 py-2 outline-none focus:border-emerald-800" />
                </label>
              )}
              {!correctionHasSingleDebtTarget && <p className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-950">{correctionTargetGuidance}</p>}
              <p className="text-base text-slate-800">No cash moves. Use Collect for money received.</p>
              {(correctionErrors.message || correctionError) && <p role="alert" className="rounded-xl bg-rose-100 p-3 font-semibold text-rose-950">{correctionErrors.message || correctionError}</p>}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <PosPrimaryButton type="submit" disabled={!correctionCanSave || !correctionHasSingleDebtTarget}>{correctionSaving ? "Saving…" : "Save correction"}</PosPrimaryButton>
                <PosSecondaryButton type="button" onClick={() => setCorrectionOpen(false)} disabled={correctionSaving}>Cancel</PosSecondaryButton>
              </div>
            </form>
          </section>
        </div>
      )}
      {reminders.sheet}
    </PosPage>
  );
}
