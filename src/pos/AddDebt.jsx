import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, Search } from "lucide-react";
import { db } from "../db/db.js";
import { formatGhs, toPesewas } from "../lib/money.js";
import { formatGhanaCard } from "../utils/formatters.js";
import { getNextCycleDate, localDateString, PAYMENT_FREQUENCIES } from "../utils/installments.js";
import { prepareAddDebt } from "../utils/addDebt.js";
import { PosPage, PosPrimaryButton, PosSecondaryButton } from "./PosComponents.jsx";

export default function AddDebt({ onBack, onSave }) {
  const customers = useLiveQuery(() => db.customers.toArray(), [], []);
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [ghanaCardNumber, setGhanaCardNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [isInstallmentPlan, setIsInstallmentPlan] = useState(false);
  const [installmentAmount, setInstallmentAmount] = useState("");
  const [installmentFrequency, setInstallmentFrequency] = useState("weekly");
  const [installmentStartMode, setInstallmentStartMode] = useState("next-cycle");
  const [nextDueDate, setNextDueDate] = useState(() => getNextCycleDate(localDateString(), "weekly"));
  const [installmentPaymentMethod, setInstallmentPaymentMethod] = useState("cash");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const selectedCustomer = useMemo(() => {
    const normalizedName = customerName.trim().toLowerCase();
    return (customers ?? []).find((customer) => (
      customer.nameLower === normalizedName ||
      customer.name.trim().toLowerCase() === normalizedName
    )) ?? null;
  }, [customers, customerName]);
  const suggestions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery.length < 2) return [];
    return (customers ?? [])
      .filter((customer) => (
        customer.name.toLowerCase().includes(normalizedQuery) ||
        (customer.phone ?? "").includes(normalizedQuery)
      ))
      .slice(0, 6);
  }, [customers, query]);
  const amountPesewas = toPesewas(amount) || 0;
  const maximumInstallmentPesewas = (selectedCustomer?.totalDebtPesewas ?? 0) + amountPesewas;

  function chooseCustomer(customer) {
    setCustomerName(customer.name);
    setPhone(customer.phone ?? "");
    setGhanaCardNumber(formatGhanaCard(customer.ghanaCardNumber ?? ""));
    setQuery("");
    setError("");
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      await onSave({
        customerName,
        phone,
        ghanaCardNumber,
        amount,
        note,
        isInstallmentPlan,
        installmentAmount,
        installmentFrequency,
        installmentStartMode,
        nextDueDate,
        installmentPaymentMethod,
        existingDebtPesewas: selectedCustomer?.totalDebtPesewas ?? 0
      });
    } catch (saveError) {
      console.error("Could not save the POS debt.", saveError);
      setError(saveError?.message || "This debt could not be saved. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <PosPage className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} aria-label="Back to people who owe you" className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border-2 border-slate-900">
          <ArrowLeft size={22} aria-hidden="true" />
        </button>
        <div>
          <h1 className="text-2xl font-extrabold">Add debt</h1>
          <p className="text-sm font-semibold text-slate-700">Record a new customer balance</p>
        </div>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="block font-bold">
          Customer name
          <input
            required
            value={customerName}
            onChange={(event) => { setCustomerName(event.target.value); setQuery(event.target.value); }}
            className="mt-1 h-14 w-full rounded-xl border-2 border-slate-500 px-3 text-lg font-normal"
            autoComplete="name"
          />
        </label>
        {suggestions.length > 0 && (
          <div className="-mt-2 rounded-xl border-2 border-slate-300 bg-white p-2" role="listbox" aria-label="Matching customers">
            {suggestions.map((customer) => (
              <button key={customer.id} type="button" onClick={() => chooseCustomer(customer)} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left font-semibold hover:bg-slate-100">
                <Search size={17} aria-hidden="true" />
                <span className="flex-1">{customer.name}</span>
                {customer.totalDebtPesewas > 0 && <span className="text-sm text-slate-600">{formatGhs(customer.totalDebtPesewas)}</span>}
              </button>
            ))}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block font-bold">
            Phone
            <input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} className="mt-1 h-14 w-full rounded-xl border-2 border-slate-500 px-3 text-lg font-normal" autoComplete="tel" />
          </label>
          <label className="block font-bold">
            Ghana Card
            <input value={ghanaCardNumber} onChange={(event) => setGhanaCardNumber(formatGhanaCard(event.target.value))} className="mt-1 h-14 w-full rounded-xl border-2 border-slate-500 px-3 text-lg font-normal" autoCapitalize="characters" />
          </label>
        </div>

        <label className="block font-bold">
          Amount owed (GH₵)
          <input required type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className="mt-1 h-14 w-full rounded-xl border-2 border-rose-900 bg-rose-100 px-3 text-2xl font-extrabold text-rose-950" />
        </label>

        <label className="block font-bold">
          Note
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="What was sold?" className="mt-1 h-14 w-full rounded-xl border-2 border-slate-500 px-3 text-lg font-normal" />
        </label>

        <label className="flex min-h-12 items-center gap-3 rounded-xl border-2 border-slate-500 px-3 font-bold">
          <input type="checkbox" checked={isInstallmentPlan} onChange={(event) => setIsInstallmentPlan(event.target.checked)} className="h-5 w-5" />
          Set up an installment plan
        </label>

        {isInstallmentPlan && (
          <fieldset className="grid gap-3 rounded-xl border-2 border-slate-300 p-3 sm:grid-cols-2">
            <legend className="px-1 font-bold">Installment plan</legend>
            <label className="block font-bold">
              Payment amount (GH₵)
              <input required type="number" min="0.01" max={(maximumInstallmentPesewas / 100).toFixed(2)} step="0.01" value={installmentAmount} onChange={(event) => setInstallmentAmount(event.target.value)} className="mt-1 h-12 w-full rounded-xl border-2 border-slate-500 px-3 font-normal" />
            </label>
            <label className="block font-bold">
              Frequency
              <select value={installmentFrequency} onChange={(event) => { const frequency = event.target.value; setInstallmentFrequency(frequency); setNextDueDate(getNextCycleDate(localDateString(), frequency)); }} className="mt-1 h-12 w-full rounded-xl border-2 border-slate-500 bg-white px-3 font-normal">
                {PAYMENT_FREQUENCIES.map((frequency) => <option key={frequency.value} value={frequency.value}>{frequency.label}</option>)}
              </select>
            </label>
            <div className="sm:col-span-2">
              <span className="font-bold">Schedule starts</span>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <button type="button" aria-pressed={installmentStartMode === "next-cycle"} onClick={() => setInstallmentStartMode("next-cycle")} className={`min-h-11 rounded-xl font-bold ${installmentStartMode === "next-cycle" ? "bg-emerald-100 text-emerald-900 ring-2 ring-emerald-800" : "bg-slate-100"}`}>Next cycle</button>
                <button type="button" aria-pressed={installmentStartMode === "today"} onClick={() => setInstallmentStartMode("today")} className={`min-h-11 rounded-xl font-bold ${installmentStartMode === "today" ? "bg-emerald-100 text-emerald-900 ring-2 ring-emerald-800" : "bg-slate-100"}`}>Start today</button>
              </div>
            </div>
            {installmentStartMode === "next-cycle" && (
              <label className="block font-bold sm:col-span-2">
                First due date
                <input type="date" required value={nextDueDate} onChange={(event) => setNextDueDate(event.target.value)} className="mt-1 h-12 w-full rounded-xl border-2 border-slate-500 px-3 font-normal" />
              </label>
            )}
            {installmentStartMode === "today" && (
              <label className="block font-bold sm:col-span-2">
                Initial payment method
                <select value={installmentPaymentMethod} onChange={(event) => setInstallmentPaymentMethod(event.target.value)} className="mt-1 h-12 w-full rounded-xl border-2 border-slate-500 bg-white px-3 font-normal">
                  <option value="cash">Cash</option>
                  <option value="momo">MoMo</option>
                </select>
              </label>
            )}
          </fieldset>
        )}

        {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
        <div className="mt-2 grid grid-cols-2 gap-2">
          <PosSecondaryButton type="button" onClick={onBack} disabled={saving}>Cancel</PosSecondaryButton>
          <PosPrimaryButton type="submit" disabled={saving}>{saving ? "Saving…" : "Save debt"}</PosPrimaryButton>
        </div>
      </form>
    </PosPage>
  );
}
