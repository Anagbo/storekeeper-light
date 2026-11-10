import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Phone, Wallet } from "lucide-react";
import { db } from "../db/db.js";
import { formatDate } from "../lib/formatDate.js";
import { formatGhs, toPesewas } from "../lib/money.js";
import { localDateString } from "../utils/installments.js";
import { getSupplierBalances, SUPPLIER_CATEGORIES } from "../utils/suppliers.js";
import { posText as t } from "./i18n.js";
import { PosBackButton, PosCard, PosPage, PosPrimaryButton, PosSecondaryButton, PosStatusTag } from "./PosComponents.jsx";

const CATEGORY_LABELS = Object.freeze({
  stock: "expense.category.stock",
  transport: "expense.category.transport",
  rent: "expense.category.rent",
  utilities: "expense.category.utilities",
  other: "expense.category.other"
});

function AmountInput({ label, value, onChange }) {
  return (
    <label className="block rounded-[18px] border-2 border-slate-600 bg-white px-3 py-2">
      <span className="block text-base font-bold">{label}</span>
      <span className="flex items-center gap-2 text-3xl font-extrabold">
        <span aria-hidden="true">GH₵</span>
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="0.00"
          className="w-full min-w-0 bg-transparent text-right outline-none"
        />
      </span>
    </label>
  );
}

