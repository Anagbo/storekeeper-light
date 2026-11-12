import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Banknote, Check, Plus, Smartphone, UserRound, UserRoundPlus } from "lucide-react";
import SearchField from "./SearchField.jsx";
import { hasSearchText, matchesSearch } from "../lib/searchMatch.js";
import { db } from "../db/db.js";
import { isValidGhanaCardNumber, normalizeGhanaCardNumber } from "../lib/ghanaCardNumber.js";
import { formatDate } from "../lib/formatDate.js";
import { displayName } from "../lib/displayName.js";
import { formatGhs, toPesewas } from "../lib/money.js";
import { formatGhanaCard } from "../utils/formatters.js";
import { PLAN_ERROR } from "../lib/planErrors.js";
import { addDueCycles, dayAfter, getCreditBalanceAfterSale, getNextCycleDate, isValidDateString, localDateString, PAYMENT_FREQUENCIES, prepareInstallmentPlan } from "../utils/installments.js";
import { generateWhatsAppLink, normalizeWhatsAppPhone } from "../utils/whatsapp.js";
import { getCreditAmountOwedPesewas } from "./creditAmount.js";
import CustomerContactEditor from "./CustomerContactEditor.jsx";
import { PosCard, PosPage, PosPrimaryButton, PosSecondaryButton, PosBackButton } from "./PosComponents.jsx";
import { shortSaveName } from "./saveLabel.js";
import { buildCollectionReceiptLink } from "./collectionReceipt.js";
import { buildCreditSaleReceipt, isReceiptTemplatesEnabled } from "./receiptTemplates.js";
import { posText as t } from "./i18n.js";
import { isSaveOutcomeUnknown } from "../lib/saveAttempt.js";
import { useLargeAmountConfirm } from "./LargeAmountConfirm.jsx";
import SaveAttemptNotice from "./SaveAttemptNotice.jsx";
import { useSaveAttempt } from "./useSaveAttempt.js";
import { getCarriedPaymentParts, getMomoPickParams, getPaidPaymentPesewas } from "./paymentAmount.js";
import { useBackBlock } from "./browserBack.js";
import { confirmDirectMomoParts, describeSplitPart, isLockedMomoRow, isUnconfirmedDirectMomo } from "./splitTender.js";

function amountInputValue(amountPesewas) {
  return (amountPesewas / 100).toFixed(2);
}

function CreditAmount({ amountPesewas }) {
  return (
    <div className="amount-fit-container amount-fit-row flex items-center justify-between gap-3 rounded-2xl bg-rose-100 px-4 py-3 text-rose-950">
      <span className="text-lg font-bold">{t("credit.owed")}</span>
      <strong className="amount-fit text-right font-extrabold">{formatGhs(amountPesewas)}</strong>
    </div>
  );
}

function CustomerChoice({ customer, selected, onSelect }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`flex min-h-[60px] w-full items-center gap-3 rounded-2xl border-[3px] px-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 ${selected ? "border-emerald-900 bg-green-200" : "border-slate-500 bg-white"}`}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-900 text-lg font-extrabold text-white">
        {displayName(customer.name).charAt(0)}
      </span>
      <span className="min-w-0 flex-1 truncate text-lg font-extrabold">{displayName(customer.name)}</span>
      {customer.totalDebtPesewas > 0 && (
        <span className="amount-fit-container w-24 shrink-0 text-right font-extrabold text-rose-900">
          <span className="amount-fit">{formatGhs(customer.totalDebtPesewas)}</span>
        </span>
      )}
      {selected && <Check size={22} aria-hidden="true" />}
    </button>
  );
}

