import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, X } from "lucide-react";
import { db } from "../db/db.js";
import { addDebtToCustomer } from "../db/debts.js";
import { runTransactionWithTimeout, SaveTimeoutError } from "../db/runTransactionWithTimeout.js";
import { createId } from "../lib/ids.js";
import { formatGhs, toPesewas } from "../lib/money.js";
import { parseSpokenExpense, parseSpokenSale } from "../lib/saleParser.js";
import { requestBackgroundSync } from "../lib/syncRegistration.js";
import { normalizeCustomerName, upsertCustomer } from "../db/customers.js";
import { isValidGhanaCardNumber, normalizeGhanaCardNumber } from "../lib/ghanaCardNumber.js";
import { formatGhanaCard } from "../utils/formatters.js";
import { getNextCycleDate, localDateString, PAYMENT_FREQUENCIES, prepareInstallmentPlan } from "../utils/installments.js";
import { playErrorChime, playExpenseChime, playSuccessChime, speakConfirmation } from "../utils/audioFeedback.js";
import PaymentMethodToggle from "./PaymentMethodToggle.jsx";

const SALE_PAYMENT_METHODS = [
  { value: "cash", label: "💵 Cash", selected: "bg-emerald-600 text-white" },
  { value: "momo", label: "📱 MoMo", selected: "bg-blue-600 text-white" },
  { value: "credit", label: "🤝 Credit (Pay later)", selected: "bg-amber-500 font-semibold text-slate-900" }
];