export function SpentMoney({ onBack, onNavigate, onSave }) {
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("stock");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const amountPesewas = toPesewas(amount);

  function continueToSupplierScreen() {
    if (!Number.isSafeInteger(amountPesewas) || amountPesewas <= 0) {
      setError(t("expense.enterAmount"));
      return;
    }
    if (category !== "stock") {
      setError(t("expense.creditStockOnly"));
      return;
    }
    onNavigate("StockOnCredit", { amountPesewas, category, note });
  }

  async function save() {
    if (saving || !Number.isSafeInteger(amountPesewas) || amountPesewas <= 0) return;
    setSaving(true);
    setError("");
    try {
      await onSave({ amountPesewas, paidAmountPesewas: amountPesewas, category, note });
    } catch (saveError) {
      console.error("Could not save this expense.", saveError);
      setError(t("expense.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PosPage className="flex max-w-2xl flex-col gap-3">
      <div className="flex items-center gap-3">
        <PosBackButton onClick={onBack} />
        <h1 className="text-2xl font-extrabold">{t("expense.title")}</h1>
      </div>
      <AmountInput label={t("expense.amount")} value={amount} onChange={setAmount} />
      <fieldset className="space-y-2">
        <legend className="mb-1 text-lg font-extrabold">{t("expense.whatFor")}</legend>
        <div className="grid grid-cols-2 gap-2">
          {SUPPLIER_CATEGORIES.map((option) => (
            <button key={option} type="button" aria-pressed={category === option} onClick={() => { setCategory(option); setError(""); }} className={`min-h-12 rounded-xl border-2 px-3 text-left font-bold ${category === option ? "border-emerald-900 bg-emerald-100" : "border-slate-500 bg-white"}`}>
              {t(CATEGORY_LABELS[option])}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="block space-y-1">
        <span className="text-base font-bold">{t("expense.note")}</span>
        <input value={note} onChange={(event) => setNote(event.target.value)} className="min-h-12 w-full rounded-xl border-2 border-slate-500 px-3" />
      </label>
      <fieldset>
        <legend className="mb-1 text-lg font-extrabold">{t("expense.paidAllNow")}</legend>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" aria-pressed="true" className="min-h-[60px] rounded-2xl border-[3px] border-emerald-900 bg-emerald-900 text-xl font-extrabold text-white">
            {t("expense.yes")}
          </button>
          <button type="button" onClick={continueToSupplierScreen} className="min-h-[60px] rounded-2xl border-[3px] border-slate-500 bg-white text-xl font-extrabold">
            {t("expense.no")}
          </button>
        </div>
      </fieldset>
      {error && <p role="alert" className="rounded-xl bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
      <PosPrimaryButton type="button" onClick={() => void save()} disabled={saving || !Number.isSafeInteger(amountPesewas) || amountPesewas <= 0}>
        {saving ? t("expense.saving") : t("expense.save")}
      </PosPrimaryButton>
    </PosPage>
  );
}

export function StockOnCredit({ params, onBack, onSaveExpense }) {
  const suppliers = useLiveQuery(() => db.suppliers.orderBy("nameLower").toArray(), [], []);
  const amountPesewas = Number.isSafeInteger(params?.amountPesewas) ? params.amountPesewas : 0;
  const [paidAmount, setPaidAmount] = useState("0");
  const [supplierId, setSupplierId] = useState("");
  const [newSupplier, setNewSupplier] = useState(false);
  const [supplierName, setSupplierName] = useState("");
  const [supplierPhone, setSupplierPhone] = useState("");
  const [payBy, setPayBy] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const paidPesewas = toPesewas(paidAmount);
  const validPaidAmount = Number.isSafeInteger(paidPesewas) && paidPesewas >= 0 && paidPesewas <= amountPesewas;
  const owedPesewas = Math.max(0, amountPesewas - (Number.isSafeInteger(paidPesewas) ? paidPesewas : 0));

  async function save() {
    if (saving || !Number.isSafeInteger(paidPesewas) || paidPesewas < 0 || paidPesewas > amountPesewas) return;
    if (owedPesewas > 0 && !newSupplier && !supplierId) {
      setError(t("expense.supplierRequired"));
      return;
    }
    if (owedPesewas > 0 && newSupplier && !supplierName.trim()) {
      setError(t("expense.supplierNameRequired"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSaveExpense({
        amountPesewas,
        paidAmountPesewas: paidPesewas,
        category: "stock",
        note: params?.note ?? "",
        supplierId: newSupplier ? undefined : supplierId || undefined,
        newSupplier: newSupplier ? { name: supplierName, phone: supplierPhone } : undefined,
        payBy
      });
    } catch (saveError) {
      console.error("Could not save the stock purchase.", saveError);
      setError(t("expense.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PosPage className="flex max-w-2xl flex-col gap-3">
      <div className="flex items-center gap-3">
        <PosBackButton onClick={onBack} />
        <h1 className="text-2xl font-extrabold">{t("expense.stockTitle")}</h1>
      </div>
      <PosCard className="space-y-2">
        <div className="flex justify-between gap-3"><span>{t("expense.stockTotal")}</span><strong>{formatGhs(amountPesewas ?? 0)}</strong></div>
        <div className="flex justify-between gap-3"><span>{t("expense.stillOwed")}</span><strong className={owedPesewas > 0 ? "text-rose-900" : "text-emerald-900"}>{formatGhs(owedPesewas)}</strong></div>
      </PosCard>
      <AmountInput label={t("expense.paidNow")} value={paidAmount} onChange={setPaidAmount} />
      {!validPaidAmount && <p role="alert" className="rounded-xl bg-rose-100 p-3 font-semibold text-rose-950">{t("expense.paidAmountTooHigh")}</p>}
      {owedPesewas > 0 && (
        <section className="space-y-3 rounded-2xl border-2 border-slate-500 p-3">
          <label className="block space-y-1">
            <span className="font-bold">{t("expense.supplier")}</span>
            <select value={newSupplier ? "__new__" : supplierId} onChange={(event) => {
              const value = event.target.value;
              setNewSupplier(value === "__new__");
              setSupplierId(value === "__new__" ? "" : value);
            }} className="min-h-12 w-full rounded-xl border-2 border-slate-500 bg-white px-3">
              <option value="">{t("expense.chooseSupplier")}</option>
              {suppliers?.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
              <option value="__new__">{t("expense.newSupplier")}</option>
            </select>
          </label>
          {newSupplier && (
            <>
              <label className="block space-y-1"><span className="font-bold">{t("expense.supplierName")}</span><input value={supplierName} onChange={(event) => setSupplierName(event.target.value)} className="min-h-12 w-full rounded-xl border-2 border-slate-500 px-3" /></label>
              <label className="block space-y-1"><span className="font-bold">{t("expense.supplierPhone")}</span><input type="tel" inputMode="tel" value={supplierPhone} onChange={(event) => setSupplierPhone(event.target.value)} className="min-h-12 w-full rounded-xl border-2 border-slate-500 px-3" /></label>
            </>
          )}
          <label className="block space-y-1"><span className="font-bold">{t("expense.payBy")}</span><input type="date" value={payBy} onChange={(event) => setPayBy(event.target.value)} className="min-h-12 w-full rounded-xl border-2 border-slate-500 px-3" /></label>
        </section>
      )}
      {error && <p role="alert" className="rounded-xl bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
      <PosPrimaryButton type="button" onClick={() => void save()} disabled={saving || !Number.isSafeInteger(amountPesewas) || amountPesewas <= 0 || !validPaidAmount}>
        {saving ? t("expense.saving") : t("expense.save")}
      </PosPrimaryButton>
    </PosPage>
  );
}

export function YouOweSuppliers({ onBack, onPay }) {
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const today = localDateString();
  const suppliers = useLiveQuery(async () => {
    const [transactions, records] = await Promise.all([db.transactions.toArray(), db.suppliers.toArray()]);
    return getSupplierBalances(transactions, records);
  }, [], undefined);

  async function submitPayment(supplier) {
    const amountPesewas = toPesewas(amount);
    if (saving || !Number.isSafeInteger(amountPesewas) || amountPesewas <= 0 || amountPesewas > supplier.balancePesewas) return;
    setSaving(true);
    setError("");
    try {
      await onPay(supplier.id, amountPesewas);
      setSelectedSupplier(null);
      setAmount("");
    } catch (paymentError) {
      console.error("Could not record the supplier payment.", paymentError);
      setError(t("supplier.paymentFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PosPage className="flex max-w-3xl flex-col gap-3">
      <div className="flex items-center gap-3">
        <PosBackButton onClick={onBack} />
        <h1 className="text-2xl font-extrabold">{t("supplier.title")}</h1>
      </div>
      {!suppliers ? <p role="status">{t("supplier.loading")}</p> : suppliers.length === 0 ? (
        <PosCard><p className="font-semibold">{t("supplier.empty")}</p></PosCard>
      ) : (
        <>
          <PosCard className="amount-fit-container flex items-center justify-between gap-2"><strong>{t("supplier.totalOwed")}</strong><strong className="amount-fit text-right font-extrabold">{formatGhs(suppliers.reduce((sum, supplier) => sum + supplier.balancePesewas, 0))}</strong></PosCard>
          {suppliers.map((supplier) => (
            <PosCard key={supplier.id} className="amount-fit-container flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-extrabold">{supplier.name}</h2>
                <p className="amount-fit font-bold">{formatGhs(supplier.balancePesewas)}</p>
                <PosStatusTag tone={supplier.dueStatus === "late" ? "red" : supplier.dueStatus === "today" ? "amber" : "neutral"}>
                  {supplier.dueStatus === "late" ? t("supplier.late", { days: Math.ceil((Date.parse(`${today}T00:00:00.000Z`) - Date.parse(`${supplier.nextDueDate}T00:00:00.000Z`)) / 86400000) }) :
                    supplier.dueStatus === "today" ? t("supplier.dueToday") :
                      supplier.nextDueDate ? t("supplier.dueDate", { date: formatDate(supplier.nextDueDate) }) : t("supplier.noDueDate")}
                </PosStatusTag>
              </div>
              <div className="flex gap-2">
                <PosSecondaryButton type="button" onClick={() => { setSelectedSupplier(supplier); setAmount((supplier.balancePesewas / 100).toFixed(2)); setError(""); }}><Wallet size={20} aria-hidden="true" />{t("supplier.pay")}</PosSecondaryButton>
                <a href={supplier.phone ? `tel:${supplier.phone.replace(/[^\d+]/g, "")}` : undefined} aria-label={t("supplier.call", { name: supplier.name })} aria-disabled={!supplier.phone} className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border-2 border-slate-600 aria-disabled:opacity-40"><Phone size={22} aria-hidden="true" /></a>
              </div>
            </PosCard>
          ))}
        </>
      )}
      {selectedSupplier && (
        <section role="dialog" aria-modal="true" aria-labelledby="supplier-payment-title" className="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/60 p-3 sm:items-center">
          <div className="w-full max-w-md space-y-3 rounded-2xl border-2 border-slate-900 bg-white p-4">
            <h2 id="supplier-payment-title" className="text-xl font-extrabold">{t("supplier.payTitle", { name: selectedSupplier.name })}</h2>
            <p className="font-semibold">{t("supplier.balance", { amount: formatGhs(selectedSupplier.balancePesewas) })}</p>
            <AmountInput label={t("supplier.paymentAmount")} value={amount} onChange={setAmount} />
            {error && <p role="alert" className="rounded-xl bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
            <PosPrimaryButton type="button" onClick={() => void submitPayment(selectedSupplier)} disabled={saving || !Number.isSafeInteger(toPesewas(amount)) || toPesewas(amount) <= 0 || toPesewas(amount) > selectedSupplier.balancePesewas}>
              {saving ? t("expense.saving") : t("supplier.recordPayment")}
            </PosPrimaryButton>
            <PosSecondaryButton type="button" onClick={() => setSelectedSupplier(null)}>{t("expense.cancel")}</PosSecondaryButton>
          </div>
        </section>
      )}
    </PosPage>
  );
}