function WhoOwesYou({ params, onBack, onNavigate }) {
  const [customers, setCustomers] = useState([]);
  const [query, setQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(params.customer ?? null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const amountOwedPesewas = getCreditAmountOwedPesewas(params);

  useEffect(() => {
    let active = true;
    async function loadCustomers() {
      try {
        const [customerRows, unpaidDebts] = await Promise.all([
          db.customers.toArray(),
          db.debts.where("status").equals("unpaid").toArray()
        ]);
        const byName = new Map(customerRows.map((customer) => [
          customer.nameLower ?? customer.name.trim().toLowerCase(),
          { ...customer, totalDebtPesewas: 0 }
        ]));
        for (const debt of unpaidDebts) {
          const name = (debt.customerName ?? debt.customer_name ?? "").trim();
          const nameLower = name.toLowerCase();
          if (!nameLower) continue;
          const customer = byName.get(nameLower) ?? {
            id: debt.customerId ?? "",
            name,
            nameLower,
            phone: debt.phone ?? debt.customer_phone ?? "",
            ghanaCardNumber: debt.ghanaCardNumber ?? "",
            totalDebtPesewas: 0
          };
          customer.totalDebtPesewas += debt.amountPesewas ?? debt.total_owed ?? 0;
          if (!customer.debt || (debt.amountPesewas ?? debt.total_owed ?? 0) > (customer.debt.amountPesewas ?? 0)) {
            customer.debt = debt;
          }
          byName.set(nameLower, customer);
        }
        if (active) setCustomers([...byName.values()].sort((left, right) =>
          right.totalDebtPesewas - left.totalDebtPesewas || left.name.localeCompare(right.name)
        ));
      } catch (loadError) {
        console.error("Could not load customers for credit sale.", loadError);
        if (active) setError(t("credit.loadFailed"));
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadCustomers();
    return () => { active = false; };
  }, []);

  const filteredCustomers = useMemo(() => {
    // The same rule as 32: case and spaces ignored, name or phone.
    const matches = hasSearchText(query)
      ? customers.filter((customer) => matchesSearch(query, customer.name, customer.phone))
      : customers.filter((customer) => customer.totalDebtPesewas > 0).slice(0, 5);
    return matches;
  }, [customers, query]);

  function continueToPaymentDate() {
    if (!selectedCustomer) return;
    onNavigate(params.manualDebt ? "ManualDebtAmount" : "WhenWillTheyPay", { ...params, customer: selectedCustomer });
  }

  return (
    <PosPage className="flex flex-col gap-3">
      <h1 className="text-2xl font-extrabold">{t("credit.whoOwes")}</h1>
      {!params.manualDebt && <CreditAmount amountPesewas={amountOwedPesewas} />}
      <SearchField value={query} onChange={setQuery} />
      <h2 className="text-lg font-extrabold text-slate-800">{hasSearchText(query) ? t("credit.searchResults") : t("credit.topDebtors")}</h2>
      {loading ? <p role="status">{t("credit.loading")}</p> : (
        <div className="flex flex-col gap-2">
          {filteredCustomers.map((customer) => (
            <CustomerChoice
              key={customer.id || customer.nameLower}
              customer={customer}
              selected={selectedCustomer?.nameLower === customer.nameLower}
              onSelect={() => setSelectedCustomer(customer)}
            />
          ))}
          {!filteredCustomers.length && <p className="rounded-xl bg-slate-100 p-3">{hasSearchText(query) ? t("credit.noMatches") : t("credit.noDebtors")}</p>}
        </div>
      )}
      {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
      <PosSecondaryButton type="button" onClick={() => onNavigate("NewPerson", { ...params })} className={params.manualDebt ? "border-dashed text-emerald-900" : undefined}>
        <UserRoundPlus size={22} aria-hidden="true" /> {t("credit.newPerson")}
      </PosSecondaryButton>
      <div className="mt-auto grid grid-cols-[auto_minmax(0,1fr)] gap-2">
        <PosBackButton onClick={onBack} className="h-14!" />
        <PosPrimaryButton type="button" disabled={!selectedCustomer || loading} onClick={continueToPaymentDate}>
          {t("credit.next")}
        </PosPrimaryButton>
      </div>
    </PosPage>
  );
}

function NewPerson({ params, onBack, onNavigate }) {
  const amountOwedPesewas = getCreditAmountOwedPesewas(params);
  const isAmountDerivedFromSale = !params.manualDebt &&
    Number.isSafeInteger(params.initialPaymentPesewas) &&
    params.initialPaymentPesewas > 0;
  const [amount, setAmount] = useState(params.manualDebt ? "" : amountInputValue(amountOwedPesewas));
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [ghanaCardNumber, setGhanaCardNumber] = useState("");
  const [error, setError] = useState("");
  // Someone who already owes under the name typed here: the debt is added to theirs (the writers
  // find it by name), so say so, and carry what they owe so 19 sizes the plan on the whole balance.
  const [existingDebtor, setExistingDebtor] = useState(null);
  const amountPesewas = toPesewas(amount);
  const phoneInvalid = Boolean(phone.trim() && !normalizeWhatsAppPhone(phone));

  useEffect(() => {
    const typedName = name.trim().toLowerCase();
    if (!typedName) {
      setExistingDebtor(null);
      return undefined;
    }
    let active = true;
    db.debts.where("status").equals("unpaid").toArray().then((debts) => {
      if (!active) return;
      const matching = debts.filter((debt) => (debt.customerName ?? debt.customer_name ?? "").trim().toLowerCase() === typedName);
      const totalDebtPesewas = matching.reduce((sum, debt) => sum + (debt.amountPesewas ?? debt.total_owed ?? 0), 0);
      setExistingDebtor(totalDebtPesewas > 0
        ? { name: (matching[0].customerName ?? matching[0].customer_name).trim(), totalDebtPesewas }
        : null);
    }).catch((lookupError) => {
      console.error("Could not check whether this person already owes.", lookupError);
      if (active) setExistingDebtor(null);
    });
    return () => { active = false; };
  }, [name]);

  function continueWithNewCustomer(event) {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName || (!params.manualDebt && (!Number.isSafeInteger(amountPesewas) || amountPesewas <= 0))) {
      setError(t("credit.nameAndAmountRequired"));
      return;
    }
    if (phoneInvalid) {
      setError(t("contact.invalidPhone"));
      return;
    }
    if (!isValidGhanaCardNumber(ghanaCardNumber)) {
      setError(t("credit.invalidGhanaCard"));
      return;
    }
    onNavigate(params.manualDebt ? "ManualDebtAmount" : "WhenWillTheyPay", {
      ...params,
      amountPesewas: isAmountDerivedFromSale ? params.amountPesewas : amountPesewas,
      customer: {
        name: cleanName,
        nameLower: cleanName.toLowerCase(),
        phone: phone.trim(),
        ghanaCardNumber: normalizeGhanaCardNumber(ghanaCardNumber),
        ...(existingDebtor && { totalDebtPesewas: existingDebtor.totalDebtPesewas })
      },
      isNewCustomer: true
    });
  }

  return (
    <PosPage className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <PosBackButton onClick={onBack} />
        <h1 className="text-2xl font-extrabold">{t("credit.newPerson")}</h1>
      </div>
      <form onSubmit={continueWithNewCustomer} className="flex flex-1 flex-col gap-3">
        <label className="block">
          <span className="mb-1 block font-extrabold">{params.manualDebt ? "Amount owed later" : t("credit.amountOwed")}</span>
          <input type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} disabled={isAmountDerivedFromSale} onChange={(event) => setAmount(event.target.value)} className="h-14 w-full rounded-2xl border-[3px] border-rose-900 bg-rose-100 px-4 text-2xl font-extrabold text-rose-950 disabled:cursor-not-allowed disabled:opacity-70" />
          <span className="text-sm text-slate-700">{params.manualDebt ? "You will enter the amount next." : t("credit.fromThisSale")}</span>
        </label>
        <label className="block">
          <span className="mb-1 block font-extrabold">{t("credit.name")}</span>
          <input autoComplete="name" placeholder={t("credit.namePlaceholder")} value={name} onChange={(event) => setName(event.target.value)} className="h-14 w-full rounded-2xl border-[3px] border-slate-500 px-3 text-lg" />
          <span className="text-sm text-slate-700">{t("credit.nameHint")}</span>
          {existingDebtor && (
            <span role="status" className="mt-1 block rounded-xl border-2 border-amber-700 bg-amber-100 p-2 text-sm font-semibold text-amber-950">
              {t("credit.existingDebtor", { name: displayName(existingDebtor.name), amount: formatGhs(existingDebtor.totalDebtPesewas) })}
            </span>
          )}
        </label>
        <label className="block">
          <span className="mb-1 block font-extrabold">{t("credit.phone")}</span>
          <input type="tel" inputMode="tel" autoComplete="tel" placeholder={t("credit.phonePlaceholder")} value={phone} onChange={(event) => { setPhone(event.target.value); setError(""); }} aria-invalid={phoneInvalid} aria-describedby="new-person-phone-hint" className={`h-14 w-full rounded-2xl border-[3px] px-3 text-lg ${phoneInvalid ? "border-rose-900" : "border-slate-500"}`} />
          <span id="new-person-phone-hint" className={`text-sm ${phoneInvalid ? "text-rose-900" : "text-slate-700"}`}>{phoneInvalid ? t("contact.invalidPhone") : t("credit.phoneHint")}</span>
        </label>
        <label className="block">
          <span className="mb-1 block font-extrabold">{t("credit.ghanaCard")}</span>
          <input autoCapitalize="characters" maxLength="15" placeholder={t("credit.ghanaCardPlaceholder")} value={ghanaCardNumber} onChange={(event) => setGhanaCardNumber(formatGhanaCard(event.target.value))} className="h-14 w-full rounded-2xl border-[3px] border-slate-500 px-3 text-lg" />
          <span className="text-sm text-slate-700">{t("credit.ghanaCardHint")}</span>
        </label>
        {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
        <PosPrimaryButton type="submit" className="mt-auto">{t("credit.next")}</PosPrimaryButton>
      </form>
    </PosPage>
  );
}

function WhenWillTheyPay({ params, onBack, onNavigate, onReturnToSplit, onSaveCredit }) {
  const [dueChoice, setDueChoice] = useState(params.creditDueChoice ?? "week");
  const [saving, setSaving] = useState(false);
  useBackBlock(saving);
  const [error, setError] = useState("");
  // E8: a ref, not the state, so a second tap in the same frame sees the first one.
  const savingRef = useRef(false);
  const saveAttempt = useSaveAttempt();
  const largeAmount = useLargeAmountConfirm();
  // Shown with a capital first letter; the stored name is not changed.
  const customerName = displayName(params.customer?.name);
  const choices = [
    { value: "today", label: t("credit.today") },
    { value: "week", label: t("credit.inOneWeek") },
    { value: "twoWeeks", label: t("credit.inTwoWeeks") }
  ];
  const totalAfterSalePesewas = (params.customer?.totalDebtPesewas ?? 0) + getCreditAmountOwedPesewas(params);

  async function save(confirmed = false) {
    if (savingRef.current) return;
    // Brief 3.12: a large credit sale asks first. In a split (16 saves) and for a manual debt (a later
    // extension) it does not ask here.
    if (!confirmed && params.flow !== "split" && !params.manualDebt &&
      largeAmount.guard(params.amountPesewas, () => void save(true))) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const days = { today: 0, week: 7, twoWeeks: 14 }[dueChoice];
      const details = {
        ...params,
        dueDate: addDueCycles(localDateString(), "weekly", days / 7),
        payBackLabel: choices.find((choice) => choice.value === dueChoice)?.label ?? t("credit.inOneWeek")
      };
      if (params.flow === "split") {
        // SAVECREDIT: back to the existing 16, dropping 17 and 18 from history (K4).
        onReturnToSplit({ ...details, splitParts: params.initialPaymentParts ?? [] });
      } else {
        await saveAttempt.run(details, (attemptId) => onSaveCredit({ ...details, attemptId }));
      }
    } catch (saveError) {
      console.error("Could not save this credit sale.", saveError);
      setError(isSaveOutcomeUnknown(saveError) ? "" : t("credit.saveFailed"));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <PosPage className="flex flex-col gap-3">
      <h1 className="text-2xl font-extrabold">{t("credit.whenPay", { name: customerName })}</h1>
      {choices.map((choice) => (
        <button key={choice.value} type="button" aria-pressed={dueChoice === choice.value} onClick={() => setDueChoice(choice.value)} className={`min-h-[68px] rounded-2xl border-[3px] px-4 text-xl font-extrabold ${dueChoice === choice.value ? "border-emerald-900 bg-green-200" : "border-slate-500 bg-white"}`}>
          {choice.label}
        </button>
      ))}
      <button type="button" onClick={() => onNavigate("ALittleAtATime", { ...params, creditDueChoice: dueChoice })} className="flex min-h-[68px] flex-col items-center justify-center rounded-2xl border-[3px] border-slate-500 px-4 text-lg font-extrabold">
        {t("credit.aLittleAtATime")}
        <span className="text-sm font-semibold text-slate-700">{t("credit.installmentSubtitle")}</span>
      </button>
      {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
      <SaveAttemptNotice saveAttempt={saveAttempt} busy={saving} onTryAgain={() => void save(true)} />
      <div className="mt-auto grid grid-cols-[auto_minmax(0,1fr)] gap-2">
        <PosBackButton onClick={onBack} className="h-14!" />
        <PosPrimaryButton type="button" disabled={saving} onClick={() => void save()} className="h-14 px-2 text-base leading-tight">{saving ? t("credit.saving") : t("credit.saveAmount", { name: shortSaveName(customerName), amount: formatGhs(totalAfterSalePesewas) })}</PosPrimaryButton>
      </div>
      {largeAmount.dialog}
    </PosPage>
  );
}

// What the merchant sees when saving the plan fails: the known causes name what to fix; anything
// else keeps the general message.
function describePlanSaveError(saveError, maxCreditPesewas) {
  if (saveError?.message === "Choose a valid next installment due date.") return t("credit.invalidDueDate");
  if (saveError?.code === PLAN_ERROR.eachTimeTooHigh) return t("credit.eachTimeTooHigh");
  if (saveError?.code === PLAN_ERROR.paymentTooHigh) {
    const maximumPesewas = Number.isSafeInteger(saveError.maximumPesewas) ? saveError.maximumPesewas : maxCreditPesewas;
    return t("credit.paymentTodayTooHigh", { amount: formatGhs(maximumPesewas) });
  }
  if (saveError?.code === PLAN_ERROR.debtChanged) return t("credit.debtChanged");
  if (saveError?.code === PLAN_ERROR.paymentPartsMismatch) return t("credit.paymentPartsMismatch");
  return t("credit.invalidInstallment");
}

// 19's own MoMo choice carries its method and confirmation on the saved part (MOMO16).
function getMomoChoiceFields(paymentMethod, params) {
  if (paymentMethod !== "momo") return {};
  return {
    ...(params.momoMethod ? { momoMethod: params.momoMethod } : {}),
    ...(params.verification ? { verification: params.verification } : {}),
    ...(Number.isSafeInteger(params.momoConfirmedPesewas) ? { confirmedPesewas: params.momoConfirmedPesewas } : {})
  };
}

// A part of today's payment on 19, with its status: "Received ✓" (green) once the MoMo money is
// confirmed, "Customer sends · not confirmed yet" before.
function RecordedPartRow({ part }) {
  const locked = isLockedMomoRow(part);
  const status = locked ? t("split.received") : describeSplitPart(part);
  return (
    <div data-recorded-part={part.paymentMethod} className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 font-bold">
      <span className="flex min-w-0 items-center gap-2">
        {part.paymentMethod === "cash"
          ? <Banknote size={18} className="shrink-0" aria-hidden="true" />
          : <Smartphone size={18} className="shrink-0" aria-hidden="true" />}
        <span className="min-w-0">
          <span className="block truncate">{t(`credit.method.${part.paymentMethod}`)}</span>
          {status && (locked
            ? <span data-row-status="" className="block text-sm font-bold text-emerald-900">{status}</span>
            : <span data-row-status="" className="block text-sm font-semibold text-slate-700 [overflow-wrap:anywhere]">{status}</span>)}
        </span>
      </span>
      <span className="shrink-0 whitespace-nowrap">{formatGhs(part.amountPesewas)}</span>
    </div>
  );
}

// 19 "Owe in the draft panel" (12 Nov 2026): the rows above "Total today" are only the paid parts
// (Cash, MoMo) and add up to it. What is still owed is a separate pink row below the total.
function StillOwedRow({ amountPesewas, customerName }) {
  if (!(amountPesewas > 0)) return null;
  const name = displayName(customerName ?? "");
  return (
    <div data-still-owed="" className="mt-2 flex min-w-0 items-center justify-between gap-3 rounded-xl bg-rose-100 px-3 py-2 font-extrabold text-rose-900">
      <span className="flex min-w-0 items-center gap-2">
        <UserRound size={18} className="shrink-0" aria-hidden="true" />
        <span className="min-w-0 [overflow-wrap:anywhere]">{name ? t("credit.stillOwedName", { name }) : t("credit.stillOwed")}</span>
      </span>
      <span className="shrink-0 whitespace-nowrap">{formatGhs(amountPesewas)}</span>
    </div>
  );
}

const paidOnly = (parts) => parts.filter((part) => part.paymentMethod !== "owe");
const owedOf = (parts) => parts.filter((part) => part.paymentMethod === "owe").reduce((sum, part) => sum + part.amountPesewas, 0);

function ALittleAtATime({ params, onBack, onNavigate, onUpdateParams, onReturnToSplit, onSaveCredit }) {
  const today = localDateString();
  const [installmentAmount, setInstallmentAmount] = useState(params.installmentAmount ?? "");
  const [frequency, setFrequency] = useState(params.frequency ?? "weekly");
  const carriedPaymentParts = getCarriedPaymentParts(params);
  const paidTodayPesewas = getPaidPaymentPesewas(carriedPaymentParts);
  // In a split sale (flow=split) the payment today is taken on 16, so 19 hides its own
  // payment section and passes 16's parts through unchanged (K5, E2).
  const paymentAlreadyMadeToday = params.paymentAlreadyMadeToday === true ||
    params.flow === "split";
  const [startToday, setStartToday] = useState(paymentAlreadyMadeToday ? false : (params.startToday ?? false));
  const [nextDueDate, setNextDueDate] = useState(params.nextDueDate ?? getNextCycleDate(today, params.frequency ?? "weekly"));
  const [paymentMethod, setPaymentMethod] = useState(params.paymentMethod ?? "cash");
  const [todayPaymentAmount, setTodayPaymentAmount] = useState(params.todayPaymentAmount ?? null);
  const [todayPaymentSubmitAttempted, setTodayPaymentSubmitAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  useBackBlock(saving);
  const [error, setError] = useState("");
  // E8: a ref, not the state, so a second tap in the same frame sees the first one.
  const savingRef = useRef(false);
  const saveAttempt = useSaveAttempt();
  const largeAmount = useLargeAmountConfirm();
  const installmentPesewas = toPesewas(installmentAmount);
  const amountPesewas = params.amountPesewas ?? 0;
  const currentDebtPesewas = params.customer?.totalDebtPesewas ?? 0;
  // Paid before 19 (the cash and MoMo parts on 16): already taken off the balance. A payment taken
  // on this screen, including the parts that come back from 27, is today's payment on 19: the
  // balance stays whole and the plan writer takes the payment off once.
  const paidBefore19Pesewas = Number.isSafeInteger(params.initialPaymentPesewas) ? params.initialPaymentPesewas : 0;
  const alreadyPaidPesewas = paymentAlreadyMadeToday ? Math.max(paidBefore19Pesewas, paidTodayPesewas) : paidBefore19Pesewas;
  const creditBalanceBeforeTodayPayment = getCreditBalanceAfterSale(currentDebtPesewas, amountPesewas);
  const maxCreditPesewas = Math.max(0, creditBalanceBeforeTodayPayment - alreadyPaidPesewas);
  const maxStartTodayInstallmentPesewas = creditBalanceBeforeTodayPayment;
  const maxInstallmentPesewas = maxCreditPesewas;
  const maxInstallmentAmount = (maxInstallmentPesewas / 100).toFixed(2);
  const todayPaymentInput = todayPaymentAmount ?? installmentAmount;
  const todayPaymentPesewas = toPesewas(todayPaymentInput);
  const splitParts = carriedPaymentParts;
  // MOMO16 on 19: today's MoMo payment (19's own MoMo choice) once received on 62 is locked: the
  // amount, the method and Next cycle cannot change it. Shown like the parts that come back from 27.
  const singleMomoReceived = paymentMethod === "momo" && isLockedMomoRow({ paymentMethod: "momo", verification: params.verification });
  const recordedParts = splitParts.length > 0
    ? splitParts
    : singleMomoReceived && Number.isSafeInteger(params.momoConfirmedPesewas)
      ? [{ paymentMethod: "momo", amountPesewas: params.momoConfirmedPesewas, momoMethod: params.momoMethod, verification: params.verification }]
      : [];
  const hasReceivedMomo = recordedParts.some(isLockedMomoRow);
  const validTodayPayment = Number.isSafeInteger(todayPaymentPesewas) &&
    todayPaymentPesewas > 0 &&
    todayPaymentPesewas <= maxCreditPesewas;
  // Save plan stays disabled until the plan is valid (K5): an amount each time, a next
  // payment date from today on, and, when paying today on this screen, a valid amount.
  // The first payment date must be after today (brief 3.9 rule 2); the fixed date on 18 may be today.
  const dateValid = isValidDateString(nextDueDate) && nextDueDate > today;
  const planReady = Number.isSafeInteger(installmentPesewas) && installmentPesewas > 0 &&
    dateValid &&
    (!startToday || paymentAlreadyMadeToday || validTodayPayment);

  // Back from a MoMo pick (61/62): returnRoute is stripped on return (E4), so use the method.
  useEffect(() => {
    if (params.paymentMethod === "momo" && params.momoMethod) {
      setPaymentMethod("momo");
    }
  }, [params.paymentMethod, params.momoMethod]);

  // Everything typed or chosen on 19 is also kept in the route params (the same pattern as the
  // amount paid today and the split parts), so Menu > Settings > Back > Close menu and Back from
  // the next screen restore it. The state above already reads these keys back on mount.
  function selectFrequency(nextFrequency) {
    const nextDate = getNextCycleDate(today, nextFrequency);
    setFrequency(nextFrequency);
    setNextDueDate(nextDate);
    onUpdateParams?.({ frequency: nextFrequency, nextDueDate: nextDate });
  }

  // Money received on 62 after Save plan: commit once, straight away (the large-amount ask already ran).
  useEffect(() => {
    if (!params.commitNow) return;
    onUpdateParams?.({ commitNow: undefined });
    void savePlan(true);
  }, []);

  async function savePlan(confirmed = false) {
    if (savingRef.current) return;
    if (startToday && !validTodayPayment) {
      setTodayPaymentSubmitAttempted(true);
      return;
    }
    if (startToday && paymentMethod === "split" && splitParts.length === 0) {
      setError(t("credit.paymentSplitRequired"));
      return;
    }
    // Brief 3.12: a large plan asks first, once the entries are valid. In a split (16 saves) and for a
    // manual debt (a later extension) it does not ask here.
    if (!confirmed && params.flow !== "split" && !params.manualDebt &&
      largeAmount.guard(amountPesewas, () => void savePlan(true))) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      if (!dateValid) {
        throw new Error("Choose a valid next installment due date.");
      }
      const prepared = prepareInstallmentPlan({
        amountPesewas: maxCreditPesewas,
        installmentAmountPesewas: installmentPesewas,
        frequency,
        nextDueDate: startToday ? today : nextDueDate,
        startToday,
        initialPaymentLimitPesewas: startToday ? todayPaymentPesewas : 0
      });
      const plan = startToday && prepared.plan.isInstallmentPlan
        ? { ...prepared.plan, nextDueDate }
        : prepared.plan;
      const payBackLabel = startToday
        ? t("credit.firstPaymentTodayNext", { date: formatDate(nextDueDate) })
        : t("credit.firstPaymentOn", { date: formatDate(nextDueDate) });
      const initialPaymentParts = paymentAlreadyMadeToday
        ? carriedPaymentParts
        : startToday && paymentMethod === "split"
        ? [...(params.initialPaymentParts ?? []), ...splitParts]
        : startToday && prepared.initialPaymentPesewas > 0
          ? [...(params.initialPaymentParts ?? []), { paymentMethod, amountPesewas: prepared.initialPaymentPesewas, ...getMomoChoiceFields(paymentMethod, params) }]
          : (params.initialPaymentParts ?? []);
      if (params.flow === "split") {
        // SAVE19 in a split: back to the existing 16 with the Owe part complete (K4).
        onReturnToSplit({
          ...params,
          dueDate: "",
          installmentPlan: plan,
          splitParts: initialPaymentParts,
          payBackLabel,
          // The 16 Owe row says "first payment {date}" (wiring 16 row layout, 12 Nov 2026).
          firstPaymentDate: startToday ? today : nextDueDate
        });
        return;
      }
      // SAVE19 / MOMO16: a Direct MoMo part not confirmed yet is confirmed on 62 first. Money received
      // there brings 19 back with the part received and the plan is saved once (commitNow above).
      const unconfirmed = initialPaymentParts.find(isUnconfirmedDirectMomo);
      if (unconfirmed) {
        const confirmedParts = confirmDirectMomoParts(splitParts);
        onNavigate("MoMoDirect", {
          ...params,
          splitTotalPesewas: initialPaymentParts.reduce((sum, part) => sum + part.amountPesewas, 0),
          splitParts: initialPaymentParts.filter((part) => part !== unconfirmed),
          pendingMomoAmountPesewas: unconfirmed.amountPesewas,
          momoMethod: "direct",
          confirmFor: "plan19",
          confirmedParams: paymentMethod === "split"
            ? { firstPaymentParts: confirmedParts, splitParts: confirmedParts }
            : { paymentMethod: "momo", momoMethod: "direct", verification: "merchant_confirmed", momoConfirmedPesewas: unconfirmed.amountPesewas, todayPaymentAmount: todayPaymentInput, startToday: true }
        });
        return;
      }
      const { commitNow: _commitNow, ...draftParams } = params;
      const content = {
        ...draftParams,
        dueDate: "",
        installmentPlan: plan,
        initialPaymentPesewas: alreadyPaidPesewas + prepared.initialPaymentPesewas,
        initialPaymentParts,
        paymentMethod: paymentMethod === "momo" ? "momo" : "cash",
        payBackLabel
      };
      await saveAttempt.run(content, (attemptId) => onSaveCredit({ ...content, attemptId }));
    } catch (saveError) {
      console.error("Could not save this installment plan.", saveError);
      setError(isSaveOutcomeUnknown(saveError) ? "" : describePlanSaveError(saveError, maxCreditPesewas));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function choosePaymentMethod(method) {
    if (method === "momo") {
      const toMomo = () => onNavigate("MoMoChoice", getMomoPickParams(params, { todayPaymentPesewas, maxCreditPesewas }));
      // Brief 3.12: a large MoMo amount asks before 61 (before the customer is asked to pay).
      if (!largeAmount.guard(todayPaymentPesewas, toMomo, { momo: true })) toMomo();
      return;
    }
    if (method !== "split") {
      setPaymentMethod(method);
      onUpdateParams?.({ paymentMethod: method });
      setError("");
      return;
    }
    if (!Number.isSafeInteger(todayPaymentPesewas) || todayPaymentPesewas <= 0) {
      setTodayPaymentSubmitAttempted(true);
      setError(t("credit.paymentTodayRequired"));
      return;
    }
    onNavigate("SplitPayment", {
      ...params,
      paymentMethod: "split",
      installmentSplit: true,
      splitTotalPesewas: todayPaymentPesewas,
      todayPaymentAmount: todayPaymentInput,
      installmentAmount,
      frequency,
      startToday: true,
      nextDueDate
    });
  }

  return (
    <PosPage className="flex flex-col gap-3">
      <h1 className="text-2xl font-extrabold">{t("credit.aLittleAtATime")}</h1>
      <CreditAmount amountPesewas={maxCreditPesewas} />
      <label className="block">
        <span className="mb-1 block text-lg font-extrabold">{t("credit.howMuchEachTime")}</span>
        <span className="flex min-h-16 items-center gap-2 rounded-2xl border-[3px] border-slate-500 px-4">
          <span className="shrink-0 text-lg font-bold text-slate-700">GH₵</span>
          <input
            type="number"
            min="0.01"
            max={maxInstallmentAmount}
            step="0.01"
            inputMode="decimal"
            autoComplete="off"
            aria-label={t("credit.howMuchEachTime")}
            value={installmentAmount}
            onChange={(event) => {
              const nextValue = event.target.value;
              const nextPesewas = toPesewas(nextValue);
              if (Number.isSafeInteger(nextPesewas) && nextPesewas > maxInstallmentPesewas) {
                setInstallmentAmount(maxInstallmentAmount);
                onUpdateParams?.({ installmentAmount: maxInstallmentAmount });
                setError(t("credit.installmentCapped"));
              } else {
                setInstallmentAmount(nextValue);
                onUpdateParams?.({ installmentAmount: nextValue });
                setError("");
              }
            }}
            aria-describedby="installment-amount-limit"
            placeholder="0.00"
            className="w-full min-w-0 bg-transparent text-right text-2xl font-extrabold outline-none placeholder:text-slate-400 sm:text-3xl"
          />
        </span>
        <span id="installment-amount-limit" className="mt-1 block text-sm font-semibold text-slate-700">
          {t("credit.installmentMaximum", { amount: formatGhs(maxInstallmentPesewas) })}
        </span>
      </label>
      <fieldset>
        <legend className="mb-1 text-lg font-extrabold">{t("credit.howOften")}</legend>
        <div className="grid grid-cols-3 gap-2">
          {PAYMENT_FREQUENCIES.map((option) => (
            <button key={option.value} type="button" aria-pressed={frequency === option.value} onClick={() => selectFrequency(option.value)} className={`min-h-14 rounded-2xl border-[3px] px-1 text-sm font-extrabold sm:text-base ${frequency === option.value ? "border-emerald-900 bg-green-200" : "border-slate-500 bg-white"}`}>
              {t(`credit.frequency.${option.value}`)}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1 text-lg font-extrabold">{t("credit.firstPayment")}</legend>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={paymentAlreadyMadeToday || alreadyPaidPesewas > 0}
            aria-pressed={startToday}
            onClick={() => {
              if (paymentAlreadyMadeToday || alreadyPaidPesewas > 0) return;
              setStartToday(true);
              setTodayPaymentSubmitAttempted(false);
              const nextDate = getNextCycleDate(today, frequency);
              setNextDueDate(nextDate);
              const draftUpdates = { startToday: true, nextDueDate: nextDate };
              if (installmentPesewas > maxStartTodayInstallmentPesewas) {
                const cappedAmount = (Math.max(0, maxStartTodayInstallmentPesewas) / 100).toFixed(2);
                setInstallmentAmount(cappedAmount);
                draftUpdates.installmentAmount = cappedAmount;
              }
              onUpdateParams?.(draftUpdates);
            }}
            className={`min-h-14 rounded-2xl border-[3px] font-extrabold ${paymentAlreadyMadeToday || alreadyPaidPesewas > 0 ? "cursor-not-allowed border-slate-300 bg-slate-100 text-slate-400 opacity-60" : startToday ? "border-emerald-900 bg-green-200" : "border-slate-500 bg-white"}`}
          >
            {t("credit.today")}
          </button>
          <button type="button" aria-pressed={!startToday} disabled={hasReceivedMomo} onClick={() => {
            // Received MoMo is locked: Next cycle would drop it, so it is not offered then.
            if (hasReceivedMomo) return;
            setStartToday(false);
            setTodayPaymentSubmitAttempted(false);
            const nextDate = getNextCycleDate(today, frequency);
            setNextDueDate(nextDate);
            const draftUpdates = { startToday: false, nextDueDate: nextDate };
            // Amount paid today counts as 0 on Next cycle: a payment recorded on 27 is discarded.
            if (!paymentAlreadyMadeToday && (params.firstPaymentParts !== undefined || params.splitParts !== undefined)) {
              setPaymentMethod("cash");
              Object.assign(draftUpdates, { firstPaymentParts: undefined, splitParts: undefined, splitTotalPesewas: undefined, paymentMethod: "cash" });
            }
            onUpdateParams?.(draftUpdates);
          }} className={`min-h-14 min-w-0 rounded-2xl border-[3px] px-1 text-[15px] leading-tight font-extrabold disabled:cursor-not-allowed disabled:opacity-60 ${!startToday ? "border-emerald-900 bg-green-200" : "border-slate-500 bg-white"}`}>{t("credit.nextCycle", { frequency: t(`credit.frequency.${frequency}`) })}</button>
        </div>
      </fieldset>
      {startToday && !paymentAlreadyMadeToday && (
        <label className="block">
          <span className="mb-1 block text-lg font-extrabold">{t("credit.amountPaidToday")}</span>
          <span className={`flex min-h-14 items-center gap-2 rounded-2xl border-[3px] px-4 ${todayPaymentSubmitAttempted && !validTodayPayment ? "border-rose-800" : "border-slate-500"}`}>
            <span className="shrink-0 text-lg font-bold text-slate-700">GH₵</span>
            <input
              type="number"
              min="0.01"
              max={(maxCreditPesewas / 100).toFixed(2)}
              step="0.01"
              inputMode="decimal"
              autoComplete="off"
              aria-label={t("credit.amountPaidToday")}
              aria-describedby="today-payment-limit"
              aria-invalid={todayPaymentSubmitAttempted && !validTodayPayment}
              value={todayPaymentInput}
              disabled={recordedParts.length > 0}
              onChange={(event) => {
                setTodayPaymentAmount(event.target.value);
                // Kept in the route params, so Menu > Settings > Back > Close menu restores it.
                onUpdateParams?.({ todayPaymentAmount: event.target.value });
                setTodayPaymentSubmitAttempted(true);
                setError("");
              }}
              placeholder="0.00"
              className="w-full min-w-0 bg-transparent text-right text-xl font-extrabold outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-70"
            />
          </span>
          <span id="today-payment-limit" className="mt-1 block text-sm font-semibold text-slate-700">
            {recordedParts.length > 0
              ? t("credit.paidTodayHint")
              : t("credit.paymentTodayMaximum", { amount: formatGhs(maxCreditPesewas) })}
          </span>
          {todayPaymentSubmitAttempted && !validTodayPayment && (
            <span role="alert" className="mt-1 block text-sm font-semibold text-rose-900">
              {todayPaymentPesewas > maxCreditPesewas
                ? t("credit.paymentTodayTooHigh", { amount: formatGhs(maxCreditPesewas) })
                : t("credit.paymentTodayRequired")}
            </span>
          )}
        </label>
      )}
      <label className="block">
        <span className="mb-1 block text-lg font-extrabold">{t("credit.nextPaymentDate")}</span>
        <input type="date" min={dayAfter(today)} value={nextDueDate} aria-invalid={!dateValid} onChange={(event) => { setNextDueDate(event.target.value); onUpdateParams?.({ nextDueDate: event.target.value }); }} className="h-14 w-full rounded-2xl border-[3px] border-slate-500 px-3 text-lg font-bold" />
        {!dateValid && <span role="alert" className="mt-1 block text-sm font-semibold text-rose-900">{t("credit.invalidDueDate")}</span>}
      </label>
      {startToday && !paymentAlreadyMadeToday && (
        <fieldset>
          <legend className="mb-1 text-base font-extrabold">{t("credit.firstPaymentMethod")}</legend>
          {recordedParts.length > 0 ? (
            <div className="rounded-2xl border-2 border-emerald-800 bg-emerald-50 p-3" aria-live="polite">
              <p className="mb-2 font-extrabold text-emerald-950">{t("credit.payingToday")}</p>
              <div className="flex flex-col gap-2">
                {paidOnly(recordedParts).map((part) => <RecordedPartRow key={`${part.paymentMethod}-${part.amountPesewas}`} part={part} />)}
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 border-t border-emerald-200 pt-2 font-extrabold text-emerald-950">
                <span>{t("credit.totalToday")}</span>
                <span>{formatGhs(getPaidPaymentPesewas(recordedParts))}</span>
              </div>
              <StillOwedRow amountPesewas={owedOf(recordedParts)} customerName={params.customer?.name} />
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {["cash", "momo", "split"].map((method) => (
                <button
                  key={method}
                  type="button"
                  aria-pressed={paymentMethod === method}
                  aria-label={method === "split" ? t("split.title") : undefined}
                  onClick={() => {
                    choosePaymentMethod(method);
                  }}
                  className={`min-h-12 rounded-xl border-2 px-1 text-sm font-bold ${paymentMethod === method ? "border-emerald-900 bg-green-100" : "border-slate-500 bg-white"}`}
                >
                  {method === "split"
                    ? <span className="flex items-center justify-center gap-1" aria-hidden="true">
                        <Banknote size={16} aria-hidden="true" />
                        <Plus size={12} strokeWidth={3} aria-hidden="true" />
                        <Smartphone size={16} aria-hidden="true" />
                      </span>
                    : t(`credit.method.${method}`)}
                </button>
              ))}
            </div>
          )}
        </fieldset>
      )}
      {paymentAlreadyMadeToday && paidTodayPesewas > 0 && splitParts.length > 0 && (
        <div className="rounded-2xl border-2 border-emerald-800 bg-emerald-50 p-3" aria-live="polite">
        <p className="mb-2 font-extrabold text-emerald-950">{t("credit.payingToday")}</p>
        <div className="flex flex-col gap-2">
          {paidOnly(splitParts).map((part) => (
            <div key={`${part.paymentMethod}-${part.amountPesewas}`} className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 font-bold">
              <span>{t(`credit.method.${part.paymentMethod}`)}</span>
              <span>{formatGhs(part.amountPesewas)}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 border-t border-emerald-200 pt-2 font-extrabold text-emerald-950">
          <span>{t("credit.totalToday")}</span>
          <span>{formatGhs(paidTodayPesewas)}</span>
        </div>
        <StillOwedRow amountPesewas={owedOf(splitParts)} customerName={params.customer?.name} />
        </div>
      )}
      {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
      <SaveAttemptNotice saveAttempt={saveAttempt} busy={saving} onTryAgain={() => void savePlan(true)} />
      <div className="mt-auto grid grid-cols-[auto_minmax(0,1fr)] gap-2">
        <PosBackButton onClick={onBack} className="h-14!" />
        <PosPrimaryButton type="button" disabled={saving || !planReady} className="h-14" onClick={() => void savePlan()}>{saving ? t("credit.saving") : t("credit.savePlan")}</PosPrimaryButton>
      </div>
      {largeAmount.dialog}
    </PosPage>
  );
}

function buildCreditReceiptLink(result, phone, shopName) {
  if (!isReceiptTemplatesEnabled() || !result?.saleTransaction) return null;
  try {
    return buildCollectionReceiptLink(phone, buildCreditSaleReceipt(result, shopName));
  } catch (receiptError) {
    console.error("Could not build the credit sale receipt.", receiptError);
    return null;
  }
}

function CreditSaved({ params, onHome, onNavigate, onSaveCustomerContact, shopName }) {
  const [contactEditorOpen, setContactEditorOpen] = useState(false);
  const result = params.creditResult;
  const savedCustomer = useLiveQuery(async () => {
    const customerId = result?.customerId ?? params.customer?.id;
    if (customerId) return db.customers.get(customerId);
    const customerName = result?.customerName ?? params.customer?.name ?? "";
    if (!customerName.trim()) return null;
    return db.customers.where("nameLower").equals(customerName.trim().toLowerCase()).first();
  }, [result?.customerId, params.customer?.id, result?.customerName, params.customer?.name], null);
  const [contact, setContact] = useState({
    customerId: result?.customerId ?? params.customer?.id,
    name: result?.customerName ?? params.customer?.name ?? "",
    phone: result?.phone ?? params.customer?.phone ?? "",
    ghanaCardNumber: params.customer?.ghanaCardNumber ?? ""
  });
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
  const phone = contact.phone;
  const customerName = result?.customerName ?? params.customer?.name ?? "";
  const shownName = displayName(customerName);
  const totalDebtPesewas = result?.totalDebtPesewas ?? 0;
  const whatsappLink = generateWhatsAppLink(phone, shownName, totalDebtPesewas, shopName);
  const receiptLink = buildCreditReceiptLink(result, phone, shopName);
  function openContactEditor(event) {
    event.preventDefault();
    setContactEditorOpen(true);
  }
  return (
    <PosPage className="flex flex-col gap-3">
      <div className="pt-2 text-center">
        <div className="mx-auto mb-3 grid h-24 w-24 place-items-center rounded-full bg-emerald-900 text-white"><Check size={56} aria-hidden="true" /></div>
        <h1 className="text-xl font-bold">{t("credit.saved")}</h1>
        <p className="min-w-0 text-2xl font-extrabold leading-tight sm:text-4xl">
          <span className="block [overflow-wrap:anywhere]">{shownName}</span>
          <span className="block text-xl sm:text-3xl">{t("credit.owesAmount", { amount: formatGhs(totalDebtPesewas) })}</span>
        </p>
        <p className="text-base text-slate-700 sm:text-lg">{t("credit.thisSale", { amount: formatGhs(result?.amountPesewas ?? params.amountPesewas ?? 0) })}</p>
      </div>
      <PosCard className="space-y-2">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 text-base sm:text-lg">
          <span className="min-w-0">{t("credit.before")}</span>
          <strong className="whitespace-nowrap text-right tabular-nums">{formatGhs(result?.previousDebtPesewas ?? 0)}</strong>
        </div>
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 text-base sm:text-lg">
          <span className="min-w-0">{t("credit.thisSale")}</span>
          <strong className="whitespace-nowrap text-right text-rose-900 tabular-nums">+ {formatGhs(result?.addedDebtPesewas ?? 0)}</strong>
        </div>
        <div className="flex min-w-0 items-start justify-between gap-3 text-base sm:text-lg">
          <span className="shrink-0">{t("credit.payBack")}</span>
          <strong className="min-w-0 text-right break-words">{params.payBackLabel ?? t("credit.notSet")}</strong>
        </div>
      </PosCard>
      {result?.initialPaymentPesewas > 0 && (
        <div className="rounded-2xl border-2 border-emerald-800 bg-emerald-50 p-3" aria-live="polite">
          <p className="mb-2 font-extrabold text-emerald-950">{t("credit.paymentRecorded")}</p>
          <div className="flex flex-col gap-2">
            {result.initialPaymentParts && result.initialPaymentParts.length > 0 ? (
              result.initialPaymentParts.map((part) => (
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
                  {result.saleTransaction?.payment_method === "momo"
                    ? <Smartphone size={18} aria-hidden="true" />
                    : <Banknote size={18} aria-hidden="true" />}
                  <span className="truncate">{t(`credit.method.${result.saleTransaction?.payment_method === "momo" ? "momo" : "cash"}`)}</span>
                </span>
                <span className="shrink-0 tabular-nums">{formatGhs(result.initialPaymentPesewas)}</span>
              </div>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-emerald-200 pt-2 font-extrabold text-emerald-950">
            <span>{t("credit.paymentRecordedTotal")}</span>
            <span className="tabular-nums">{formatGhs(result.initialPaymentPesewas)}</span>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {whatsappLink ? (
          <a href={whatsappLink} target="_blank" rel="noreferrer" className="flex min-h-14 min-w-0 items-center justify-center rounded-2xl border-2 border-emerald-900 px-3 text-center font-extrabold text-emerald-900">
            {t("credit.whatsapp", { name: shownName })}
          </a>
        ) : (
          <button type="button" onClick={openContactEditor} className="flex min-h-14 min-w-0 items-center justify-center rounded-2xl border-2 border-emerald-900 px-3 text-center font-extrabold text-emerald-900">
            {t("credit.whatsapp", { name: shownName })}
          </button>
        )}
        {receiptLink ? (
          <a href={receiptLink} target="_blank" rel="noopener noreferrer" className="flex min-h-14 min-w-0 items-center justify-center rounded-2xl border-2 border-emerald-900 px-3 text-center font-extrabold text-emerald-900">
            {t("collect.receiptShare")}
          </a>
        ) : (
          <button type="button" onClick={openContactEditor} className="flex min-h-14 min-w-0 items-center justify-center rounded-2xl border-2 border-emerald-900 px-3 text-center font-extrabold text-emerald-900">
            {t("collect.receiptShare")}
          </button>
        )}
      </div>
      {result?.debtId && <PosSecondaryButton type="button" className="w-full" onClick={() => onNavigate("DebtorDetail", { debtId: result.debtId, customerName })}>{t("credit.seeDetails", { name: shownName })}</PosSecondaryButton>}
      {!whatsappLink && <PosSecondaryButton type="button" className="w-full" onClick={() => setContactEditorOpen(true)}>{t("contact.add")}</PosSecondaryButton>}
      {whatsappLink && <PosSecondaryButton type="button" onClick={() => setContactEditorOpen(true)}>{t("collect.editContact")}</PosSecondaryButton>}
      <PosPrimaryButton type="button" onClick={onHome} className="mt-auto h-[68px] text-2xl">{t("credit.done")}</PosPrimaryButton>
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

export default function CreditScreens({ route, params, onBack, onNavigate, onUpdateParams, onReturnToSplit, onSaveCredit, onSaveCustomerContact, onHome, shopName }) {
  if (route === "WhoOwesYou") return <WhoOwesYou params={params} onBack={onBack} onNavigate={onNavigate} />;
  if (route === "NewPerson") return <NewPerson params={params} onBack={onBack} onNavigate={onNavigate} />;
  if (route === "WhenWillTheyPay") return <WhenWillTheyPay params={params} onBack={onBack} onNavigate={onNavigate} onReturnToSplit={onReturnToSplit} onSaveCredit={onSaveCredit} />;
  if (route === "ALittleAtATime") return <ALittleAtATime params={params} onBack={onBack} onNavigate={onNavigate} onUpdateParams={onUpdateParams} onReturnToSplit={onReturnToSplit} onSaveCredit={onSaveCredit} />;
  if (route === "CreditSaved") return <CreditSaved params={params} onHome={onHome} onNavigate={onNavigate} onSaveCustomerContact={onSaveCustomerContact} shopName={shopName} />;
  return null;
}
