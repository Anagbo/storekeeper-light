import { useCallback, useEffect, useRef, useState } from "react";
import Dexie from "dexie";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, Check, Copy, IdCard, LogOut, MessageCircle, Pencil, UserRoundPlus, X } from "lucide-react";
import { db } from "../db/db.js";
import { addDebtToCustomer } from "../db/debts.js";
import { upsertCustomer } from "../db/customers.js";
import { runTransactionWithTimeout } from "../db/runTransactionWithTimeout.js";
import { createId } from "../lib/ids.js";
import { formatGhs, toPesewas } from "../lib/money.js";
import { requestBackgroundSync } from "../lib/syncRegistration.js";
import { supabase } from "../lib/supabase.js";
import { isValidGhanaCardNumber, normalizeGhanaCardNumber } from "../lib/ghanaCardNumber.js";
import { formatGhanaCard } from "../utils/formatters.js";
import WhatsAppReminderModal from "./WhatsAppReminderModal.jsx";
import { generateWhatsAppLink, normalizeWhatsAppPhone } from "../utils/whatsapp.js";
import { playErrorChime, playSuccessChime, speakConfirmation } from "../utils/audioFeedback.js";
import PaymentMethodToggle from "./PaymentMethodToggle.jsx";

const PAGE_SIZE = 25;

function getDebtPage(after) {
  const indexedDebts = db.debts.where("[status+amountPesewas+id]");
  const page = after
    ? indexedDebts.below(["unpaid", after.amountPesewas, after.id])
    : indexedDebts.between(
        ["unpaid", 0, Dexie.minKey],
        ["unpaid", Dexie.maxKey, Dexie.maxKey]
      );
  return page.reverse().limit(PAGE_SIZE).toArray();
}

