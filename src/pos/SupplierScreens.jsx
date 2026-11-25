import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Banknote, Smartphone, Wallet } from "lucide-react";
import { db } from "../db/db.js";
import { displayName } from "../lib/displayName.js";
import { formatDate } from "../lib/formatDate.js";
import { formatGhs, toPesewas } from "../lib/money.js";
import { localDateString } from "../utils/installments.js";
import { getSupplierBalances, orderSuppliersByRecentUse, orderSuppliersByUrgency, SUPPLIER_CATEGORIES } from "../utils/suppliers.js";
import { posText as t } from "./i18n.js";
import AmountTextInput from "./AmountTextInput.jsx";
import { PartyCard, dueTag } from "./PartyCard.jsx";
import { AddButton, PosBackButton, PosCard, PosPage, PosPrimaryButton, PosSecondaryButton } from "./PosComponents.jsx";
import { useBackBlock, useBackHandler } from "./browserBack.js";
import { useFormErrors } from "./formErrors.js";
import WideDialog, { useWideDialogs } from "./WideDialog.jsx";
import { useLayoutContext } from "./layout.js";
import { SOFT_TILE } from "./softTile.js";
import { findDuplicatePerson, suppliersWithBalances } from "./duplicatePerson.js";
import DuplicatePersonQuestion from "./DuplicatePersonQuestion.jsx";

const CATEGORY_LABELS = Object.freeze({
  stock: "expense.category.stock",
  transport: "expense.category.transport",
  rent: "expense.category.rent",
  utilities: "expense.category.utilities",
  other: "expense.category.other"
});

