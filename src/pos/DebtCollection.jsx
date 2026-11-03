import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Banknote, Check, Clock3, Delete, MessageCircle, Phone, Plus, Smartphone, Undo2, UserRoundPen, X } from "lucide-react";
import { db } from "../db/db.js";
import { COLLECTION_UNDO_WINDOW_MS, undoDebtCollection } from "../db/debts.js";
import { formatGhs, toPesewas } from "../lib/money.js";
import { formatGhanaCard } from "../utils/formatters.js";
import { formatHistoryTimestamp } from "../utils/customerDebtHistory.js";
import { loadCustomerHistory } from "../utils/loadCustomerDebtHistory.js";
import { getOutstandingDebtPesewas } from "../utils/financials.js";
import { generateWhatsAppLink, normalizeWhatsAppPhone } from "../utils/whatsapp.js";
import { buildCollectionReceiptLink, buildCollectionReceiptMessage } from "./collectionReceipt.js";
import { normalizeCollectionAmountInput } from "./collectionSplit.js";
import { getDebtDueLabel } from "./money.js";
import { posText as t } from "./i18n.js";
import { PosPage, PosPrimaryButton, PosSecondaryButton, PosStatusTag } from "./PosComponents.jsx";
import CustomerContactEditor from "./CustomerContactEditor.jsx";
import { SplitTenderFields } from "./PaymentSplit.jsx";
import { areSplitTenderAmountsComplete } from "./splitTender.js";

const PAYMENT_METHODS = [
  { value: "cash", label: "collect.cash", icon: Banknote },
  { value: "momo", label: "collect.momo", icon: Smartphone }
];

function groupCollectionHistory(events) {
  const rows = new Map();
  for (const event of events) {
    if (event.type !== "payment" || !event.collectionId) {
      rows.set(event.id, event);
      continue;
    }
    const id = `collection-${event.collectionId}`;
    const row = rows.get(id) ?? {
      id,
      type: "payment",
      timestamp: event.timestamp,
      amountPesewas: 0,
      collectionParts: []
    };
    row.amountPesewas += event.amountPesewas;
    row.collectionParts.push({ method: event.method, amountPesewas: event.amountPesewas });
    rows.set(id, row);
  }
  return [...rows.values()].sort((left, right) => right.timestamp - left.timestamp);
}

