import { useEffect, useMemo, useState } from "react";
import { Banknote, Check, Plus, Search, Smartphone, UserRoundPlus } from "lucide-react";
import { db } from "../db/db.js";
import { isValidGhanaCardNumber, normalizeGhanaCardNumber } from "../lib/ghanaCardNumber.js";
import { formatGhs, toPesewas } from "../lib/money.js";
import { formatGhanaCard } from "../utils/formatters.js";
import { addDueCycles, getCreditBalanceAfterSale, getMaximumInstallmentAmountPesewas, getNextCycleDate, isValidDateString, localDateString, PAYMENT_FREQUENCIES, prepareInstallmentPlan } from "../utils/installments.js";
import { generateWhatsAppLink, normalizeWhatsAppPhone } from "../utils/whatsapp.js";
import { getDefaultCollectionSplit } from "./collectionSplit.js";
import CustomerContactEditor from "./CustomerContactEditor.jsx";
import { PosCard, PosPage, PosPrimaryButton, PosSecondaryButton } from "./PosComponents.jsx";
import { posText as t } from "./i18n.js";

function amountInputValue(amountPesewas) {
  return (amountPesewas / 100).toFixed(2);
}

function CreditAmount({ amountPesewas }) {
  return (
    <div className="amount-fit-container flex items-center justify-between gap-3 rounded-2xl bg-rose-100 px-4 py-3 text-rose-950">
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
        {customer.name.charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 truncate text-lg font-extrabold">{customer.name}</span>
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
    const cleanQuery = query.trim().toLowerCase();
    const matches = cleanQuery
      ? customers.filter((customer) =>
        customer.name.toLowerCase().includes(cleanQuery) || (customer.phone ?? "").includes(cleanQuery)
      )
      : customers.filter((customer) => customer.totalDebtPesewas > 0).slice(0, 5);
    return matches;
  }, [customers, query]);

  function continueToPaymentDate() {
    if (!selectedCustomer) return;
    onNavigate("WhenWillTheyPay", { ...params, customer: selectedCustomer });
  }

  return (
    <PosPage className="flex flex-col gap-3">
      <h1 className="text-2xl font-extrabold">{t("credit.whoOwes")}</h1>
      <CreditAmount amountPesewas={params.amountPesewas ?? 0} />
      <label className="flex min-h-14 items-center gap-2 rounded-2xl border-[3px] border-slate-500 px-3">
        <Search size={24} aria-hidden="true" />
        <span className="sr-only">{t("credit.search")}</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("credit.search")}
          className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none"
        />
      </label>
      <h2 className="text-lg font-extrabold text-slate-800">{query ? t("credit.searchResults") : t("credit.topDebtors")}</h2>
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
          {!filteredCustomers.length && <p className="rounded-xl bg-slate-100 p-3">{query ? t("credit.noMatches") : t("credit.noDebtors")}</p>}
        </div>
      )}
      {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
      <PosSecondaryButton type="button" onClick={() => onNavigate("NewPerson", { ...params })}>
        <UserRoundPlus size={22} aria-hidden="true" /> {t("credit.newPerson")}
      </PosSecondaryButton>
      <div className="mt-auto grid grid-cols-2 gap-2">
        <PosSecondaryButton type="button" onClick={onBack}>{t("credit.back")}</PosSecondaryButton>
        <PosPrimaryButton type="button" disabled={!selectedCustomer || loading} onClick={continueToPaymentDate}>
          {t("credit.next")}
        </PosPrimaryButton>
      </div>
    </PosPage>
  );
}