function getSpeechRecognition() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export default function QuickSaleModal({ type, onClose, onSaved }) {
  const [customerName, setCustomerName] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerSuggestions, setCustomerSuggestions] = useState([]);
  const [customerLookupBusy, setCustomerLookupBusy] = useState(false);
  const [customerLookupError, setCustomerLookupError] = useState("");
  const [phone, setPhone] = useState("");
  const [ghanaCardNumber, setGhanaCardNumber] = useState("");
  const [isInstallmentPlan, setIsInstallmentPlan] = useState(false);
  const [installmentAmount, setInstallmentAmount] = useState("");
  const [installmentFrequency, setInstallmentFrequency] = useState("weekly");
  const [installmentStartMode, setInstallmentStartMode] = useState("next-cycle");
  const [nextDueDate, setNextDueDate] = useState(() => getNextCycleDate(localDateString(), "weekly"));
  const [installmentPaymentMethod, setInstallmentPaymentMethod] = useState("cash");
  const [itemDescription, setItemDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("");
  const [paymentType, setPaymentType] = useState("cash");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [note, setNote] = useState("");
  const [speechLanguage, setSpeechLanguage] = useState("en-GB");
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const recognitionRef = useRef(null);
  const submitLock = useRef(false);

  useEffect(() => {
    const query = normalizeCustomerName(customerName);
    if (type !== "sale" || paymentType !== "credit" || query.length < 2 || selectedCustomer?.nameLower === query) {
      setCustomerSuggestions([]);
      setCustomerLookupBusy(false);
      setCustomerLookupError("");
      return undefined;
    }

    let cancelled = false;
    setCustomerLookupBusy(true);
    setCustomerLookupError("");
    db.customers.where("nameLower").startsWith(query).limit(8).toArray()
      .then((matches) => {
        if (cancelled) return;
        const exactMatch = matches.find((customer) => customer.nameLower === query);
        if (exactMatch) {
          setCustomerName(exactMatch.name);
          setPhone(exactMatch.phone ?? "");
          setGhanaCardNumber(formatGhanaCard(exactMatch.ghanaCardNumber));
          setSelectedCustomer(exactMatch);
          setCustomerSuggestions([]);
          return;
        }
        setCustomerSuggestions(matches);
      })
      .catch((lookupError) => {
        console.error("Could not search saved customers.", lookupError);
        if (!cancelled) {
          setCustomerSuggestions([]);
          setCustomerLookupError("Saved customers could not be searched. Try again.");
        }
      })
      .finally(() => {
        if (!cancelled) setCustomerLookupBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [customerName, paymentType, selectedCustomer, type]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !submitLock.current) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      recognitionRef.current?.abort();
    };
  }, [onClose]);

  function changeCustomerName(name) {
    setCustomerName(name);
    setSelectedCustomer(null);
    setCustomerSuggestions([]);
    setPhone("");
    setGhanaCardNumber("");
    setCustomerLookupError("");
  }

  function changePaymentType(nextPaymentType) {
    setPaymentType(nextPaymentType);
    if (nextPaymentType !== "credit") {
      setCustomerName("");
      setSelectedCustomer(null);
      setCustomerSuggestions([]);
      setPhone("");
      setGhanaCardNumber("");
      setIsInstallmentPlan(false);
      setInstallmentAmount("");
      setInstallmentFrequency("weekly");
      setInstallmentStartMode("next-cycle");
      setNextDueDate(getNextCycleDate(localDateString(), "weekly"));
      setInstallmentPaymentMethod("cash");
      setCustomerLookupError("");
    }
  }

  function selectCustomer(customer) {
    setCustomerName(customer.name);
    setPhone(customer.phone ?? "");
    setGhanaCardNumber(formatGhanaCard(customer.ghanaCardNumber));
    setSelectedCustomer(customer);
    setCustomerSuggestions([]);
    setCustomerLookupError("");
  }

  function startVoiceEntry() {
    if (!window.isSecureContext) {
      setError("Voice entry needs a secure connection. Open the app using HTTPS or localhost.");
      return;
    }
    if (!navigator.onLine) {
      setError("Voice recognition needs an internet connection. You can still type the entry offline.");
      return;
    }
    const Recognition = getSpeechRecognition();
    if (!Recognition) {
      setError("Voice entry is not supported by this browser. Try Chrome on Android or type the details.");
      return;
    }

    const recognition = new Recognition();
    recognitionRef.current = recognition;
    recognition.lang = speechLanguage;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      setListening(true);
      setError("");
    };
    recognition.onresult = (event) => {
      const spokenText = event.results?.[0]?.[0]?.transcript?.trim();
      if (!spokenText) {
        setError("The speech recognizer returned no words. Try a different voice language or type the entry.");
        return;
      }
      let parsedPrice;
      if (type === "sale") {
        const parsed = parseSpokenSale(spokenText);
        parsedPrice = parsed.price;
        if (parsed.customerName) changeCustomerName(parsed.customerName);
        setItemDescription(parsed.itemDescription);
        if (parsed.quantity) setQuantity(parsed.quantity);
        if (parsed.price) setPrice(parsed.price);
        setPaymentType(parsed.paymentType);
        setNote("");
      } else {
        const parsed = parseSpokenExpense(spokenText);
        parsedPrice = parsed.price;
        setNote(parsed.note);
        if (parsed.price) setPrice(parsed.price);
        if (parsed.ambiguousAmount) {
          setError(`Heard “${spokenText}”, but found more than one possible amount. Enter the expense amount manually.`);
          return;
        }
      }
      if (!parsedPrice) {
        setError(`Heard “${spokenText}”, but could not find an amount. Check the voice language or enter it manually.`);
      }
    };
    recognition.onerror = (event) => {
      const errors = {
        "not-allowed": "Allow microphone access for this site in your browser settings, then try again.",
        "service-not-allowed": "The browser's speech service is unavailable. Check your connection or type the entry instead.",
        "language-not-supported": "This speech service does not support the selected language. Choose English (UK) or type the entry.",
        "audio-capture": "No microphone is available. Check your device microphone or type the entry.",
        "no-speech": "The speech recognizer returned no words. This can happen even when microphone access is enabled. Try English (UK), say a short phrase such as “sale, 10 cedis,” and check your internet connection.",
        network: "Voice recognition could not connect. Check your internet connection and try again.",
        aborted: ""
      };
      setError(errors[event.error] ?? `Voice entry failed (${event.error}). Check microphone permission or type the entry.`);
      setListening(false);
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      setListening(false);
    };
    try {
      recognition.start();
    } catch (startError) {
      recognitionRef.current = null;
      setListening(false);
      console.error("Could not start speech recognition.", startError);
      setError("The microphone could not be started. Check its permission and try again.");
    }
  }

  function stopVoiceEntry() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitLock.current) return;
    submitLock.current = true;
    setIsSubmitting(true);
    try {
      const parsedQuantity = Number(quantity);
      if (type === "sale") {
        if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
          playErrorChime();
          setError("Enter a quantity greater than zero.");
          return;
        }
        if (!itemDescription.trim()) {
          playErrorChime();
          setError("Enter an item description.");
          return;
        }
        if (paymentType === "credit" && !customerName.trim()) {
          playErrorChime();
          setError("Enter the customer's name for a credit sale.");
          return;
        }
        if (paymentType === "credit" && !isValidGhanaCardNumber(ghanaCardNumber)) {
          playErrorChime();
          setError("Enter a Ghana Card number like GHA-123456789-0 or 1234567890.");
          return;
        }
      }
      const amountPesewas = toPesewas(price);
      if (!amountPesewas || amountPesewas <= 0) {
        playErrorChime();
        setError("Enter a total price greater than GHS 0.00.");
        return;
      }
      if (!Number.isSafeInteger(amountPesewas) || amountPesewas <= 0) {
        playErrorChime();
        setError("The amount is too large. Check the quantity and price.");
        return;
      }
      let installmentPlan = null;
      let initialPaymentPesewas = 0;
      if (type === "sale" && paymentType === "credit" && isInstallmentPlan) {
        try {
          const preparedPlan = prepareInstallmentPlan({
            amountPesewas,
            installmentAmountPesewas: toPesewas(installmentAmount),
            frequency: installmentFrequency,
            nextDueDate: installmentStartMode === "today" ? localDateString() : nextDueDate,
            startToday: installmentStartMode === "today"
          });
          installmentPlan = preparedPlan.plan;
          if (installmentStartMode === "today" && !installmentPlan.nextDueDate) {
            installmentPlan = {
              ...installmentPlan,
              nextDueDate: getNextCycleDate(localDateString(), installmentFrequency)
            };
          }
          initialPaymentPesewas = preparedPlan.initialPaymentPesewas;
        } catch (planError) {
          playErrorChime();
          setError(planError.message);
          return;
        }
      }
      const remainingDebtPesewas = amountPesewas - initialPaymentPesewas;

      const now = Date.now();
      const transaction = {
        id: createId(),
        type,
        amountPesewas,
        total_amount: amountPesewas,
        payment_method: initialPaymentPesewas > 0
          ? installmentPaymentMethod
          : type === "sale" && paymentType !== "credit" ? paymentType : null,
        ...(initialPaymentPesewas > 0 && { installmentPaymentPesewas: initialPaymentPesewas }),
        customer_name: type === "sale" && paymentType === "credit" ? customerName.trim() : "",
        customer_phone: type === "sale" && paymentType === "credit" ? phone.trim() : "",
        ghanaCardNumber: type === "sale" && paymentType === "credit" ? normalizeGhanaCardNumber(ghanaCardNumber) : "",
        items_json: JSON.stringify(type === "sale" ? [{
          name: itemDescription.trim(),
          quantity: parsedQuantity,
          total_amount: amountPesewas
        }] : []),
        note: type === "sale"
          ? `${itemDescription.trim()}${customerName.trim() ? ` · ${customerName.trim()}` : ""}${note.trim() ? ` · ${note.trim()}` : ""}`
          : note.trim(),
        ...(type === "sale" && {
          customerName: paymentType === "credit" ? customerName.trim() : "",
          phone: paymentType === "credit" ? phone.trim() : "",
          ghanaCardNumber: paymentType === "credit" ? normalizeGhanaCardNumber(ghanaCardNumber) : "",
          itemDescription: itemDescription.trim(),
          quantity: parsedQuantity,
          pricePesewas: amountPesewas,
          paymentType
        }),
        ...(type === "sale" && paymentType === "credit" && {
          creditExtendedPesewas: remainingDebtPesewas
        }),
        createdAt: now,
        timestamp: now,
        updatedAt: now,
        synced: false,
        syncStatus: "pending"
      };
      if (type === "sale" && paymentType === "credit") {
        await runTransactionWithTimeout(db, [db.transactions, db.debts, db.customers, db.payments], async () => {
          let debtResult = null;
          if (remainingDebtPesewas > 0 || (initialPaymentPesewas > 0 && installmentPlan)) {
            debtResult = await addDebtToCustomer({
              name: customerName,
              phone,
              ghanaCardNumber: normalizeGhanaCardNumber(ghanaCardNumber),
              amountPesewas: remainingDebtPesewas,
              note: itemDescription.trim(),
              installmentPlan,
              transactionId: transaction.id,
              now
            });
          }
          transaction.type = debtResult?.isAddon
            ? "installment_addon"
            : initialPaymentPesewas > 0 ? "installment_sale" : type;
          if (debtResult?.isAddon) {
            transaction.creditExtendedPesewas = remainingDebtPesewas;
            transaction.addonAmountPesewas = amountPesewas;
          }
          await db.transactions.add(transaction);
          if (initialPaymentPesewas > 0) {
            await db.payments.add({
              id: createId(),
              debtId: debtResult?.id ?? null,
              amountPesewas: initialPaymentPesewas,
              paymentMethod: installmentPaymentMethod,
              customer_name: customerName.trim(),
              createdAt: now,
              updatedAt: now
            });
          }
          await upsertCustomer({
            name: customerName,
            phone,
            ghanaCardNumber: normalizeGhanaCardNumber(ghanaCardNumber),
            debtDeltaPesewas: remainingDebtPesewas,
            now
          });
        });
      } else {
        await runTransactionWithTimeout(db, [db.transactions], () => db.transactions.add(transaction));
      }
      console.log("Saved offline successfully:", transaction);
      void requestBackgroundSync();
      if (type === "expense") {
        playExpenseChime();
        speakConfirmation("Expense logged");
      } else {
        playSuccessChime();
        speakConfirmation("Sale saved");
      }
      setCustomerName("");
      setSelectedCustomer(null);
      setCustomerSuggestions([]);
      setPhone("");
      setGhanaCardNumber("");
      setIsInstallmentPlan(false);
      setInstallmentAmount("");
      setInstallmentFrequency("weekly");
      setNextDueDate(localDateString());
      setItemDescription("");
      setQuantity("1");
      setPrice("");
      setPaymentType("cash");
      setNote("");
      setError("");
      onSaved();
      onClose();
    } catch (saveError) {
      console.error("Offline save error:", saveError);
      playErrorChime();
      setError(saveError instanceof SaveTimeoutError
        ? "Saving took too long and was canceled. Check available storage, then try again."
        : "This entry could not be saved. Please check available storage and try again.");
    } finally {
      submitLock.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4" onMouseDown={(event) => event.target === event.currentTarget && !submitLock.current && onClose()}>
      <section role="dialog" aria-modal="true" aria-labelledby="quick-entry-title" className="safe-bottom max-h-[92dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-3xl bg-white p-5 sm:rounded-3xl">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-leaf">Quick entry</p>
            <h2 id="quick-entry-title" className="text-xl font-bold">Record {type}</h2>
          </div>
          <button type="button" onClick={onClose} disabled={isSubmitting} aria-label="Close" className="grid h-11 w-11 place-items-center rounded-full bg-slate-100 disabled:opacity-50"><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {type === "sale" ? (
            <>
              <PaymentMethodToggle
                value={paymentType}
                onChange={changePaymentType}
                methods={SALE_PAYMENT_METHODS}
              />
              {paymentType === "credit" && (
                <>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">Customer name <span className="text-red-600">*</span></span>
                <div className="relative">
                  <input
                    required
                    maxLength="100"
                    value={customerName}
                    onChange={(event) => changeCustomerName(event.target.value)}
                    placeholder="Who bought it?"
                    autoComplete="off"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={customerSuggestions.length > 0}
                    aria-controls="customer-suggestions"
                    className="min-h-12 w-full rounded-xl border border-slate-200 px-4 outline-none focus:border-leaf focus:ring-2 focus:ring-leaf/20"
                  />
                  {customerSuggestions.length > 0 && (
                    <ul id="customer-suggestions" role="listbox" className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                      {customerSuggestions.map((customer) => (
                        <li key={customer.id} role="presentation">
                          <button
                            type="button"
                            role="option"
                            aria-selected="false"
                            onClick={() => selectCustomer(customer)}
                            className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-emerald-50"
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-semibold">{customer.name}</span>
                              <span className="block truncate text-xs text-slate-500">{customer.phone || "No phone saved"}</span>
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
                {customerLookupBusy && <span className="mt-1 block text-xs text-slate-500">Searching saved customers…</span>}
                {customerLookupError && <span role="alert" className="mt-1 block text-xs text-red-700">{customerLookupError}</span>}
                {selectedCustomer && selectedCustomer.totalDebtPesewas > 0 && (
                  <span className="mt-2 inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
                    Outstanding balance: {formatGhs(selectedCustomer.totalDebtPesewas)}
                  </span>
                )}
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">Phone <span className="font-normal text-slate-500">(optional)</span></span>
                <input
                  type="tel"
                  inputMode="tel"
                  maxLength="30"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="024 123 4567"
                  className="min-h-12 w-full rounded-xl border border-slate-200 px-4 outline-none focus:border-leaf focus:ring-2 focus:ring-leaf/20"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">Ghana Card Number <span className="font-normal text-slate-500">(Optional)</span></span>
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
                  className="min-h-12 w-full rounded-xl border border-slate-200 px-4 uppercase outline-none focus:border-leaf focus:ring-2 focus:ring-leaf/20"
                />
                <span className="mt-1 block text-xs font-normal text-slate-500">e.g., GHA-712345678-9 (National ID for debtor verification)</span>
              </label>
                </>
              )}
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">Item description</span>
                <input
                  required
                  maxLength="200"
                  value={itemDescription}
                  onChange={(event) => setItemDescription(event.target.value)}
                  placeholder="e.g. bag of cement"
                  className="min-h-12 w-full rounded-xl border border-slate-200 px-4 outline-none focus:border-leaf focus:ring-2 focus:ring-leaf/20"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold">Quantity</span>
                  <input
                    required
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="any"
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                    className="min-h-12 w-full rounded-xl border border-slate-200 px-4 outline-none focus:border-leaf focus:ring-2 focus:ring-leaf/20"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold">Total price (GHS)</span>
                  <input
                    required
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                    placeholder="0.00"
                    className="min-h-12 w-full rounded-xl border border-slate-200 px-4 outline-none focus:border-leaf focus:ring-2 focus:ring-leaf/20"
                  />
                </label>
              </div>
              <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-leaf">
                Total: GHS {(Number(price) || 0).toFixed(2)}
                {paymentType === "credit" && " · Added to customer debts"}
              </p>
              {paymentType === "credit" && (
                <section className={`rounded-2xl border p-4 transition-colors ${isInstallmentPlan ? "border-emerald-200 bg-emerald-50/80" : "border-slate-200 bg-slate-50"}`}>
                  <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
                    <span>
                      <span className="block text-sm font-bold text-slate-900">Enable Installment Plan</span>
                      <span className="mt-0.5 block text-xs font-normal text-slate-500">Set payment amount, frequency, and due date.</span>
                    </span>
                    <span className="relative inline-flex h-6 w-11 shrink-0 items-center">
                      <input
                        type="checkbox"
                        checked={isInstallmentPlan}
                        onChange={(event) => setIsInstallmentPlan(event.target.checked)}
                        aria-label="Enable Installment Plan"
                        className="peer sr-only"
                      />
                      <span aria-hidden="true" className="absolute inset-0 rounded-full bg-slate-300 transition-colors peer-checked:bg-emerald-700 peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-700 peer-focus-visible:ring-offset-2" />
                      <span aria-hidden="true" className="absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
                    </span>
                  </label>
                  <div
                    aria-hidden={!isInstallmentPlan}
                    className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${isInstallmentPlan ? "mt-3 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
                  >
                    <fieldset disabled={!isInstallmentPlan} className="min-h-0 overflow-hidden">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="text-sm font-semibold">Installment amount (GHS)
                        <input type="number" inputMode="decimal" min="0.01" step="0.01" required value={installmentAmount} onChange={(event) => setInstallmentAmount(event.target.value)} placeholder="0.00" className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-base font-normal outline-none focus:border-leaf" />
                      </label>
                      <label className="text-sm font-semibold">Frequency
                        <select
                          value={installmentFrequency}
                          onChange={(event) => {
                            const frequency = event.target.value;
                            setInstallmentFrequency(frequency);
                            if (installmentStartMode === "next-cycle") {
                              setNextDueDate(getNextCycleDate(localDateString(), frequency));
                            }
                          }}
                          className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-base font-normal outline-none focus:border-leaf"
                        >
                          {PAYMENT_FREQUENCIES.map((frequency) => (
                            <option key={frequency.value} value={frequency.value}>{frequency.label}</option>
                          ))}
                        </select>
                      </label>
                      <div className="sm:col-span-2">
                        <span className="block text-sm font-semibold">Schedule starts</span>
                        <div className="mt-1 grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            aria-pressed={installmentStartMode === "today"}
                            onClick={() => {
                              setInstallmentStartMode("today");
                              setNextDueDate(localDateString());
                            }}
                            className={`min-h-10 rounded-lg px-3 text-sm font-semibold ${installmentStartMode === "today" ? "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-700" : "bg-slate-100 text-slate-700"}`}
                          >
                            Start Today
                          </button>
                          <button
                            type="button"
                            aria-pressed={installmentStartMode === "next-cycle"}
                            onClick={() => {
                              setInstallmentStartMode("next-cycle");
                              setNextDueDate(getNextCycleDate(localDateString(), installmentFrequency));
                            }}
                            className={`min-h-10 rounded-lg px-3 text-sm font-semibold ${installmentStartMode === "next-cycle" ? "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-700" : "bg-slate-100 text-slate-700"}`}
                          >
                            Start Next Cycle
                          </button>
                        </div>
                      </div>
                      <label className="text-sm font-semibold sm:col-span-2">Next due date
                        <input
                          type="date"
                          required
                          value={nextDueDate}
                          onChange={(event) => {
                            setNextDueDate(event.target.value);
                            setInstallmentStartMode("custom");
                          }}
                          className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-base font-normal outline-none focus:border-leaf"
                        />
                      </label>
                      {installmentStartMode === "today" && (
                        <div className="sm:col-span-2">
                          <p className="mb-2 text-xs font-normal text-slate-600">
                            This records {formatGhs(Math.min(toPesewas(installmentAmount) || 0, toPesewas(price) || 0))} received today and schedules the next due date for the following cycle.
                          </p>
                          <PaymentMethodToggle
                            value={installmentPaymentMethod}
                            onChange={setInstallmentPaymentMethod}
                            label="Initial installment received via"
                          />
                        </div>
                      )}
                      </div>
                    </fieldset>
                  </div>
                </section>
              )}
            </>
          ) : (
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold">Amount (GHS)</span>
              <input
                autoFocus
                required
                min="0.01"
                step="0.01"
                type="number"
                inputMode="decimal"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                placeholder="0.00"
                className="min-h-14 w-full rounded-xl border border-slate-200 px-4 text-xl font-semibold outline-none focus:border-leaf focus:ring-2 focus:ring-leaf/20"
              />
            </label>
          )}
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Note <span className="font-normal text-slate-500">(optional)</span></span>
            <textarea
              rows="2"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={type === "sale" ? "Extra details" : "What was this expense for?"}
              className="w-full resize-none rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-leaf focus:ring-2 focus:ring-leaf/20"
            />
          </label>
          {type === "sale" && (
            <>
            </>
          )}
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Voice language</span>
            <select
              value={speechLanguage}
              disabled={listening}
              onChange={(event) => { setSpeechLanguage(event.target.value); setError(""); }}
              className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 outline-none focus:border-leaf disabled:opacity-60"
            >
              <option value="en-GB">English (UK) — recommended</option>
              <option value="en-GH">English (Ghana)</option>
              <option value="en-US">English (US)</option>
            </select>
            <span className="mt-1 block text-xs text-slate-500">
              Voice recognition needs internet. Try: {type === "sale" ? "“sold 2 bags for 10 cedis”" : "“paid 10 cedis for transport”"}.
            </span>
          </label>
          <button type="button" onClick={listening ? stopVoiceEntry : startVoiceEntry} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-leaf/30 font-semibold text-leaf hover:bg-emerald-50">
            {listening ? <MicOff size={18} /> : <Mic size={18} />}
            {listening ? "Listening…" : `Speak ${type}`}
          </button>
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex flex-col-reverse items-stretch justify-end gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="w-full rounded-xl bg-slate-100 px-5 py-3 font-medium text-slate-700 transition hover:bg-slate-200 disabled:opacity-50 sm:w-auto"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-xl bg-emerald-700 px-5 py-3 font-medium text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-wait disabled:opacity-60 sm:w-auto"
            >
              {isSubmitting ? "Saving…" : `Save ${type}${type === "sale" && paymentType === "credit" ? " and debt" : ""}`}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