function formatHistoryRowTimestamp(timestamp) {
  const value = timestamp instanceof Date ? timestamp.getTime() : Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return formatHistoryTimestamp(timestamp).date;
  const date = new Date(value);
  const today = new Date();
  const isToday = date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return isToday ? `Today ${time}` : `${date.toLocaleDateString("en-GB")} ${time}`;
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

function PaymentMethodPicker({ value, onChange }) {
  return (
    <fieldset>
      <legend className="mb-2 text-lg font-extrabold">{t("collect.howPaying")}</legend>
      <div className="grid grid-cols-2 gap-2">
        {PAYMENT_METHODS.map(({ value: method, label, icon: Icon }) => (
          <button
            key={method}
            type="button"
            aria-pressed={value === method}
            onClick={() => onChange(method)}
            className={`flex min-h-14 min-w-0 flex-row items-center justify-center gap-1 rounded-2xl border-[3px] px-1 text-sm font-extrabold sm:min-h-16 sm:gap-1.5 sm:px-2 sm:text-base ${value === method ? "border-emerald-900 bg-green-200 text-slate-950" : "border-slate-500 bg-white text-slate-950"}`}
          >
            <Icon size={20} className="shrink-0 sm:h-[22px] sm:w-[22px]" aria-hidden="true" />
            <span className="min-w-0 truncate">{t(label)}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function CollectionError({ children }) {
  return children ? <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{children}</p> : null;
}

function SheetAmount({ amountPesewas }) {
  return (
    <div className="amount-fit-container flex min-h-16 items-center justify-between gap-2 rounded-2xl border-[3px] border-slate-500 px-4">
      <span className="text-lg font-bold text-slate-700">GHS</span>
      <span className="amount-fit text-right font-extrabold">{formatGhs(amountPesewas)}</span>
    </div>
  );
}

function CollectionSheet({ debt, onClose, onNavigate, onRecordCollection }) {
  const [mode, setMode] = useState("due");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dueAmount = debt.isInstallmentPlan && Number.isSafeInteger(debt.installmentAmount) && debt.installmentAmount > 0
    ? Math.min(debt.amountPesewas, debt.installmentAmount)
    : debt.amountPesewas;
  const amountPesewas = mode === "all" ? debt.amountPesewas : dueAmount;

  async function receivePayment() {
    if (busy || amountPesewas <= 0) return;
    setBusy(true);
    setError("");
    try {
      await onRecordCollection(debt.id, [{ paymentMethod, amountPesewas }]);
    } catch (recordError) {
      console.error("Could not record the debt collection.", recordError);
      setError(t("collect.saveFailed"));
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
            <h1 id="collect-title" className="text-2xl font-extrabold">{t("collect.from", { name: debt.customerName })}</h1>
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
            <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)} className={`min-h-12 rounded-xl border-2 px-2 text-sm font-extrabold sm:text-base ${mode === value ? "border-emerald-900 bg-emerald-900 text-white" : "border-slate-500 bg-white text-slate-950"}`}>
              {t(label)}
            </button>
          ))}
          <button type="button" disabled={busy} onClick={() => onNavigate("CollectPayPart", { debtId: debt.id })} className="min-h-12 rounded-xl border-2 border-slate-500 bg-white px-2 text-sm font-extrabold text-slate-950 disabled:opacity-50 sm:text-base">
            {t("collect.payPart")}
          </button>
        </div>

        <div className="mt-3"><SheetAmount amountPesewas={amountPesewas} /></div>
        {debt.isInstallmentPlan && (
          <p className="mt-2 text-sm font-semibold text-slate-700">
            {t("collect.installmentProgress", {
              payment: (debt.totalInstallments ?? 0) - (debt.installmentsRemaining ?? 0) + 1,
              total: debt.totalInstallments ?? 0,
              left: debt.installmentsRemaining ?? 0
            })}
          </p>
        )}
        <div className="mt-4"><PaymentMethodPicker value={paymentMethod} onChange={setPaymentMethod} /></div>
        <CollectionError>{error}</CollectionError>
        <PosPrimaryButton type="button" onClick={() => void receivePayment()} disabled={busy || amountPesewas <= 0} className="mt-4 h-[68px] min-h-0 rounded-[20px] text-2xl">
          <Check size={28} aria-hidden="true" /> {busy ? t("collect.saving") : t("collect.received")}
        </PosPrimaryButton>
        <button type="button" onClick={() => onNavigate("DebtorDetail", { debtId: debt.id, customerName: debt.customerName })} className="mt-2 min-h-12 w-full text-center text-lg font-extrabold text-emerald-900 underline">
          {t("collect.seeDetails", { name: debt.customerName })}
        </button>
      </section>
    </div>
  );
}

export function CollectPayment({ params, onClose, onNavigate, onRecordCollection }) {
  const debt = useCollectionDebt(params?.debtId, params?.customerName);
  if (debt === undefined) return <CollectionSheetError loading={true} onClose={onClose} />;
  if (!debt) return <CollectionSheetError loading={false} onClose={onClose} />;
  return <CollectionSheet debt={debt} onClose={onClose} onNavigate={onNavigate} onRecordCollection={onRecordCollection} />;
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

function DigitKeypad({ onDigit, disabled = false }) {
  return (
    <div className="grid grid-cols-3 gap-2" aria-label={t("collect.enterAmount")}>
      {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "00"].map((digit) => (
        <button key={digit} type="button" disabled={disabled} onClick={() => onDigit(digit)} style={{ fontSize: 26, fontWeight: 800 }} className="h-[62px] rounded-2xl border-2 border-slate-500 bg-white disabled:opacity-50">{digit}</button>
      ))}
      <button type="button" disabled={disabled} onClick={() => onDigit("backspace")} aria-label={t("collect.deleteLastDigit")} className="flex h-[62px] items-center justify-center rounded-2xl bg-slate-300 disabled:opacity-50">
        <Delete size={26} aria-hidden="true" />
      </button>
    </div>
  );
}

function appendAmountDigit(current, digit) {
  if (digit === "backspace") return current.slice(0, -1);
  if (digit === "00" && current.length === 0) return "0";
  if (digit === "." && current.includes(".")) return current;
  const next = `${current}${digit}`;
  const [whole, fraction] = next.split(".");
  return fraction?.length > 2 || whole.length > 8 ? current : next;
}

export function CollectPayPart(props) {
  return <CollectPayPartScreen {...props} />;
}

export function CollectPartByPart(props) {
  return <CollectPayPartScreen {...props} splitOnly />;
}

function CollectPayPartScreen({ params, onBack, onUpdateParams, onRecordCollection, splitOnly = false }) {
  const debt = useCollectionDebt(params?.debtId, params?.customerName);
  const [amount, setAmount] = useState(() => params?.amount ?? "");
  const [paymentMethod, setPaymentMethod] = useState(() => (
    splitOnly ? "both" : ["cash", "momo"].includes(params?.paymentMethod) ? params.paymentMethod : "cash"
  ));
  const [cashAmount, setCashAmount] = useState(() => params?.cashAmount ?? "");
  const [momoAmount, setMomoAmount] = useState(() => params?.momoAmount ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [splitAttempted, setSplitAttempted] = useState(false);
  const amountPesewas = toPesewas(amount);
  const canReceive = debt && Number.isSafeInteger(amountPesewas) && amountPesewas > 0 && amountPesewas <= debt.amountPesewas;
  const cashAmountPesewas = toPesewas(cashAmount);
  const momoAmountPesewas = toPesewas(momoAmount);
  const splitComplete = areSplitTenderAmountsComplete(amountPesewas, cashAmountPesewas, momoAmountPesewas, true);
  const splitParts = splitComplete
    ? [
      { paymentMethod: "cash", amountPesewas: cashAmountPesewas },
      { paymentMethod: "momo", amountPesewas: momoAmountPesewas }
    ]
    : [];

  function getSplitError() {
    if (!Number.isSafeInteger(cashAmountPesewas) || cashAmountPesewas <= 0 ||
      !Number.isSafeInteger(momoAmountPesewas) || momoAmountPesewas <= 0) {
      return t("collect.splitNeedsBoth");
    }
    const paidPesewas = cashAmountPesewas + momoAmountPesewas;
    if (paidPesewas > amountPesewas) return t("collect.splitOverAmount", { amount: formatGhs(amountPesewas) });
    if (paidPesewas < amountPesewas) return t("collect.splitMustMatch", { amount: formatGhs(amountPesewas) });
    return "";
  }

  async function receivePayment() {
    if (busy || !canReceive) return;
    if (splitOnly && !splitComplete) {
      setSplitAttempted(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onRecordCollection(
        debt.id,
        splitOnly ? splitParts : [{ paymentMethod, amountPesewas }]
      );
    } catch (recordError) {
      console.error("Could not record the partial debt collection.", recordError);
      setError(t("collect.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PosPage className="!min-h-[calc(100vh-4rem)] !pb-6 mx-auto flex max-w-2xl flex-col gap-3 px-4 sm:px-6 lg:justify-center">
      {debt === undefined ? <p role="status">{t("collect.loading")}</p> : !debt ? <CollectionError>{t("collect.notFound")}</CollectionError> : (
        <>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onBack} className="min-h-[52px] shrink-0 rounded-[14px] border-2 border-slate-900 bg-white px-4 text-lg font-extrabold">‹ {t("collect.back")}</button>
            <h1 className="text-2xl font-extrabold">{t(splitOnly ? "collect.splitTitle" : "collect.payPartTitle")}</h1>
          </div>
          <p className="text-lg font-bold">{t("collect.collectFrom", { name: debt.customerName })}</p>
          {splitOnly ? (
            <section className="rounded-[20px] border-2 border-slate-500 bg-white px-4 py-3">
              <p className="text-base font-bold text-slate-800">{t("collect.amountToCollect")}</p>
              <SheetAmount amountPesewas={amountPesewas} />
              <p className="mt-2 text-base font-bold text-rose-900">
                {t("collect.splitRemaining", { amount: formatGhs(Math.max(0, amountPesewas - (cashAmountPesewas || 0) - (momoAmountPesewas || 0))) })}
              </p>
            </section>
          ) : (
            <>
              <section className="rounded-[20px] border-2 border-slate-500 bg-white px-4 py-2 text-right">
                <p className="text-[17px] font-bold text-slate-800">{t("collect.namePays", { name: debt.customerName })}</p>
                <div className="flex items-center justify-end gap-2">
                  <span className="text-lg font-bold text-slate-700">GHS</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    aria-label={t("collect.amountToCollect")}
                    value={amount}
                    onChange={(event) => {
                      const next = normalizeCollectionAmountInput(event.target.value, amount);
                      setAmount(next);
                      onUpdateParams({ amount: next });
                      setError("");
                      setSplitAttempted(false);
                    }}
                    disabled={busy}
                    placeholder="0.00"
                    className="w-full min-w-0 bg-transparent text-right text-[46px] font-extrabold outline-none placeholder:text-slate-400 disabled:opacity-60"
                  />
                </div>
                <p className="text-lg font-bold text-rose-900">{t("collect.leftToPay", { amount: formatGhs(Math.max(0, debt.amountPesewas - (amountPesewas ?? 0))) })}</p>
              </section>
              {amountPesewas > debt.amountPesewas && <CollectionError>{t("collect.amountTooHigh")}</CollectionError>}
              <DigitKeypad onDigit={(digit) => {
                const next = appendAmountDigit(amount, digit);
                setAmount(next);
                onUpdateParams({ amount: next });
                setError("");
                setSplitAttempted(false);
              }} disabled={busy} />
              <PaymentMethodPicker value={paymentMethod} onChange={(method) => {
                setPaymentMethod(method);
                onUpdateParams({ paymentMethod: method });
                setError("");
              }} />
            </>
          )}
          {splitOnly && (
            <section className="space-y-2">
              <SplitTenderFields
                cash={cashAmount}
                momo={momoAmount}
                disabled={busy}
                onCashChange={(value) => {
                  const next = normalizeCollectionAmountInput(value, cashAmount);
                  setCashAmount(next);
                  onUpdateParams({ cashAmount: next });
                  setSplitAttempted(true);
                  setError("");
                }}
                onMomoChange={(value) => {
                  const next = normalizeCollectionAmountInput(value, momoAmount);
                  setMomoAmount(next);
                  onUpdateParams({ momoAmount: next });
                  setSplitAttempted(true);
                  setError("");
                }}
              />
              <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800" aria-live="polite">
                {t("collect.paymentSplit", {
                  cash: formatGhs(cashAmountPesewas ?? 0),
                  momo: formatGhs(momoAmountPesewas ?? 0)
                })}
              </p>
              {splitAttempted && !splitComplete && <CollectionError>{getSplitError()}</CollectionError>}
            </section>
          )}
          <CollectionError>{error}</CollectionError>
          {!splitOnly && (
            <PosSecondaryButton
              type="button"
              disabled={!canReceive || busy}
              onClick={() => onNavigate("CollectPartByPart", { ...params, amount, paymentMethod: "both", cashAmount: "", momoAmount: "" })}
            >
              {t("collect.payPartByPart")}
            </PosSecondaryButton>
          )}
          <PosPrimaryButton type="button" disabled={!canReceive || busy || (splitOnly && !splitComplete)} onClick={() => void receivePayment()} className="h-[68px] min-h-0 rounded-[20px] text-2xl">
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
  const [error, setError] = useState("");
  const [undone, setUndone] = useState(false);
  const [contact, setContact] = useState({
    customerId: result.customerId,
    name: result.customerName,
    phone: result.phone ?? "",
    ghanaCardNumber: result.ghanaCardNumber ?? ""
  });
  const [contactEditorOpen, setContactEditorOpen] = useState(false);
  const totalCash = result.parts.filter((part) => part.paymentMethod === "cash").reduce((sum, part) => sum + part.amountPesewas, 0);
  const totalMomo = result.parts.filter((part) => part.paymentMethod === "momo").reduce((sum, part) => sum + part.amountPesewas, 0);
  const receiptMessage = buildCollectionReceiptMessage({ ...result, phone: contact.phone }, shopName);
  const receiptLink = buildCollectionReceiptLink(contact.phone, receiptMessage);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRemainingSeconds(Math.max(0, Math.ceil((result.undoExpiresAt - Date.now()) / 1000)));
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
        <p className="text-lg text-slate-800">{t("collect.fromLower", { name: result.customerName })}</p>
      </section>

      <section className="flex flex-col gap-2 rounded-[18px] border-2 border-slate-500 bg-white px-4 py-3 text-lg">
        <div className="flex justify-between"><span>{t("collect.cash")}</span><strong>{formatGhs(totalCash)}</strong></div>
        <div className="flex justify-between"><span>{t("collect.momo")}</span><strong>{formatGhs(totalMomo)}</strong></div>
        <div className="border-t-2 border-dashed border-slate-400 pt-2">
          <div className="flex justify-between gap-2">
            <span>{t("collect.customerStillOwes", { name: result.customerName })}</span>
            <strong className="text-rose-900">{formatGhs(result.remainingPesewas)}</strong>
          </div>
        </div>
      </section>

      <CollectionError>{error}</CollectionError>
      <div className="grid grid-cols-2 gap-2">
        <PosSecondaryButton type="button" disabled={busy || remainingSeconds <= 0 || undone} onClick={() => void undo()} className="h-14 min-h-0 rounded-2xl border-rose-900 text-[17px] text-rose-900">
          <Undo2 size={22} aria-hidden="true" /> {t("collect.undo")}
        </PosSecondaryButton>
        {receiptLink && remainingSeconds <= 0 && !undone ? (
          <a href={receiptLink} target="_blank" rel="noopener noreferrer" className="flex h-14 items-center justify-center gap-2 rounded-2xl border-2 border-emerald-900 bg-white px-2 text-center text-[17px] font-extrabold text-emerald-900">
            <MessageCircle size={24} aria-hidden="true" /> {t("collect.receiptShare")}
          </a>
        ) : (
          <button type="button" disabled className="flex h-14 items-center justify-center gap-2 rounded-2xl border-2 border-slate-400 bg-slate-100 px-2 text-center text-sm font-bold text-slate-600">
            <MessageCircle size={24} aria-hidden="true" /> {t("collect.receiptShare")}
          </button>
        )}
      </div>
      {receiptLink && remainingSeconds > 0 && !undone ? (
        <p role="status" className="text-center text-sm font-semibold text-slate-700">{t("collect.receiptWait", { seconds: remainingSeconds })}</p>
      ) : !receiptLink && !undone ? (
        <div className="rounded-xl bg-amber-50 p-3 text-center">
          <p role="status" className="text-sm font-semibold text-slate-800">{t("collect.receiptNoPhone")}</p>
          <button type="button" onClick={() => setContactEditorOpen(true)} className="mt-2 min-h-11 font-extrabold text-emerald-900 underline">
            {t("collect.addPhoneForReceipt")}
          </button>
        </div>
      ) : null}
      <p className="text-center text-[17px] text-slate-800">
        <Clock3 size={16} className="mr-1 inline" aria-hidden="true" />{t("collect.undoWindow", { seconds: Math.floor(COLLECTION_UNDO_WINDOW_MS / 1000) })}
      </p>
      <button type="button" onClick={() => onNavigate("DebtorDetail", { debtId: result.debtId, customerName: result.customerName })} className="min-h-12 text-center text-lg font-extrabold text-emerald-900 underline">
        {t("collect.seeDetails", { name: result.customerName })}
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

export function DebtorDetail({ params, onBack, onCollect, onSaveCustomerContact, shopName }) {
  const [contactEditorOpen, setContactEditorOpen] = useState(false);
  const data = useLiveQuery(async () => {
    const selectedDebt = params?.debtId ? await db.debts.get(params.debtId) : null;
    const name = selectedDebt?.customerName ?? selectedDebt?.customer_name ?? params?.customerName ?? "";
    if (!name) return null;
    const normalizedName = name.trim().toLowerCase();
    const debts = await db.debts.toArray();
    const customerDebts = debts.filter((debt) => (
      (debt.customer_name ?? debt.customerName ?? "").trim().toLowerCase() === normalizedName
    ));
    const debtIds = new Set(customerDebts.map((debt) => debt.id));
    const customer = selectedDebt?.customerId
      ? await db.customers.get(selectedDebt.customerId)
      : await db.customers.where("nameLower").equals(normalizedName).first();
    const history = await loadCustomerHistory(customer?.id, name);
    const historyRows = groupCollectionHistory(history.events);
    const selectedOpenDebt = customerDebts.find((debt) => debt.id === selectedDebt?.id && debt.status === "unpaid");
    return {
      name,
      customerId: customer?.id ?? selectedDebt?.customerId ?? "",
      phone: customer?.phone || selectedDebt?.phone || selectedDebt?.customer_phone || "",
      ghanaCardNumber: customer?.ghanaCardNumber || selectedDebt?.ghanaCardNumber || "",
      balancePesewas: getOutstandingDebtPesewas(customerDebts),
      debt: selectedOpenDebt ?? customerDebts.find((debt) => debt.status === "unpaid") ?? selectedDebt ?? customerDebts[0],
      history: historyRows.slice(0, 8)
    };
  }, [params?.debtId, params?.customerName], undefined);
  useEffect(() => {
    if (params?.editContact && data) setContactEditorOpen(true);
  }, [params?.editContact, data]);
  const phone = normalizeWhatsAppPhone(data?.phone);
  const reminderLink = data && generateWhatsAppLink(data.phone, data.name, data.balancePesewas / 100, shopName);
  const dueDate = data?.debt?.isInstallmentPlan ? data.debt.nextDueDate : data?.debt?.dueDate;
  const dueLabel = data?.debt && getDebtDueLabel(dueDate);
  const paidInstallments = data?.debt?.isInstallmentPlan
    ? Math.max(0, (data.debt.totalInstallments ?? data.debt.installmentsRemaining ?? 0) - (data.debt.installmentsRemaining ?? 0))
    : 0;
  const installmentCount = data?.debt?.isInstallmentPlan
    ? data.debt.totalInstallments ?? paidInstallments + (data.debt.installmentsRemaining ?? 0)
    : 0;
  const progressInstallmentCount = Number.isSafeInteger(installmentCount) && installmentCount > 0
    ? installmentCount
    : 0;
  const completedInstallments = Math.min(progressInstallmentCount, Math.max(0, paidInstallments));
  const installmentProgress = progressInstallmentCount > 0
    ? (completedInstallments / progressInstallmentCount) * 100
    : 0;
  const nextDueDate = dueDate ? new Date(`${dueDate}T00:00:00`).toLocaleDateString("en-GB") : t("collect.notSet");
  const installmentFrequency = ["weekly", "bi-weekly", "monthly"].includes(data?.debt?.frequency)
    ? t(`collect.installmentFrequency.${data.debt.frequency}`)
    : t("collect.notSet");

  return (
    <PosPage className="!min-h-[calc(100vh-4rem)] !pb-6 mx-auto flex max-w-2xl flex-col gap-3 px-4 sm:px-6">
      {data === undefined ? <p role="status">{t("collect.loading")}</p> : !data ? <CollectionError>{t("collect.notFound")}</CollectionError> : (
        <>
          <section className="flex items-center gap-3 rounded-[20px] border-2 border-slate-500 bg-white px-3 py-3">
            <span className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full bg-emerald-900 text-2xl font-extrabold text-white">{data.name.slice(0, 1).toUpperCase()}</span>
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-[22px]">{data.name}</strong>
              {data.ghanaCardNumber && <span className="text-base text-slate-800">{t("collect.customerId", { number: formatGhanaCard(data.ghanaCardNumber) })}</span>}
            </span>
            <button type="button" onClick={() => setContactEditorOpen(true)} className="shrink-0 rounded-xl border-2 border-emerald-900 px-2 py-2 text-sm font-extrabold text-emerald-900">
              <UserRoundPen size={20} className="mx-auto" aria-hidden="true" />{t("collect.editContact")}
            </button>
          </section>
          <section className="amount-fit-container rounded-[20px] bg-rose-200 px-4 py-3">
            <p className="text-lg font-bold text-rose-950">{t("collect.balanceOwed", { name: data.name })}</p>
            <p className="amount-fit font-extrabold text-rose-950">{formatGhs(data.balancePesewas)}</p>
            {dueLabel?.startsWith("Late ") && <p className="mt-1 font-bold text-rose-950">{dueLabel}</p>}
          </section>
          <div className={`grid gap-2 ${phone && reminderLink ? "grid-cols-3" : "grid-cols-2"}`}>
            <button type="button" disabled={data.balancePesewas <= 0 || !data.debt?.id} onClick={() => onCollect(data.debt)} className="flex h-[72px] flex-col items-center justify-center gap-1 rounded-2xl border-2 border-emerald-900 bg-emerald-900 text-[17px] font-extrabold text-white disabled:opacity-50">
              <Banknote size={28} aria-hidden="true" /> {t("collect.collect")}
            </button>
            {phone && reminderLink ? (
              <>
                <a href={reminderLink} target="_blank" rel="noopener noreferrer" className="flex h-[72px] flex-col items-center justify-center gap-1 rounded-2xl border-2 border-emerald-900 bg-white text-[17px] font-extrabold text-emerald-900">
                  <MessageCircle size={30} aria-hidden="true" /> {t("collect.whatsapp")}
                </a>
                <a href={`tel:${phone}`} className="flex h-[72px] flex-col items-center justify-center gap-1 rounded-2xl border-2 border-slate-500 bg-slate-300 text-[17px] font-extrabold text-slate-950">
                  <Phone size={28} aria-hidden="true" /> {t("collect.call")}
                </a>
              </>
            ) : (
              <button type="button" onClick={() => setContactEditorOpen(true)} className="flex h-[72px] flex-col items-center justify-center gap-1 rounded-2xl border-2 border-emerald-900 bg-white text-[15px] font-extrabold text-emerald-900">
                <UserRoundPen size={26} aria-hidden="true" /> {phone ? t("collect.editContact") : t("collect.addContact")}
              </button>
            )}
          </div>
          {data.debt?.isInstallmentPlan && (
            <section className="flex flex-col gap-1.5 rounded-[18px] border-2 border-emerald-900 bg-green-100 px-3.5 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <strong className="text-lg">{t("collect.installmentTitle")}</strong>
                <span className={`rounded-[10px] border-2 px-2 py-0.5 text-sm font-extrabold ${dueLabel?.startsWith("Late ") ? "border-rose-900 bg-rose-100 text-rose-950" : "border-emerald-900 bg-green-100 text-emerald-900"}`}>{dueLabel}</span>
              </div>
              <p>{formatGhs(data.debt.installmentAmount)} {installmentFrequency}</p>
              <div
                role="progressbar"
                aria-label={t("collect.installmentTitle")}
                aria-valuemin={0}
                aria-valuemax={progressInstallmentCount}
                aria-valuenow={completedInstallments}
                className="h-3.5 w-full overflow-hidden rounded-md border-2 border-emerald-900 bg-white"
              >
                <span className="block h-full bg-emerald-900" style={{ width: `${installmentProgress}%` }} />
              </div>
              <div className="flex justify-between gap-2 text-sm font-extrabold">
                <span>{t("collect.installmentPaid", { paid: paidInstallments, left: data.debt.installmentsRemaining ?? 0 })}</span>
                <span>{t("collect.nextLabel", { date: nextDueDate })}</span>
              </div>
            </section>
          )}
          <section>
            <h2 className="mb-1 text-lg font-extrabold">{t("collect.onTimeHistory")}</h2>
            {data.history.length ? (
              <ul className="overflow-hidden rounded-[18px] border-2 border-slate-500 bg-white">
                {data.history.map((event) => (
                  <li key={event.id} className="flex min-h-12 items-center gap-3 border-b-2 border-slate-300 px-3.5 py-2 last:border-b-0">
                    <span className="min-w-0 flex-1">
                      <strong className="block text-lg">{event.type === "payment" ? t("collect.paid") : event.type === "addon" ? t("collect.creditAdded") : t("collect.creditTaken")}</strong>
                      <span className="block text-sm text-slate-800">
                        {formatHistoryRowTimestamp(event.timestamp)}
                        {event.type === "payment" && (
                          <> · {event.collectionParts
                            ? event.collectionParts.map((part) => `${part.method} ${formatGhs(part.amountPesewas)}`).join(", ")
                            : event.method ?? event.detail}</>
                        )}
                      </span>
                    </span>
                    <strong className={`shrink-0 text-lg ${event.type === "payment" ? "text-emerald-900" : "text-rose-900"}`}>
                      {event.type === "payment" ? "+" : ""} {formatGhs(event.amountPesewas)}
                    </strong>
                  </li>
                ))}
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
          onSave={onSaveCustomerContact}
        />
      )}
    </PosPage>
  );
}