function NewPerson({ params, onBack, onNavigate }) {
  const [amount, setAmount] = useState(amountInputValue(params.amountPesewas ?? 0));
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [ghanaCardNumber, setGhanaCardNumber] = useState("");
  const [error, setError] = useState("");
  const amountPesewas = toPesewas(amount);
  const phoneInvalid = Boolean(phone.trim() && !normalizeWhatsAppPhone(phone));

  function continueWithNewCustomer(event) {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName || !Number.isSafeInteger(amountPesewas) || amountPesewas <= 0) {
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
    onNavigate("WhenWillTheyPay", {
      ...params,
      amountPesewas,
      customer: {
        name: cleanName,
        nameLower: cleanName.toLowerCase(),
        phone: phone.trim(),
        ghanaCardNumber: normalizeGhanaCardNumber(ghanaCardNumber)
      },
      isNewCustomer: true
    });
  }

  return (
    <PosPage className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <PosSecondaryButton type="button" onClick={onBack} className="min-h-12 px-3">{t("credit.back")}</PosSecondaryButton>
        <h1 className="text-2xl font-extrabold">{t("credit.newPerson")}</h1>
      </div>
      <form onSubmit={continueWithNewCustomer} className="flex flex-1 flex-col gap-3">
        <label className="block">
          <span className="mb-1 block font-extrabold">{t("credit.amountOwed")}</span>
          <input type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className="h-14 w-full rounded-2xl border-[3px] border-rose-900 bg-rose-100 px-4 text-2xl font-extrabold text-rose-950" />
          <span className="text-sm text-slate-700">{t("credit.fromThisSale")}</span>
        </label>
        <label className="block">
          <span className="mb-1 block font-extrabold">{t("credit.name")}</span>
          <input autoComplete="name" placeholder={t("credit.namePlaceholder")} value={name} onChange={(event) => setName(event.target.value)} className="h-14 w-full rounded-2xl border-[3px] border-slate-500 px-3 text-lg" />
          <span className="text-sm text-slate-700">{t("credit.nameHint")}</span>
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

function WhenWillTheyPay({ params, onBack, onNavigate, onSaveCredit }) {
  const [dueChoice, setDueChoice] = useState(params.creditDueChoice ?? "week");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const customerName = params.customer?.name ?? "";
  const choices = [
    { value: "today", label: t("credit.today") },
    { value: "week", label: t("credit.inOneWeek") },
    { value: "twoWeeks", label: t("credit.inTwoWeeks") }
  ];
  const totalAfterSalePesewas = (params.customer?.totalDebtPesewas ?? 0) + (params.amountPesewas ?? 0);

  async function save() {
    setSaving(true);
    setError("");
    try {
      const days = { today: 0, week: 7, twoWeeks: 14 }[dueChoice];
      await onSaveCredit({
        ...params,
        dueDate: addDueCycles(localDateString(), "weekly", days / 7),
        payBackLabel: choices.find((choice) => choice.value === dueChoice)?.label ?? t("credit.inOneWeek")
      });
    } catch (saveError) {
      console.error("Could not save this credit sale.", saveError);
      setError(t("credit.saveFailed"));
    } finally {
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
      <div className="mt-auto grid grid-cols-2 gap-2">
        <PosSecondaryButton type="button" onClick={onBack}>{t("credit.back")}</PosSecondaryButton>
        <PosPrimaryButton type="button" disabled={saving} onClick={() => void save()}>{saving ? t("credit.saving") : t("credit.saveAmount", { name: customerName, amount: formatGhs(totalAfterSalePesewas) })}</PosPrimaryButton>
      </div>
    </PosPage>
  );
}

function ALittleAtATime({ params, onBack, onSaveCredit }) {
  const today = localDateString();
  const [installmentAmount, setInstallmentAmount] = useState("");
  const [frequency, setFrequency] = useState("weekly");
  const [startToday, setStartToday] = useState(false);
  const [nextDueDate, setNextDueDate] = useState(getNextCycleDate(today, "weekly"));
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [todayPaymentAmount, setTodayPaymentAmount] = useState(null);
  const [splitCashAmount, setSplitCashAmount] = useState("");
  const [splitSubmitAttempted, setSplitSubmitAttempted] = useState(false);
  const [todayPaymentSubmitAttempted, setTodayPaymentSubmitAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const installmentPesewas = toPesewas(installmentAmount);
  const amountPesewas = params.amountPesewas ?? 0;
  const currentDebtPesewas = params.customer?.totalDebtPesewas ?? 0;
  const alreadyPaidPesewas = Number.isSafeInteger(params.initialPaymentPesewas) && params.initialPaymentPesewas > 0
    ? params.initialPaymentPesewas
    : 0;
  const creditBalanceBeforeTodayPayment = getCreditBalanceAfterSale(currentDebtPesewas, amountPesewas);
  const maxCreditPesewas = Math.max(0, creditBalanceBeforeTodayPayment - alreadyPaidPesewas);
  const maxStartTodayInstallmentPesewas = getMaximumInstallmentAmountPesewas(
    currentDebtPesewas,
    amountPesewas,
    true
  );
  const maxInstallmentPesewas = getMaximumInstallmentAmountPesewas(
    currentDebtPesewas,
    amountPesewas,
    startToday
  );
  const maxInstallmentAmount = (maxInstallmentPesewas / 100).toFixed(2);
  const todayPaymentInput = todayPaymentAmount ?? installmentAmount;
  const todayPaymentPesewas = toPesewas(todayPaymentInput);
  const splitCashPesewas = toPesewas(splitCashAmount);
  const splitParts = Number.isSafeInteger(todayPaymentPesewas) && todayPaymentPesewas > 1
    ? getDefaultCollectionSplit(todayPaymentPesewas, splitCashPesewas)
    : [];
  const splitValid = paymentMethod !== "split" || splitParts.length === 2;
  const splitError = splitCashPesewas >= todayPaymentPesewas
    ? t("credit.splitCashTooHigh", { amount: Number.isSafeInteger(todayPaymentPesewas) ? formatGhs(todayPaymentPesewas) : "0.00" })
    : t("credit.splitCashRequired");
  const showSplitError = paymentMethod === "split" && !splitValid &&
    (splitCashAmount.trim() !== "" || splitSubmitAttempted);
  const validTodayPayment = Number.isSafeInteger(todayPaymentPesewas) &&
    todayPaymentPesewas > 0 &&
    todayPaymentPesewas <= maxCreditPesewas;

  function selectFrequency(nextFrequency) {
    setFrequency(nextFrequency);
    setNextDueDate(getNextCycleDate(today, nextFrequency));
  }

  async function savePlan() {
    if (startToday && !validTodayPayment) {
      setTodayPaymentSubmitAttempted(true);
      return;
    }
    if (startToday && paymentMethod === "split" && !splitValid) {
      setSplitSubmitAttempted(true);
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (!isValidDateString(nextDueDate) || nextDueDate < today) {
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
        ? t("credit.firstPaymentTodayNext", { date: nextDueDate })
        : t("credit.firstPaymentOn", { date: nextDueDate });
      const initialPaymentParts = startToday && paymentMethod === "split"
        ? [...(params.initialPaymentParts ?? []), ...splitParts]
        : startToday && prepared.initialPaymentPesewas > 0
          ? [...(params.initialPaymentParts ?? []), { paymentMethod, amountPesewas: prepared.initialPaymentPesewas }]
          : (params.initialPaymentParts ?? []);
      await onSaveCredit({
        ...params,
        dueDate: "",
        installmentPlan: plan,
        initialPaymentPesewas: alreadyPaidPesewas + prepared.initialPaymentPesewas,
        initialPaymentParts,
        paymentMethod: paymentMethod === "momo" ? "momo" : "cash",
        payBackLabel
      });
    } catch (saveError) {
      console.error("Could not save this installment plan.", saveError);
      setError(saveError?.message === "Choose a valid next installment due date."
        ? t("credit.invalidDueDate")
        : t("credit.invalidInstallment"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PosPage className="flex flex-col gap-3">
      <h1 className="text-2xl font-extrabold">{t("credit.aLittleAtATime")}</h1>
      <CreditAmount amountPesewas={maxCreditPesewas} />
      <label className="block">
        <span className="mb-1 block text-lg font-extrabold">{t("credit.howMuchEachTime")}</span>
        <span className="flex min-h-16 items-center gap-2 rounded-2xl border-[3px] border-slate-500 px-4">
          <span className="shrink-0 text-lg font-bold text-slate-700">GHS</span>
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
                setError(t("credit.installmentCapped"));
              } else {
                setInstallmentAmount(nextValue);
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
          <button type="button" aria-pressed={startToday} onClick={() => {
            setStartToday(true);
            setTodayPaymentSubmitAttempted(false);
            setNextDueDate(getNextCycleDate(today, frequency));
            if (installmentPesewas > maxStartTodayInstallmentPesewas) {
              setInstallmentAmount((Math.max(0, maxStartTodayInstallmentPesewas) / 100).toFixed(2));
            }
          }} className={`min-h-14 rounded-2xl border-[3px] font-extrabold ${startToday ? "border-emerald-900 bg-green-200" : "border-slate-500 bg-white"}`}>{t("credit.today")}</button>
          <button type="button" aria-pressed={!startToday} onClick={() => {
            setStartToday(false);
            setTodayPaymentSubmitAttempted(false);
            setNextDueDate(getNextCycleDate(today, frequency));
          }} className={`min-h-14 rounded-2xl border-[3px] font-extrabold ${!startToday ? "border-emerald-900 bg-green-200" : "border-slate-500 bg-white"}`}>{t("credit.nextCycle", { frequency: t(`credit.frequency.${frequency}`) })}</button>
        </div>
      </fieldset>
      {startToday && (
        <label className="block">
          <span className="mb-1 block text-lg font-extrabold">{t("credit.amountPaidToday")}</span>
          <span className={`flex min-h-14 items-center gap-2 rounded-2xl border-[3px] px-4 ${todayPaymentSubmitAttempted && !validTodayPayment ? "border-rose-800" : "border-slate-500"}`}>
            <span className="shrink-0 text-lg font-bold text-slate-700">GHS</span>
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
              onChange={(event) => {
                setTodayPaymentAmount(event.target.value);
                setTodayPaymentSubmitAttempted(true);
                setError("");
              }}
              placeholder="0.00"
              className="w-full min-w-0 bg-transparent text-right text-xl font-extrabold outline-none placeholder:text-slate-400"
            />
          </span>
          <span id="today-payment-limit" className="mt-1 block text-sm font-semibold text-slate-700">
            {t("credit.paymentTodayMaximum", { amount: formatGhs(maxCreditPesewas) })}
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
        <input type="date" min={today} value={nextDueDate} onChange={(event) => setNextDueDate(event.target.value)} className="h-14 w-full rounded-2xl border-[3px] border-slate-500 px-3 text-lg font-bold" />
      </label>
      {startToday && (
        <fieldset>
          <legend className="mb-1 text-base font-extrabold">{t("credit.firstPaymentMethod")}</legend>
          <div className="grid grid-cols-3 gap-2">
            {["cash", "momo", "split"].map((method) => (
              <button
                key={method}
                type="button"
                aria-pressed={paymentMethod === method}
                aria-label={method === "split" ? t("credit.method.both") : undefined}
                onClick={() => {
                  setPaymentMethod(method);
                  setError("");
                  setSplitSubmitAttempted(false);
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
          {paymentMethod === "split" && (
            <div className="mt-3 space-y-2">
              <label className="block">
                <span className="mb-1 block text-sm font-bold">{t("credit.splitCashAmount")}</span>
                <span className="flex h-12 items-center gap-2 rounded-xl border-2 border-slate-500 px-3">
                  <span className="shrink-0 font-bold text-slate-700">GHS</span>
                  <input
                    type="number"
                    min="0.01"
                    max={todayPaymentInput}
                    step="0.01"
                    inputMode="decimal"
                    value={splitCashAmount}
                    placeholder="0.00"
                    onChange={(event) => {
                      setSplitCashAmount(event.target.value);
                      setError("");
                    }}
                    className="w-full min-w-0 bg-transparent text-right text-lg font-bold outline-none placeholder:text-slate-400"
                  />
                </span>
              </label>
              <p className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold" aria-live="polite">
                {t("collect.paymentSplit", {
                  cash: formatGhs(splitCashPesewas ?? 0),
                  momo: formatGhs(Math.max(0, (todayPaymentPesewas ?? 0) - (splitCashPesewas ?? 0)))
                })}
              </p>
              {showSplitError && <p role="alert" className="text-sm font-semibold text-rose-900">{splitError}</p>}
            </div>
          )}
        </fieldset>
      )}
      {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
      <div className="mt-auto grid grid-cols-2 gap-2">
        <PosSecondaryButton type="button" onClick={onBack}>{t("credit.back")}</PosSecondaryButton>
        <PosPrimaryButton type="button" disabled={saving || !Number.isSafeInteger(installmentPesewas) || installmentPesewas <= 0} onClick={() => void savePlan()}>{saving ? t("credit.saving") : t("credit.savePlan")}</PosPrimaryButton>
      </div>
    </PosPage>
  );
}

function CreditSaved({ params, onHome, onNavigate, onSaveCustomerContact, shopName }) {
  const [contactEditorOpen, setContactEditorOpen] = useState(false);
  const result = params.creditResult;
  const [contact, setContact] = useState({
    customerId: result?.customerId ?? params.customer?.id,
    name: result?.customerName ?? params.customer?.name ?? "",
    phone: result?.phone ?? params.customer?.phone ?? "",
    ghanaCardNumber: params.customer?.ghanaCardNumber ?? ""
  });
  const phone = contact.phone;
  const customerName = result?.customerName ?? params.customer?.name ?? "";
  const totalDebtPesewas = result?.totalDebtPesewas ?? 0;
  const whatsappLink = generateWhatsAppLink(phone, customerName, totalDebtPesewas / 100, shopName);

  return (
    <PosPage className="flex flex-col gap-3">
      <div className="pt-2 text-center">
        <div className="mx-auto mb-3 grid h-24 w-24 place-items-center rounded-full bg-emerald-900 text-white"><Check size={56} aria-hidden="true" /></div>
        <h1 className="text-xl font-bold">{t("credit.saved")}</h1>
        <p className="min-w-0 text-2xl font-extrabold leading-tight sm:text-4xl">
          <span className="block [overflow-wrap:anywhere]">{customerName}</span>
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
        <div className="grid min-w-0 grid-cols-1 gap-1 text-base sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-x-3 sm:text-lg">
          <span>{t("credit.payBack")}</span>
          <strong className="min-w-0 break-words sm:text-right">{params.payBackLabel ?? t("credit.notSet")}</strong>
        </div>
        {result?.initialPaymentPesewas > 0 && (
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 text-base sm:text-lg">
            <span className="min-w-0">{t("credit.paidToday")}</span>
            <strong className="whitespace-nowrap text-right tabular-nums">{formatGhs(result.initialPaymentPesewas)}</strong>
            {result.initialPaymentParts?.length > 1 && (
              <span className="col-span-2 text-sm text-slate-700">
                {result.initialPaymentParts.map((part) =>
                  `${t(`credit.method.${part.paymentMethod}`)} ${formatGhs(part.amountPesewas)}`
                ).join(" · ")}
              </span>
            )}
          </div>
        )}
      </PosCard>
      <div className="grid grid-cols-2 gap-2">
        {whatsappLink && <a href={whatsappLink} target="_blank" rel="noreferrer" className="flex min-h-14 min-w-0 items-center justify-center rounded-2xl border-2 border-emerald-900 px-2 text-center font-extrabold text-emerald-900 [overflow-wrap:anywhere]">{t("credit.whatsapp", { name: customerName })}</a>}
        {result?.debtId && <PosSecondaryButton type="button" className="min-w-0 [overflow-wrap:anywhere]" onClick={() => onNavigate("DebtorDetail", { debtId: result.debtId, customerName })}>{t("credit.seeDetails", { name: customerName })}</PosSecondaryButton>}
        {!whatsappLink && <PosSecondaryButton type="button" className="min-w-0" onClick={() => setContactEditorOpen(true)}>{t("contact.add")}</PosSecondaryButton>}
      </div>
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

export default function CreditScreens({ route, params, onBack, onNavigate, onSaveCredit, onHome, shopName }) {
  if (route === "WhoOwesYou") return <WhoOwesYou params={params} onBack={onBack} onNavigate={onNavigate} />;
  if (route === "NewPerson") return <NewPerson params={params} onBack={onBack} onNavigate={onNavigate} />;
  if (route === "WhenWillTheyPay") return <WhenWillTheyPay params={params} onBack={onBack} onNavigate={onNavigate} onSaveCredit={onSaveCredit} />;
  if (route === "ALittleAtATime") return <ALittleAtATime params={params} onBack={onBack} onSaveCredit={onSaveCredit} />;
  if (route === "CreditSaved") return <CreditSaved params={params} onHome={onHome} onNavigate={onNavigate} shopName={shopName} />;
  return null;
}