function ConfirmPaymentModal({ debt, onCancel, onConfirm, saving }) {
  const [paymentType, setPaymentType] = useState("full");
  const [amount, setAmount] = useState((debt.amountPesewas / 100).toFixed(2));
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [error, setError] = useState("");
  const submitLock = useRef(false);

  async function submitPayment(event) {
    event.preventDefault();
    if (saving || submitLock.current) return;
    submitLock.current = true;
    try {
      const amountPesewas = toPesewas(paymentType === "full" ? debt.amountPesewas / 100 : amount);
      if (!Number.isSafeInteger(amountPesewas) || amountPesewas <= 0 || amountPesewas > debt.amountPesewas) {
        playErrorChime();
        setError(`Enter a payment greater than GHS 0.00 and no more than ${formatGhs(debt.amountPesewas)}.`);
        return;
      }
      await onConfirm({ debt, amountPesewas, paymentMethod });
    } catch (paymentError) {
      console.error("Could not submit the debt payment.", paymentError);
      playErrorChime();
      setError("The payment could not be recorded. Please try again.");
    } finally {
      submitLock.current = false;
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4" onMouseDown={(event) => event.target === event.currentTarget && !saving && onCancel()}>
      <section role="dialog" aria-modal="true" aria-labelledby="confirm-payment-title" className="safe-bottom max-h-[92dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-leaf">Record money received</p>
            <h2 id="confirm-payment-title" className="text-xl font-bold">Confirm Payment</h2>
            <p className="mt-1 font-semibold">{debt.customerName}</p>
            {debt.phone && <p className="text-sm text-slate-500">{debt.phone}</p>}
            {debt.ghanaCardNumber && <p className="text-sm text-slate-500">Ghana Card: {formatGhanaCard(debt.ghanaCardNumber)}</p>}
          </div>
          <button type="button" disabled={saving} onClick={onCancel} aria-label="Close payment confirmation" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 disabled:opacity-50">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Total debt: <strong className="text-lg">{formatGhs(debt.amountPesewas)}</strong>
        </p>

        <form onSubmit={(event) => void submitPayment(event)} className="space-y-4">
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Payment amount</legend>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" aria-pressed={paymentType === "full"} onClick={() => { setPaymentType("full"); setError(""); }} className={`min-h-11 rounded-xl px-3 text-sm font-semibold ${paymentType === "full" ? "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-700" : "bg-slate-100 text-slate-700"}`}>
                Full Payment
              </button>
              <button type="button" aria-pressed={paymentType === "partial"} onClick={() => { setPaymentType("partial"); setAmount(""); setError(""); }} className={`min-h-11 rounded-xl px-3 text-sm font-semibold ${paymentType === "partial" ? "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-700" : "bg-slate-100 text-slate-700"}`}>
                Partial Payment
              </button>
            </div>
          </fieldset>

          {paymentType === "partial" && (
            <label htmlFor="partial-payment-amount" className="block text-sm font-semibold">
              Amount paid (GHS)
              <input
                id="partial-payment-amount"
                type="number"
                inputMode="decimal"
                min="0.01"
                max={(debt.amountPesewas / 100).toFixed(2)}
                step="0.01"
                required
                autoFocus
                value={amount}
                onChange={(event) => { setAmount(event.target.value); setError(""); }}
                className="mt-1 min-h-12 w-full rounded-xl border border-slate-200 px-3 text-base font-normal outline-none focus:border-leaf focus:ring-2 focus:ring-leaf/20 sm:text-sm"
              />
              <span className="mt-1 block text-xs font-normal text-slate-500">Remaining after payment: {formatGhs(Math.max(0, debt.amountPesewas - (toPesewas(amount) ?? 0)))}</span>
            </label>
          )}

          <PaymentMethodToggle value={paymentMethod} onChange={setPaymentMethod} />

          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex flex-col-reverse items-stretch justify-end gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center">
            <button type="button" disabled={saving} onClick={onCancel} className="w-full rounded-xl bg-slate-100 px-4 py-2.5 font-medium text-slate-700 transition hover:bg-slate-200 disabled:opacity-50 sm:w-auto">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="w-full rounded-xl bg-emerald-700 px-5 py-2.5 font-medium text-white transition hover:bg-emerald-800 disabled:opacity-50 sm:w-auto">
              {saving ? "Recording…" : "Confirm Payment"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default function DebtLedger({ shopName = "My shop", onReturnToDashboard, onDataChanged }) {
  const savedCustomers = useLiveQuery(() => db.customers.toArray(), [], []);
  const [debts, setDebts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCursors, setPageCursors] = useState([null]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [selectedDebtCustomer, setSelectedDebtCustomer] = useState(null);
  const [phone, setPhone] = useState("");
  const [ghanaCardNumber, setGhanaCardNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [debtFormSubmitted, setDebtFormSubmitted] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busyDebtId, setBusyDebtId] = useState(null);
  const [editingDebt, setEditingDebt] = useState(null);
  const [phoneDraft, setPhoneDraft] = useState("");
  const [ghanaCardDraft, setGhanaCardDraft] = useState("");
  const [amountDraft, setAmountDraft] = useState("");
  const [editError, setEditError] = useState("");
  const [paymentDebt, setPaymentDebt] = useState(null);
  const [reminderDebt, setReminderDebt] = useState(null);
  const [authSession, setAuthSession] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [sendingReminderId, setSendingReminderId] = useState(null);
  const [reminderResult, setReminderResult] = useState(null);
  const [copiedGhanaCardDebtId, setCopiedGhanaCardDebtId] = useState(null);
  const [copyErrorDebtId, setCopyErrorDebtId] = useState(null);
  const loadingLock = useRef(false);
  const customerNameQuery = customerName.trim().toLowerCase();
  const debtCustomerSuggestions = formOpen && customerNameQuery.length >= 2 &&
    selectedDebtCustomer?.nameLower !== customerNameQuery
    ? savedCustomers.filter((customer) => (
        (customer.nameLower ?? customer.name.trim().toLowerCase()).startsWith(customerNameQuery)
      )).slice(0, 8)
    : [];
  const editedBalancePesewas = toPesewas(amountDraft);

  async function copyGhanaCardNumber(debtId, number) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
      await navigator.clipboard.writeText(number);
      setCopiedGhanaCardDebtId(debtId);
      setCopyErrorDebtId(null);
      window.setTimeout(() => {
        setCopiedGhanaCardDebtId((current) => current === debtId ? null : current);
      }, 1800);
    } catch (copyError) {
      console.error("Could not copy the Ghana Card number.", copyError);
      setCopiedGhanaCardDebtId(null);
      setCopyErrorDebtId(debtId);
    }
  }

  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) {
        console.error("Could not restore the WhatsApp sign-in.", sessionError);
        setAuthError("Sign-in status could not be loaded. Please refresh and try again.");
      } else {
        setAuthSession(data.session);
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthSession(session);
      setAuthError("");
      setAuthMessage("");
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadingLock.current = false;
    setDebts([]);
    setHasMore(false);
    setLoadingMore(false);
    setPageIndex(0);
    setPageCursors([null]);
    setLoading(true);
    setError("");

    getDebtPage(null)
      .then((firstPage) => {
        if (cancelled) return;
        setDebts(firstPage);
        setHasMore(firstPage.length === PAGE_SIZE);
      })
      .catch((loadError) => {
        console.error("Could not load customer debts.", loadError);
        if (!cancelled) setError("Customer debts could not be loaded. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const loadDebtPage = useCallback(async (after, nextPageIndex) => {
    if (loadingLock.current) return;
    loadingLock.current = true;
    setLoadingMore(true);
    setError("");
    try {
      const nextPage = await getDebtPage(after);
      if (nextPage.length) {
        setDebts(nextPage);
        setPageIndex(nextPageIndex);
        setHasMore(nextPage.length === PAGE_SIZE);
      } else {
        setHasMore(false);
      }
    } catch (loadError) {
      console.error("Could not load customer debt page.", loadError);
      setError("Customer debts could not be loaded. Please try again.");
    } finally {
      loadingLock.current = false;
      setLoadingMore(false);
    }
  }, []);

  function loadNextPage() {
    const last = debts[debts.length - 1];
    if (!hasMore || !last) return;
    setPageCursors((current) => [...current.slice(0, pageIndex + 1), last]);
    void loadDebtPage(last, pageIndex + 1);
  }

  function loadPreviousPage() {
    if (pageIndex === 0) return;
    void loadDebtPage(pageCursors[pageIndex - 1], pageIndex - 1);
  }

  async function saveDebt(event) {
    event.preventDefault();
    setDebtFormSubmitted(true);
    if (!customerName.trim()) {
      playErrorChime();
      return;
    }
    const amountPesewas = toPesewas(amount);
    if (!amountPesewas || amountPesewas <= 0) {
      playErrorChime();
      return;
    }
    if (!isValidGhanaCardNumber(ghanaCardNumber)) {
      playErrorChime();
      setError("Enter a Ghana Card number like GHA-123456789-0 or 1234567890.");
      return;
    }
    const now = Date.now();
    const transactionId = createId();
    const cleanCustomerName = customerName.trim();
    const cleanNote = note.trim();
    const transaction = {
      id: transactionId,
      type: "sale",
      amountPesewas,
      total_amount: amountPesewas,
      payment_method: null,
      paymentType: "credit",
      customer_name: cleanCustomerName,
      customer_phone: phone.trim(),
      ghanaCardNumber: normalizeGhanaCardNumber(ghanaCardNumber),
      customerName: cleanCustomerName,
      phone: phone.trim(),
      items_json: JSON.stringify([{
        name: cleanNote || "Debt added",
        quantity: 1,
        total_amount: amountPesewas
      }]),
      itemDescription: cleanNote || "Debt added",
      quantity: 1,
      pricePesewas: amountPesewas,
      note: `${cleanNote || "Debt added"} · ${cleanCustomerName}`,
      createdAt: now,
      timestamp: now,
      updatedAt: now,
      synced: false,
      syncStatus: "pending"
    };
    try {
      await runTransactionWithTimeout(db, [db.debts, db.customers, db.transactions], async () => {
        await db.transactions.add(transaction);
        await addDebtToCustomer({
          name: customerName,
          phone,
          ghanaCardNumber: normalizeGhanaCardNumber(ghanaCardNumber),
          amountPesewas,
          note: cleanNote,
          transactionId,
          now
        });
        await upsertCustomer({
          name: customerName,
          phone,
          ghanaCardNumber: normalizeGhanaCardNumber(ghanaCardNumber),
          debtDeltaPesewas: amountPesewas,
          now
        });
      });
      void requestBackgroundSync();
      playSuccessChime();
      speakConfirmation("Debt saved");
      setCustomerName("");
      setSelectedDebtCustomer(null);
      setPhone("");
      setGhanaCardNumber("");
      setAmount("");
      setDebtFormSubmitted(false);
      setNote("");
      setError("");
      setFormOpen(false);
      setRefreshKey((current) => current + 1);
      onDataChanged?.();
    } catch (saveError) {
      console.error("Could not save debt.", saveError);
      playErrorChime();
      setError("This debt could not be saved. Please try again.");
    }
  }

  function cancelDebtEntry() {
    setCustomerName("");
    setSelectedDebtCustomer(null);
    setPhone("");
    setGhanaCardNumber("");
    setAmount("");
    setDebtFormSubmitted(false);
    setNote("");
    setError("");
    setFormOpen(false);
    onReturnToDashboard();
  }

  async function confirmPayment({ debt, amountPesewas, paymentMethod }) {
    const now = Date.now();
    setBusyDebtId(debt.id);
    try {
      await runTransactionWithTimeout(db, [db.debts, db.transactions, db.customers], async () => {
        const currentDebt = await db.debts.get(debt.id);
        if (!currentDebt || currentDebt.status !== "unpaid" || amountPesewas > currentDebt.amountPesewas) {
          throw new Error("The debt changed before the payment could be recorded.");
        }
        const remainingPesewas = currentDebt.amountPesewas - amountPesewas;
        await db.debts.update(debt.id, {
          ...(remainingPesewas === 0 ? { status: "paid" } : {}),
          ...(remainingPesewas > 0 && {
            amountPesewas: remainingPesewas,
            total_owed: remainingPesewas
          }),
          updatedAt: now,
          synced: false,
          syncStatus: "pending"
        });
        await db.transactions.add({
          id: createId(),
          type: "income",
          amountPesewas,
          total_amount: amountPesewas,
          payment_method: paymentMethod,
          customer_name: currentDebt.customerName,
          customer_phone: currentDebt.phone ?? "",
          items_json: "[]",
          note: `Debt payment from ${currentDebt.customerName}${remainingPesewas ? ` · ${formatGhs(remainingPesewas)} remaining` : ""}`,
          createdAt: now,
          timestamp: now,
          updatedAt: now,
          synced: false,
          syncStatus: "pending"
        });
        await upsertCustomer({
          name: currentDebt.customerName,
          phone: currentDebt.phone ?? "",
          debtDeltaPesewas: -amountPesewas,
          now
        });
      });
      void requestBackgroundSync();
      setRefreshKey((current) => current + 1);
      setPaymentDebt(null);
      playSuccessChime();
      speakConfirmation("Debt payment recorded");
    } catch (paymentError) {
      console.error("Could not record debt payment.", paymentError);
      playErrorChime();
      throw paymentError;
    } finally {
      setBusyDebtId(null);
    }
  }

  function paymentLink(debt) {
    return generateWhatsAppLink(
      debt.phone || debt.customer_phone,
      debt.customerName || debt.customer_name,
      debt.amountPesewas / 100,
      shopName
    );
  }

  async function saveWhatsAppPhone(debt, phone) {
    const now = Date.now();
    try {
      await runTransactionWithTimeout(db, [db.debts, db.customers], async () => {
        const updatedCount = await db.debts.update(debt.id, {
          phone,
          customer_phone: phone,
          updatedAt: now,
          synced: false,
          syncStatus: "pending"
        });
        if (!updatedCount) throw new Error("The customer debt no longer exists.");
        await upsertCustomer({
          name: debt.customerName || debt.customer_name,
          phone,
          now
        });
      });
      setDebts((current) => current.map((item) => (
        item.id === debt.id
          ? { ...item, phone, customer_phone: phone, updatedAt: now, synced: false, syncStatus: "pending" }
          : item
      )));
      void requestBackgroundSync();
    } catch (saveError) {
      console.error("Could not save the WhatsApp number.", saveError);
      throw saveError;
    }
  }

  async function signInForWhatsApp(event) {
    event.preventDefault();
    if (!supabase) return;
    setAuthBusy(true);
    setAuthError("");
    setAuthMessage("");
    try {
      const { error: signInError } = await supabase.auth.signInWithOtp({
        email: authEmail.trim(),
        options: { emailRedirectTo: window.location.origin }
      });
      if (signInError) throw signInError;
      setAuthMessage("Check your email for a secure sign-in link, then return here.");
    } catch (signInError) {
      console.error("Could not request a WhatsApp sign-in link.", signInError);
      setAuthError("A sign-in link could not be sent. Check the email address and try again.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOutFromWhatsApp() {
    if (!supabase) return;
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      console.error("Could not sign out of WhatsApp sending.", signOutError);
      setAuthError("Sign-out failed. Please try again.");
    }
  }

  async function sendBusinessReminder(debt) {
    if (!supabase) return;
    if (!authSession) {
      setAuthOpen(true);
      setAuthError("Sign in with an authorized email to send using WhatsApp Business.");
      return;
    }
    setSendingReminderId(debt.id);
    setReminderResult(null);
    try {
      const response = await fetch("/api/whatsapp/reminder", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authSession.access_token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          phone: debt.phone,
          customerName: debt.customerName,
          shopName,
          amountPesewas: debt.amountPesewas
        })
      });
      let result;
      try {
        result = await response.json();
      } catch {
        throw new Error("The server returned an unexpected response. Try again or open WhatsApp.");
      }
      if (!response.ok) {
        if (response.status === 401) {
          setAuthOpen(true);
          setAuthError(result.error || "Sign in again to send a reminder.");
        }
        throw new Error(result.error || "The reminder could not be sent.");
      }
      setReminderResult({ debtId: debt.id, message: "WhatsApp accepted the reminder request; delivery is not guaranteed." });
    } catch (sendError) {
      console.error("Could not send the WhatsApp Business reminder.", sendError);
      setReminderResult({
        debtId: debt.id,
        error: sendError.message || "The reminder could not be sent. Try again or open WhatsApp."
      });
    } finally {
      setSendingReminderId(null);
    }
  }

  function editDebt(debt) {
    const customer = savedCustomers.find((item) => item.nameLower === (debt.customerName || debt.customer_name || "").trim().toLowerCase());
    setEditingDebt(debt);
    setPhoneDraft(debt.phone ?? "");
    setGhanaCardDraft(formatGhanaCard(customer?.ghanaCardNumber || debt.ghanaCardNumber || ""));
    setAmountDraft((debt.amountPesewas / 100).toFixed(2));
    setEditError("");
  }

  async function saveDebtChanges(event, debt) {
    event.preventDefault();
    if (phoneDraft.trim() && !normalizeWhatsAppPhone(phoneDraft)) {
      playErrorChime();
      setEditError("Enter a valid Ghana number, such as 024 123 4567.");
      return;
    }
    if (!isValidGhanaCardNumber(ghanaCardDraft)) {
      playErrorChime();
      setEditError("Enter a Ghana Card number like GHA-123456789-0 or 1234567890.");
      return;
    }
    const nextAmountPesewas = toPesewas(amountDraft);
    if (!nextAmountPesewas || nextAmountPesewas <= 0) {
      playErrorChime();
      setEditError("Enter a remaining balance greater than GHS 0.00. Use Mark as Paid to clear the debt.");
      return;
    }

    const now = Date.now();
    const nextPhone = phoneDraft.trim();
    const nextGhanaCardNumber = normalizeGhanaCardNumber(ghanaCardDraft);
    const debtDeltaPesewas = nextAmountPesewas - debt.amountPesewas;
    setBusyDebtId(debt.id);
    setEditError("");
    try {
      await runTransactionWithTimeout(db, [db.debts, db.customers], async () => {
        await db.debts.update(debt.id, {
          phone: nextPhone,
          customer_phone: nextPhone,
          ghanaCardNumber: nextGhanaCardNumber,
          amountPesewas: nextAmountPesewas,
          total_owed: nextAmountPesewas,
          updatedAt: now,
          synced: false,
          syncStatus: "pending"
        });
        await upsertCustomer({
          name: debt.customerName,
          phone: nextPhone,
          ghanaCardNumber: nextGhanaCardNumber,
          replaceGhanaCardNumber: true,
          debtDeltaPesewas,
          now
        });
      });
      setDebts((current) => current.map((item) => (
        item.id === debt.id
          ? {
              ...item,
              phone: nextPhone,
              customer_phone: nextPhone,
              ghanaCardNumber: nextGhanaCardNumber,
              amountPesewas: nextAmountPesewas,
              total_owed: nextAmountPesewas,
              updatedAt: now,
              synced: false,
              syncStatus: "pending"
            }
          : item
      )));
      setEditingDebt(null);
      void requestBackgroundSync();
    } catch (saveError) {
      console.error("Could not update the customer debt.", saveError);
      playErrorChime();
      setEditError("The debt could not be updated. Please try again.");
    } finally {
      setBusyDebtId(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-6 sm:px-6">
      <div className="mb-6 flex items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-leaf">Customer balances</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Debts Ledger</h1>
          <p className="mt-1 text-sm text-slate-500">Largest balances first</p>
          <button
            type="button"
            onClick={onReturnToDashboard}
            className="mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-lg text-sm font-semibold text-leaf hover:text-leaf-dark focus:outline-none focus:ring-2 focus:ring-leaf focus:ring-offset-2"
          >
            <ArrowLeft size={17} aria-hidden="true" /> Back to dashboard
          </button>
        </div>
        <button type="button" onClick={() => { setFormOpen((open) => !open); setError(""); setDebtFormSubmitted(false); }} className="flex min-h-12 items-center gap-2 rounded-xl bg-leaf px-4 font-semibold text-white">
          <UserRoundPlus size={18} aria-hidden="true" />
          <span>Add debt</span>
        </button>
      </div>

      {supabase && authOpen && (
        <section className="mb-5 rounded-2xl bg-white p-4 shadow-card" aria-label="WhatsApp Business sign-in">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-bold">WhatsApp Business</h2>
              <p className="mt-1 text-sm text-slate-500">
                {authSession ? `Signed in as ${authSession.user.email}` : "Sign in to send approved WhatsApp reminders."}
              </p>
            </div>
            {authSession && (
              <button type="button" onClick={() => void signOutFromWhatsApp()} className="flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700">
                <LogOut size={15} aria-hidden="true" /> Sign out
              </button>
            )}
            <button type="button" onClick={() => setAuthOpen(false)} aria-label="Close WhatsApp sign-in" className="grid min-h-10 w-10 place-items-center rounded-lg border border-slate-200 text-slate-600">
              <X size={17} aria-hidden="true" />
            </button>
          </div>
          {!authSession && (
            <form onSubmit={(event) => void signInForWhatsApp(event)} className="mt-3 flex flex-col gap-2 sm:flex-row">
              <label className="sr-only" htmlFor="whatsapp-auth-email">Email address</label>
              <input
                id="whatsapp-auth-email"
                type="email"
                autoComplete="email"
                required
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value)}
                placeholder="Your sign-in email"
                className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 outline-none focus:border-leaf"
              />
              <button type="submit" disabled={authBusy} className="min-h-11 rounded-xl bg-leaf px-4 text-sm font-semibold text-white disabled:opacity-50">
                {authBusy ? "Sending link…" : "Email me a sign-in link"}
              </button>
            </form>
          )}
          {authMessage && <p role="status" className="mt-2 text-sm text-leaf">{authMessage}</p>}
          {authError && <p role="alert" className="mt-2 text-sm text-red-700">{authError}</p>}
        </section>
      )}

      {formOpen && (
        <form noValidate onSubmit={saveDebt} className="mb-5 space-y-3 rounded-2xl bg-white p-4 shadow-card">
          <h2 className="font-bold">New customer debt</h2>
          <label className="block text-sm font-semibold">Customer name <span className="text-red-600">*</span>
            <div className="relative">
              <input
                required
                aria-required="true"
                maxLength="100"
                value={customerName}
                onChange={(event) => {
                  setCustomerName(event.target.value);
                  setSelectedDebtCustomer(null);
                  setPhone("");
                  setGhanaCardNumber("");
                  setError("");
                }}
                placeholder="Search saved customers or enter a new name"
                autoComplete="off"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={debtCustomerSuggestions.length > 0}
                aria-controls="debt-customer-suggestions"
                aria-invalid={debtFormSubmitted && !customerName.trim()}
                aria-describedby="debt-customer-name-help"
                className="mt-1 min-h-12 w-full rounded-xl border border-slate-200 px-3 text-base font-normal outline-none focus:border-leaf"
              />
              {debtCustomerSuggestions.length > 0 && (
                <ul id="debt-customer-suggestions" role="listbox" className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                  {debtCustomerSuggestions.map((customer) => (
                    <li key={customer.id} role="presentation">
                      <button
                        type="button"
                        role="option"
                        aria-selected="false"
                        onClick={() => {
                          setCustomerName(customer.name);
                          setSelectedDebtCustomer(customer);
                          setPhone(customer.phone ?? "");
                          setGhanaCardNumber(formatGhanaCard(customer.ghanaCardNumber));
                          setError("");
                        }}
                        className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-emerald-50"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">{customer.name}</span>
                          <span className="block truncate text-xs font-normal text-slate-500">{customer.phone || "No phone saved"}</span>
                        </span>
                        <span className={`shrink-0 text-xs font-semibold ${customer.totalDebtPesewas > 0 ? "text-amber-800" : "text-slate-500"}`}>
                          {customer.totalDebtPesewas > 0 ? `Owes ${formatGhs(customer.totalDebtPesewas)}` : "No unpaid debt"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {selectedDebtCustomer?.totalDebtPesewas > 0 && (
              <span className="mt-2 inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
                Outstanding balance: {formatGhs(selectedDebtCustomer.totalDebtPesewas)}
              </span>
            )}
            <span id="debt-customer-name-help" className={`mt-1 block text-xs font-normal ${debtFormSubmitted && !customerName.trim() ? "text-red-700" : "text-slate-500"}`}>
              {debtFormSubmitted && !customerName.trim() ? "Enter a customer name to continue." : "Required: enter the customer who owes this amount."}
            </span>
          </label>
          <label className="block text-sm font-semibold">Phone <span className="font-normal text-slate-500">(for WhatsApp reminder)</span>
            <input type="tel" inputMode="tel" maxLength="30" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="024 123 4567" className="mt-1 min-h-12 w-full rounded-xl border border-slate-200 px-3 text-base font-normal outline-none focus:border-leaf" />
          </label>
          <label className="block text-sm font-semibold">Ghana Card Number <span className="font-normal text-slate-500">(Optional)</span>
            <input
              type="text"
              autoComplete="off"
              maxLength="15"
              value={ghanaCardNumber}
              onChange={(event) => {
                setGhanaCardNumber(formatGhanaCard(event.target.value));
                setError("");
              }}
              placeholder="GHA-123456789-0"
              aria-invalid={Boolean(ghanaCardNumber && !isValidGhanaCardNumber(ghanaCardNumber))}
              className="mt-1 min-h-12 w-full rounded-xl border border-slate-200 px-3 text-base font-normal uppercase outline-none focus:border-leaf"
            />
            <span className="mt-1 block text-xs font-normal text-slate-500">e.g., GHA-712345678-9 (National ID for debtor verification)</span>
          </label>
          <label className="block text-sm font-semibold">Amount (GHS) <span className="text-red-600">*</span>
            <input
              required
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(event) => { setAmount(event.target.value); setError(""); }}
              placeholder="0.00"
              aria-invalid={debtFormSubmitted && (!toPesewas(amount) || toPesewas(amount) <= 0)}
              aria-describedby="debt-amount-help"
              className="mt-1 min-h-12 w-full rounded-xl border border-slate-200 px-3 text-base font-normal outline-none focus:border-leaf"
            />
            <span id="debt-amount-help" className={`mt-1 block text-xs font-normal ${debtFormSubmitted && (!toPesewas(amount) || toPesewas(amount) <= 0) ? "text-red-700" : "text-slate-500"}`}>
              {debtFormSubmitted && (!toPesewas(amount) || toPesewas(amount) <= 0)
                ? "Enter an amount greater than GHS 0.00."
                : "Required: enter the amount the customer owes."}
            </span>
          </label>
          <label className="block text-sm font-semibold">Note <span className="font-normal text-slate-500">(optional)</span>
            <input maxLength="200" value={note} onChange={(event) => setNote(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl border border-slate-200 px-3 text-base font-normal outline-none focus:border-leaf" />
          </label>
          <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-leaf">
            Total: {formatGhs(toPesewas(amount) || 0)} · Added to customer debts
          </p>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex flex-col-reverse items-stretch justify-end gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={cancelDebtEntry}
              className="w-full rounded-xl bg-slate-100 px-5 py-3 font-medium text-slate-700 transition hover:bg-slate-200 sm:w-auto"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="w-full rounded-xl bg-emerald-700 px-5 py-3 font-medium text-white shadow-sm transition hover:bg-emerald-800 sm:w-auto"
            >
              Save debt
            </button>
          </div>
        </form>
      )}

      {error && (!formOpen || !loading) && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {loading ? (
        <p className="py-10 text-center text-sm text-slate-500">Loading customer debts…</p>
      ) : debts.length === 0 && !error ? (
        <div className="rounded-2xl bg-white px-6 py-12 text-center shadow-card">
          <p className="font-semibold">No outstanding debts</p>
          <p className="mt-1 text-sm text-slate-500">Customer balances you add will appear here.</p>
        </div>
      ) : debts.length > 0 ? (
        <ul className="space-y-3">
          {debts.map((debt) => {
            const customer = savedCustomers.find((item) => item.nameLower === (debt.customerName || debt.customer_name || "").trim().toLowerCase());
            const customerPhone = customer?.phone?.trim() || debt.phone?.trim() || debt.customer_phone?.trim() || "";
            const customerGhanaCardNumber = formatGhanaCard(customer?.ghanaCardNumber || debt.ghanaCardNumber || "");
            const customerDebt = {
              ...debt,
              phone: customerPhone,
              customer_phone: customerPhone,
              ghanaCardNumber: customerGhanaCardNumber
            };
            const whatsappUrl = paymentLink(customerDebt);
            const dialablePhone = customerPhone.replace(/[\s().-]/g, "");
            return (
              <li key={debt.id} className="rounded-2xl bg-white p-4 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-bold">{debt.customerName}</h2>
                    {customerPhone && (
                      <button
                        type="button"
                        onClick={() => setReminderDebt(customerDebt)}
                        aria-label={`Edit WhatsApp number for ${debt.customerName || debt.customer_name}`}
                        className="mt-0.5 inline-flex min-h-9 items-center gap-1.5 rounded-md text-sm text-slate-500 transition hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-leaf focus:ring-offset-1"
                      >
                        <span aria-hidden="true">📞</span>
                        <span>{customerPhone}</span>
                        <Pencil size={13} aria-hidden="true" />
                      </button>
                    )}
                    {customerGhanaCardNumber && (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-slate-100 px-2.5 text-xs font-medium text-slate-700">
                          <IdCard size={14} aria-hidden="true" />
                          {customerGhanaCardNumber}
                        </span>
                        <button
                          type="button"
                          onClick={() => void copyGhanaCardNumber(debt.id, customerGhanaCardNumber)}
                          aria-label={`Copy Ghana Card number for ${debt.customerName || debt.customer_name}`}
                          className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-leaf hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-leaf"
                        >
                          {copiedGhanaCardDebtId === debt.id ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                          {copiedGhanaCardDebtId === debt.id ? "Copied" : "Copy ID"}
                        </button>
                        {copyErrorDebtId === debt.id && <span role="alert" className="text-xs text-red-700">Could not copy ID.</span>}
                      </div>
                    )}
                    {debt.note && <p className="mt-1 break-words text-sm text-slate-600">{debt.note}</p>}
                  </div>
                  <p className="shrink-0 text-lg font-bold text-amber-800">{formatGhs(debt.amountPesewas)}</p>
                </div>
                {customerPhone ? (
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <a
                      href={whatsappUrl || undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(event) => {
                        if (!whatsappUrl) {
                          event.preventDefault();
                          setReminderDebt(customerDebt);
                        }
                      }}
                      className="flex min-h-12 min-w-0 items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-2 py-2.5 text-center text-sm font-medium text-emerald-700 transition hover:bg-emerald-100"
                    >
                      <MessageCircle size={17} aria-hidden="true" /> WhatsApp
                    </a>
                    <a
                      href={`tel:${dialablePhone}`}
                      className="flex min-h-12 min-w-0 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100 px-2 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
                    >
                      <span aria-hidden="true">📞</span> Call
                    </a>
                  </div>
                ) : (
                  <button type="button" onClick={() => setReminderDebt(customerDebt)} className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-emerald-200/80 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-800 transition hover:bg-emerald-100">
                    <MessageCircle size={17} aria-hidden="true" />
                    + Add Phone Number
                  </button>
                )}
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => editDebt(debt)} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100">
                    <Pencil size={15} aria-hidden="true" /> Edit Debt
                  </button>
                  <button type="button" disabled={busyDebtId === debt.id} onClick={() => setPaymentDebt(customerDebt)} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50">
                    <Check size={17} aria-hidden="true" /> Mark as Paid
                  </button>
                </div>
                {whatsappUrl && supabase && (
                  <button
                    type="button"
                    disabled={sendingReminderId === debt.id}
                    onClick={() => void sendBusinessReminder(debt)}
                    className="mt-2 min-h-11 w-full rounded-xl bg-leaf px-3 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {sendingReminderId === debt.id ? "Sending…" : "Send with WhatsApp Business"}
                  </button>
                )}
                {reminderResult?.debtId === debt.id && (
                  <p role={reminderResult.error ? "alert" : "status"} className={`mt-2 text-sm ${reminderResult.error ? "text-red-700" : "text-leaf"}`}>
                    {reminderResult.error || reminderResult.message}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {!loading && debts.length > 0 && (
        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            disabled={loadingMore || pageIndex === 0}
            onClick={loadPreviousPage}
            className="min-h-12 flex-1 rounded-xl border border-slate-200 bg-white font-semibold text-leaf disabled:opacity-40"
          >
            Previous
          </button>
          <span className="shrink-0 text-xs text-slate-500">
            Page {pageIndex + 1}{hasMore ? "+" : ""}
          </span>
          <button
            type="button"
            disabled={loadingMore || !hasMore}
            onClick={loadNextPage}
            className="min-h-12 flex-1 rounded-xl border border-slate-200 bg-white font-semibold text-leaf disabled:opacity-40"
          >
            Next customers
          </button>
        </div>
      )}
      {loadingMore && <p className="py-4 text-center text-sm text-slate-500">Loading more customers…</p>}
      {editingDebt && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4" onMouseDown={(event) => event.target === event.currentTarget && setEditingDebt(null)}>
          <section role="dialog" aria-modal="true" aria-labelledby="edit-debt-title" className="safe-bottom max-h-[92dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-leaf">Customer balance</p>
                <h2 id="edit-debt-title" className="text-lg font-bold">Edit debt</h2>
              </div>
              <button type="button" onClick={() => setEditingDebt(null)} aria-label="Close edit debt" className="grid h-10 w-10 place-items-center rounded-full bg-slate-100">
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <form onSubmit={(event) => void saveDebtChanges(event, editingDebt)} className="space-y-3">
              <p className="text-sm text-slate-600">{editingDebt.customerName}</p>
              <label className="block text-sm font-semibold" htmlFor="edit-debt-amount">New remaining balance (GHS)
                <input
                  id="edit-debt-amount"
                  required
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  autoFocus
                  value={amountDraft}
                  onChange={(event) => { setAmountDraft(event.target.value); setEditError(""); }}
                  className="mt-1 min-h-12 w-full rounded-xl border border-slate-200 px-3 text-base font-normal outline-none focus:border-leaf focus:ring-2 focus:ring-leaf/20 sm:text-sm"
                />
              </label>
              <p className="text-xs text-slate-500">
                {Number.isSafeInteger(editedBalancePesewas) && editedBalancePesewas > 0
                  ? `Remaining balance after save: ${formatGhs(editedBalancePesewas)}`
                  : "Enter a valid balance to preview the amount after saving."}
              </p>
              <p className="text-xs text-slate-500">Editing the balance does not record a payment or add a transaction to your history.</p>
              <label className="block text-sm font-semibold" htmlFor="edit-debt-phone">WhatsApp number <span className="font-normal text-slate-500">(optional)</span>
                <input
                  id="edit-debt-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength="30"
                  value={phoneDraft}
                  onChange={(event) => { setPhoneDraft(event.target.value); setEditError(""); }}
                  placeholder="024 123 4567"
                  aria-invalid={Boolean(editError && phoneDraft.trim() && !normalizeWhatsAppPhone(phoneDraft))}
                  className="mt-1 min-h-12 w-full rounded-xl border border-slate-200 px-3 text-base font-normal outline-none focus:border-leaf focus:ring-2 focus:ring-leaf/20 sm:text-sm"
                />
              </label>
              <p className="text-xs text-slate-500">Use a Ghana number, for example 024 123 4567 or +233 24 123 4567.</p>
              <label className="block text-sm font-semibold" htmlFor="edit-debt-ghana-card">Ghana Card Number <span className="font-normal text-slate-500">(Optional)</span>
                <input
                  id="edit-debt-ghana-card"
                  type="text"
                  autoComplete="off"
                  maxLength="15"
                  value={ghanaCardDraft}
                  onChange={(event) => {
                    setGhanaCardDraft(formatGhanaCard(event.target.value));
                    setEditError("");
                  }}
                  placeholder="GHA-123456789-0"
                  aria-invalid={Boolean(editError && ghanaCardDraft && !isValidGhanaCardNumber(ghanaCardDraft))}
                  className="mt-1 min-h-12 w-full rounded-xl border border-slate-200 px-3 text-base font-normal uppercase outline-none focus:border-leaf focus:ring-2 focus:ring-leaf/20 sm:text-sm"
                />
                <span className="mt-1 block text-xs font-normal text-slate-500">e.g., GHA-712345678-9 (National ID for debtor verification). Leave blank to remove.</span>
              </label>
              {editError && <p role="alert" className="text-sm text-red-700">{editError}</p>}
              <div className="flex flex-col-reverse items-stretch justify-end gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={() => setEditingDebt(null)}
                  className="w-full rounded-xl bg-slate-100 px-5 py-3 font-medium text-slate-700 transition hover:bg-slate-200 sm:w-auto"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busyDebtId === editingDebt.id}
                  className="w-full rounded-xl bg-emerald-700 px-5 py-3 font-medium text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-50 sm:w-auto"
                >
                  Save changes
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {paymentDebt && (
        <ConfirmPaymentModal
          key={paymentDebt.id}
          debt={paymentDebt}
          saving={busyDebtId === paymentDebt.id}
          onCancel={() => { if (busyDebtId !== paymentDebt.id) setPaymentDebt(null); }}
          onConfirm={confirmPayment}
        />
      )}
      {reminderDebt && (
        <WhatsAppReminderModal
          debt={reminderDebt}
          onClose={() => setReminderDebt(null)}
          onPhoneSaved={saveWhatsAppPhone}
        />
      )}
    </main>
  );
}