// Wiring 44/45/46 "Paid with": Cash or MoMo, Cash by default, each with its icon (wide_layout icons
// rule). One control for the three screens; the choice is stored as paidWith.
export function PaidWithChoice({ value, onChange }) {
  return (
    <fieldset data-paid-with="">
      <legend className="mb-1 text-lg font-extrabold">{t("expense.paidWith")}</legend>
      <div className="grid grid-cols-2 gap-2">
        {[["cash", Banknote, "credit.method.cash"], ["momo", Smartphone, "credit.method.momo"]].map(([method, Icon, label]) => (
          <button
            key={method}
            type="button"
            aria-pressed={value === method}
            onClick={() => onChange(method)}
            className={`flex min-h-[56px] min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-2xl border-[3px] px-2 text-xl font-extrabold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 ${value === method ? "border-emerald-900 bg-emerald-900 text-white" : "border-slate-500 bg-white text-slate-950"}`}
          >
            <Icon size={22} aria-hidden="true" />{t(label)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function AmountInput({ label, value, onChange }) {
  return (
    <label data-field-box="" className="block rounded-[18px] border-2 border-slate-600 bg-white px-3 py-2">
      <span className="block text-base font-bold">{label}</span>
      <span className="flex items-center gap-2 text-3xl font-extrabold">
        <span aria-hidden="true">GH₵</span>
        <AmountTextInput
          value={value}
          onValue={onChange}
          placeholder="0.00"
          className="w-full min-w-0 bg-transparent outline-none"
        />
      </span>
    </label>
  );
}

export function SpentMoney({ params = {}, onBack, onNavigate, onUpdateParams, onSave }) {
  // draft_survives_trip_away: the amount, category and note are also kept in the route params, so
  // No > 45 > Back shows them again. Save and Home start empty.
  const [amount, setAmount] = useState(params.expenseAmount ?? "");
  const [category, setCategory] = useState(params.expenseCategory ?? "stock");
  const [note, setNote] = useState(params.expenseNote ?? "");
  const [paidWith, setPaidWith] = useState(params.expensePaidWith === "momo" ? "momo" : "cash");
  const [saving, setSaving] = useState(false);
  useBackBlock(saving);
  const [error, setError] = useState("");
  const amountPesewas = toPesewas(amount);
  // rules_global.form_errors: shown after No with a problem, gone as soon as it is fixed.
  const formErrors = useFormErrors([
    ["amount", Number.isSafeInteger(amountPesewas) && amountPesewas > 0 ? "" : t("expense.enterAmount")],
    ["category", category === "stock" ? "" : t("expense.creditStockOnly")]
  ]);

  function continueToSupplierScreen() {
    setError("");
    if (!formErrors.check()) return;
    // 45's own draft kept from a Back comes back while the amount is the same (routes keptDrafts).
    onNavigate("StockOnCredit", { amountPesewas, category, note, ...(params.keptDrafts && { keptDrafts: params.keptDrafts }) });
  }

  async function save() {
    if (saving || !Number.isSafeInteger(amountPesewas) || amountPesewas <= 0) return;
    setSaving(true);
    setError("");
    formErrors.clear();
    try {
      await onSave({ amountPesewas, paidAmountPesewas: amountPesewas, category, note, paidWith });
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
      <AmountInput label={t("expense.amount")} value={amount} onChange={(value) => {
        // Wiring rules_global.amount_entry: the typed field follows the shared rules (AmountTextInput).
        setAmount(value);
        onUpdateParams?.({ expenseAmount: value });
      }} />
      <fieldset className="space-y-2">
        <legend className="mb-1 text-lg font-extrabold">{t("expense.whatFor")}</legend>
        <div className="grid grid-cols-2 gap-2">
          {SUPPLIER_CATEGORIES.map((option) => (
            <button key={option} type="button" aria-pressed={category === option} onClick={() => { setCategory(option); onUpdateParams?.({ expenseCategory: option }); }} className={`min-h-12 rounded-xl border-2 px-3 text-left font-bold ${category === option ? "border-emerald-900 bg-emerald-100" : "border-slate-500 bg-white"}`}>
              {t(CATEGORY_LABELS[option])}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="block space-y-1">
        <span className="text-base font-bold">{t("expense.note")}</span>
        <input value={note} onChange={(event) => { setNote(event.target.value); onUpdateParams?.({ expenseNote: event.target.value }); }} className="min-h-12 w-full rounded-xl border-2 border-slate-500 px-3" />
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
      {/* Wiring 44: Paid with under Paid all now?, for Yes (Save). No asks it on 45 or at Pay on 46. */}
      <PaidWithChoice value={paidWith} onChange={(method) => { setPaidWith(method); onUpdateParams?.({ expensePaidWith: method }); }} />
      {(formErrors.message || error) && <p role="alert" className="rounded-xl bg-rose-100 p-3 font-semibold text-rose-950">{formErrors.message || error}</p>}
      <PosPrimaryButton type="button" onClick={() => void save()} disabled={saving || !Number.isSafeInteger(amountPesewas) || amountPesewas <= 0}>
        {saving ? t("expense.saving") : t("expense.save")}
      </PosPrimaryButton>
    </PosPage>
  );
}

// 45: a supplier row in the "Who do you owe?" picker (role radio, 60px, circle on the left).
function SupplierRadio({ checked, onSelect, children, ...rest }) {
  const tone = checked ? "border-emerald-900 bg-emerald-50" : "border-slate-300 bg-white";
  return (
    <button type="button" role="radio" aria-checked={checked} onClick={onSelect} {...rest} className={`flex min-h-[60px] w-full min-w-0 items-center gap-3 rounded-[14px] border-2 border-solid px-3.5 py-2 text-left text-[#0F172A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 ${tone}`}>
      {children}
    </button>
  );
}

export function StockOnCredit({ params, onBack, onUpdateParams, onSaveExpense }) {
  // 45: the most recently used suppliers come first (undefined while loading).
  const suppliers = useLiveQuery(async () => {
    const [records, linked] = await Promise.all([db.suppliers.toArray(), db.transactions.where("supplierId").above("").toArray()]);
    return orderSuppliersByRecentUse(suppliersWithBalances(records, linked), linked);
  }, [], undefined);
  const amountPesewas = Number.isSafeInteger(params?.amountPesewas) ? params.amountPesewas : 0;
  // draft_survives_trip_away: Paid now, the supplier (chosen or typed) and the pay-by date are also
  // kept in the route params (stock*), and Back to 44 and No again brings them back.
  const [paidAmount, setPaidAmount] = useState(params?.stockPaidNow ?? "0");
  const [supplierId, setSupplierId] = useState(params?.stockSupplierId ?? "");
  const [newSupplier, setNewSupplier] = useState(params?.stockNewSupplier === true);
  const [showAll, setShowAll] = useState(false);
  const [supplierName, setSupplierName] = useState(params?.stockSupplierName ?? "");
  const [supplierPhone, setSupplierPhone] = useState(params?.stockSupplierPhone ?? "");
  const [payBy, setPayBy] = useState(params?.stockPayBy ?? "");
  // Wiring 45: Paid with for the part paid now, asked only when Paid now is above zero.
  const [paidWith, setPaidWith] = useState(params?.stockPaidWith === "momo" ? "momo" : "cash");
  const [saving, setSaving] = useState(false);
  useBackBlock(saving);
  const [error, setError] = useState("");
  const paidPesewas = toPesewas(paidAmount);
  const validPaidAmount = Number.isSafeInteger(paidPesewas) && paidPesewas >= 0 && paidPesewas <= amountPesewas;
  const owedPesewas = Math.max(0, amountPesewas - (Number.isSafeInteger(paidPesewas) ? paidPesewas : 0));
  // With no suppliers yet, "+ New supplier" is the only row and is already chosen.
  const noSuppliers = Array.isArray(suppliers) && suppliers.length === 0;
  const isNew = newSupplier || noSuppliers;
  const listed = suppliers ?? [];
  const visible = showAll || listed.length <= 4 ? listed : listed.slice(0, 4);
  // rules_global.form_errors: shown after Save with a problem, gone as soon as it is fixed (a supplier
  // chosen, a name typed, or nothing left owed).
  const formErrors = useFormErrors([
    ["supplier", owedPesewas > 0 && !isNew && !supplierId ? t("expense.supplierRequired") : ""],
    ["supplierName", owedPesewas > 0 && isNew && !supplierName.trim() ? t("expense.supplierNameRequired") : ""]
  ]);

  // rules_global.duplicate_person: a new supplier with the name or phone of a known one (owed 0 too)
  // is asked about under the field; Save waits for the answer. "Use this person" picks that supplier;
  // a phone match saved as new has another name, a name match must be renamed (kept by name).
  const [keptAsNew, setKeptAsNew] = useState("");
  const useThisPerson = useRef(null);
  const nameInput = useRef(null);
  const duplicate = isNew ? findDuplicatePerson(listed, { name: supplierName, phone: supplierPhone }) : null;
  const duplicateKey = duplicate ? `${duplicate.by}:${duplicate.person.id}` : "";
  const renaming = Boolean(duplicate && keptAsNew === duplicateKey && duplicate.by === "name");
  const unresolved = Boolean(duplicate && keptAsNew !== duplicateKey) || renaming;
  const question = unresolved ? (
    <DuplicatePersonQuestion
      match={duplicate}
      supplier
      renaming={renaming}
      buttonRef={useThisPerson}
      onUse={() => chooseSupplier(duplicate.person.id)}
      onNew={() => { setKeptAsNew(duplicateKey); if (duplicate.by === "name") setTimeout(() => nameInput.current?.focus(), 0); }}
    />
  ) : null;

  function chooseSupplier(id) {
    // The new supplier fields are hidden, but what was typed in them is kept until Save.
    setNewSupplier(false);
    setSupplierId(id);
    onUpdateParams?.({ stockNewSupplier: false, stockSupplierId: id });
  }

  async function save() {
    if (saving || !Number.isSafeInteger(paidPesewas) || paidPesewas < 0 || paidPesewas > amountPesewas) return;
    setError("");
    if (!formErrors.check()) return;
    if (owedPesewas > 0 && unresolved) {
      (renaming ? nameInput : useThisPerson).current?.focus();
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
        supplierId: isNew ? undefined : supplierId || undefined,
        newSupplier: isNew ? { name: supplierName, phone: supplierPhone } : undefined,
        payBy,
        ...(paidPesewas > 0 && { paidWith })
      });
    } catch (saveError) {
      console.error("Could not save the stock purchase.", saveError);
      setError(t("expense.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  const card = "rounded-[18px] border-2 border-slate-300 bg-white px-4 py-3.5";
  const field = "h-[52px] w-full min-w-0 rounded-[14px] border-2 border-slate-500 bg-white px-3.5 text-lg font-semibold text-[#0F172A]";
  return (
    <PosPage className="flex max-w-2xl flex-col gap-3">
      <div className="flex items-center gap-3">
        <PosBackButton onClick={onBack} />
        <h1 className="text-2xl font-extrabold">{t("expense.stockTitle")}</h1>
      </div>
      <section data-card="totals" className={`flex flex-col gap-2 ${card}`}>
        <div className="flex items-center justify-between gap-3 text-[17px]"><span>{t("expense.stockTotal")}</span><strong className="whitespace-nowrap text-xl">{formatGhs(amountPesewas ?? 0)}</strong></div>
        <div className="flex items-center justify-between gap-3 text-[17px]"><span>{t("expense.stillOwed")}</span><strong data-still-owed="" className={`whitespace-nowrap text-xl ${owedPesewas > 0 ? "text-[#0F172A]" : "text-emerald-900"}`}>{formatGhs(owedPesewas)}</strong></div>
      </section>
      <section data-card="paid-now" className={card}>
        <label className="block">
          <span className="mb-1.5 block text-base font-extrabold">{t("expense.paidNow")}</span>
          <span className="flex h-14 items-center gap-2 rounded-[14px] border-2 border-slate-500 bg-white px-3.5">
            <span className="shrink-0 text-lg font-bold text-slate-700">GH₵</span>
            <AmountTextInput value={paidAmount} onValue={(value) => { setPaidAmount(value); onUpdateParams?.({ stockPaidNow: value }); }} placeholder="0.00" className="h-full w-full min-w-0 bg-transparent text-2xl font-extrabold outline-none" />
          </span>
        </label>
      </section>
      {validPaidAmount && paidPesewas > 0 && (
        <section data-card="paid-with" className={card}>
          <PaidWithChoice value={paidWith} onChange={(method) => { setPaidWith(method); onUpdateParams?.({ stockPaidWith: method }); }} />
        </section>
      )}
      {!validPaidAmount && <p role="alert" className="rounded-xl bg-rose-100 p-3 font-semibold text-rose-950">{t("expense.paidAmountTooHigh")}</p>}
      {owedPesewas > 0 && (
        <>
          <section data-card="supplier" className={`flex flex-col gap-2.5 ${card}`}>
            <h2 id="who-do-you-owe" className="text-base font-extrabold">{t("expense.whoDoYouOwe")}</h2>
            <div role="radiogroup" aria-labelledby="who-do-you-owe" className="flex flex-col gap-2">
              {visible.map((supplier) => {
                const checked = !isNew && supplierId === supplier.id;
                return (
                  <SupplierRadio key={supplier.id} data-supplier-id={supplier.id} checked={checked} onSelect={() => chooseSupplier(supplier.id)}>
                    <span aria-hidden="true" className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${checked ? "border-emerald-900" : "border-slate-500"}`}>
                      {checked && <span data-dot="" className="h-3 w-3 rounded-full bg-emerald-900" />}
                    </span>
                    <b className="min-w-0 flex-1 text-lg [overflow-wrap:anywhere]">{displayName(supplier.name)}</b>
                  </SupplierRadio>
                );
              })}
              {!showAll && listed.length > 4 && (
                <PosSecondaryButton type="button" data-show-all="" onClick={() => setShowAll(true)} className="w-full">
                  {t("expense.showAllSuppliers", { count: listed.length })}
                </PosSecondaryButton>
              )}
              {/* rules_global.button_system.add_variants: "+ New supplier" is the AddButton radio variant. */}
              <AddButton role="radio" checked={isNew} data-supplier-id="new" onClick={() => { setNewSupplier(true); onUpdateParams?.({ stockNewSupplier: true }); }}>
                {t("expense.newSupplierRow")}
              </AddButton>
            </div>
            {isNew && (
              <div data-new-supplier-fields="" className="flex flex-col gap-2.5 pt-1">
                <label className="block"><span className="mb-1.5 block text-[15px] font-bold text-slate-600">{t("expense.supplierName")}</span><input ref={nameInput} value={supplierName} onChange={(event) => { setSupplierName(event.target.value); onUpdateParams?.({ stockSupplierName: event.target.value }); }} className={field} /></label>
                {duplicate?.by === "name" && question}
                <label className="block"><span className="mb-1.5 block text-[15px] font-bold text-slate-600">{t("expense.supplierPhone")}</span><input type="tel" inputMode="tel" value={supplierPhone} onChange={(event) => { setSupplierPhone(event.target.value); onUpdateParams?.({ stockSupplierPhone: event.target.value }); }} className={field} /></label>
                {duplicate?.by === "phone" && question}
              </div>
            )}
          </section>
          <section data-card="pay-by" className={card}>
            <label className="block"><span className="mb-1.5 block text-base font-extrabold">{t("expense.payBy")}</span><input type="date" value={payBy} onChange={(event) => { setPayBy(event.target.value); onUpdateParams?.({ stockPayBy: event.target.value }); }} className={field} /></label>
          </section>
        </>
      )}
      {(formErrors.message || error) && <p role="alert" className="rounded-xl bg-rose-100 p-3 font-semibold text-rose-950">{formErrors.message || error}</p>}
      <PosPrimaryButton type="button" onClick={() => void save()} disabled={saving || !Number.isSafeInteger(amountPesewas) || amountPesewas <= 0 || !validPaidAmount}>
        {saving ? t("expense.saving") : t("expense.save")}
      </PosPrimaryButton>
    </PosPage>
  );
}


export function YouOweSuppliers({ onBack, onPay }) {
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const wideDialog = useWideDialogs();
  const layout = useLayoutContext();
  const [amount, setAmount] = useState("");
  // Wiring 44 rule: Pay on 46 records Cash or MoMo (default Cash) for money owed from a No on 44.
  const [paidWith, setPaidWith] = useState("cash");
  const [saving, setSaving] = useState(false);
  useBackBlock(saving);
  const [error, setError] = useState("");
  // A back press closes the Pay sheet as Cancel does (not while the payment is saving).
  useBackHandler(Boolean(selectedSupplier), () => setSelectedSupplier(null));
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
      await onPay(supplier.id, amountPesewas, paidWith);
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
          {/* D14 / 46: never amber. Wide: on the grey page with no card (as the Total owed on 32); phone: the soft grey tile. */}
          <section data-summary="suppliers" className={layout.wide ? "flex items-center justify-between gap-4 px-1" : `${SOFT_TILE} p-4 text-[#0F172A]`}>
            <div className={layout.wide ? "min-w-0" : "flex flex-1 items-baseline justify-between gap-2"}>
              <strong className={`${layout.wide ? "block text-[17px]" : "text-lg"} text-[#334155]`}>{t("supplier.totalOwed")}</strong>
              <span className={`${layout.wide ? "block text-[15px]" : ""} font-bold text-[#334155]`}>{suppliers.length === 1 ? t("supplier.countOne") : t("supplier.countMany", { count: suppliers.length })}</span>
            </div>
            <p data-supplier-total="" className={`${layout.wide ? "text-[40px]" : "mt-1 text-[28px]"} whitespace-nowrap font-bold leading-tight text-[#0F172A]`}>{formatGhs(suppliers.reduce((sum, supplier) => sum + supplier.balancePesewas, 0))}</p>
          </section>
          <div data-supplier-grid="" className={`grid min-w-0 gap-3 ${layout.mode === "sidebar" ? "grid-cols-2" : "grid-cols-1"}`}>
          {orderSuppliersByUrgency(suppliers, today).map((supplier) => {
            const name = displayName(supplier.name);
            // 46: Pay is solid green only for Late and Due in 3 days or less; outlined otherwise.
            const urgent = ((dueTag(supplier.nextDueDate, { today, wording: "supplier" })?.days ?? Infinity) <= 3);
            const late = supplier.nextDueDate && supplier.nextDueDate < today;
            const dateText = formatDate(supplier.nextDueDate) ? t(late ? "supplier.wasDue" : "supplier.dueDate", { date: formatDate(supplier.nextDueDate) }) : "";
            return (
              <PartyCard
                key={supplier.id}
                data-supplier={supplier.name}
                name={supplier.name}
                amountPesewas={supplier.balancePesewas}
                amountSize={layout.wide ? 26 : 24}
                dueDate={supplier.nextDueDate}
                today={today}
                dateText={dateText}
                cardWide={layout.wide}
                reserveCall
                wording="supplier"
                action={{ label: t("supplier.pay"), ariaLabel: t("supplier.payAria", { name }), icon: Wallet, outlined: !urgent, onClick: () => { setSelectedSupplier(supplier); setAmount((supplier.balancePesewas / 100).toFixed(2)); setPaidWith("cash"); setError(""); } }}
                phone={supplier.phone}
                callLabel={t("supplier.call", { name })}
              />
            );
          })}
          </div>
        </>
      )}
      {selectedSupplier && (() => {
        const payBody = (
          <>
            <h2 id="supplier-payment-title" data-sheet-title="supplier-pay" className="min-w-0 text-xl font-extrabold [overflow-wrap:anywhere]">{t("supplier.payTitle", { name: displayName(selectedSupplier.name) })}</h2>
            <p className="font-semibold">{t("supplier.balance", { amount: formatGhs(selectedSupplier.balancePesewas) })}</p>
            <AmountInput label={t("supplier.paymentAmount")} value={amount} onChange={setAmount} />
            <PaidWithChoice value={paidWith} onChange={setPaidWith} />
            {error && <p role="alert" className="rounded-xl bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
            {/* 46 Pay sheet: Record payment (green) and Cancel (outlined) below it, both full width and 52px. */}
            <button type="button" onClick={() => void submitPayment(selectedSupplier)} disabled={saving || !Number.isSafeInteger(toPesewas(amount)) || toPesewas(amount) <= 0 || toPesewas(amount) > selectedSupplier.balancePesewas} className="flex h-[52px] w-full items-center justify-center rounded-2xl border-2 border-emerald-950 bg-emerald-900 px-4 text-lg font-extrabold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? t("expense.saving") : t("supplier.recordPayment")}
            </button>
            <button type="button" onClick={() => setSelectedSupplier(null)} className="flex h-[52px] w-full items-center justify-center rounded-2xl border-2 border-slate-600 bg-white px-4 text-lg font-extrabold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800">{t("expense.cancel")}</button>
          </>
        );
        // wide_layout.page_types.dialog: on wide the shared WideDialog; Escape and a scrim click are
        // Cancel, not while the payment is saving.
        if (wideDialog) {
          return (
            <WideDialog labelledBy="supplier-payment-title" onClose={() => { if (!saving) setSelectedSupplier(null); }}>
              <div className="min-w-0 space-y-3">{payBody}</div>
            </WideDialog>
          );
        }
        return (
          <section role="dialog" aria-modal="true" aria-labelledby="supplier-payment-title" className="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/60 p-3 sm:items-center">
            <div className="w-full min-w-0 max-w-md space-y-3 rounded-2xl border-2 border-slate-900 bg-white p-4">{payBody}</div>
          </section>
        );
      })()}
    </PosPage>
  );
}
