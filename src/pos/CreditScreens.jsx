import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Banknote, Check, Plus, Smartphone, UserRoundPlus } from "lucide-react";
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
import { normalizeWhatsAppPhone } from "../utils/whatsapp.js";
import { getCreditAmountOwedPesewas } from "./creditAmount.js";
import { PosCard, PosPage, PosPrimaryButton, PosSecondaryButton, PosBackButton } from "./PosComponents.jsx";
import { shortSaveName } from "./saveLabel.js";
import { CopyReceiptButton, ReceiptFailedLine, ReceiptOfflineLine, SendReceiptButton, useReceiptActions } from "./ReceiptActions.jsx";
import { buildCreditSaleReceipt, isReceiptTemplatesEnabled } from "./receiptTemplates.js";
import { posText as t } from "./i18n.js";
import { isSaveOutcomeUnknown } from "../lib/saveAttempt.js";
import { useLargeAmountConfirm } from "./LargeAmountConfirm.jsx";
import SaveAttemptNotice from "./SaveAttemptNotice.jsx";
import StillOwedRow from "./StillOwedRow.jsx";
import { useSaveAttempt } from "./useSaveAttempt.js";
import { getCarriedPaymentParts, getMomoPickParams, getPaidPaymentPesewas } from "./paymentAmount.js";
import { useBackBlock } from "./browserBack.js";
import { useFormErrors } from "./formErrors.js";
import AmountTextInput from "./AmountTextInput.jsx";
import { confirmDirectMomoParts, describeSplitPart, isLockedMomoRow, isUnconfirmedDirectMomo } from "./splitTender.js";
import { CREDIT_REASON_MAX } from "../lib/creditReason.js";
import { loadRecentCreditReasons } from "../db/recentReasons.js";
import { getCreditReasonCase } from "./creditDraft.js";

function CreditAmount({ amountPesewas }) {
  return (
    <div className="amount-fit-container amount-fit-row flex items-center justify-between gap-3 rounded-2xl bg-rose-100 px-4 py-3 text-rose-950">
      <span className="text-lg font-bold">{t("credit.owed")}</span>
      <strong className="amount-fit text-right font-extrabold">{formatGhs(amountPesewas)}</strong>
    </div>
  );
}

// 34 in a sale (wiring "No amount field on 34"): one read-only row, label left, amount right, never
// wrapping. The amount is up to 28px; a longer amount gets a smaller font so it still fits the row:
// the box is the container, the label keeps about 10.5rem, and a bold amount character is about
// 0.62em wide (measured at 340px).
function OwesFromSale({ amountPesewas }) {
  const amountText = formatGhs(amountPesewas);
  return (
    <p data-owes-from-sale="" className="@container flex min-h-14 items-center justify-between gap-2 rounded-2xl bg-rose-100 px-3 py-2 text-slate-900">
      <span className="shrink-0 whitespace-nowrap text-base font-bold">{t("credit.owesFromThisSale")}</span>{" "}
      <strong
        className="min-w-0 overflow-hidden whitespace-nowrap font-extrabold leading-tight text-rose-900"
        style={{ "--amount-chars": String(amountText.length), fontSize: "clamp(0.75rem, calc((100cqi - 10.5rem) / (var(--amount-chars) * 0.62)), 1.75rem)" }}
      >
        {amountText}
      </strong>
    </p>
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

function WhoOwesYou({ params, onBack, onNavigate, onUpdateParams }) {
  const [customers, setCustomers] = useState([]);
  // draft_survives_trip_away: the search text and the chosen person are also kept in the route
  // params, so New person (34) or Next (18) and Back show them again.
  const [query, setQuery] = useState(params.customerSearch ?? "");
  const [selectedCustomer, setSelectedCustomer] = useState(params.selectedCustomer ?? params.customer ?? null);
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
      <SearchField value={query} onChange={(next) => { setQuery(next); onUpdateParams?.({ customerSearch: next }); }} />
      <h2 className="text-lg font-extrabold text-slate-800">{hasSearchText(query) ? t("credit.searchResults") : t("credit.topDebtors")}</h2>
      {loading ? <p role="status">{t("credit.loading")}</p> : (
        <div className="flex flex-col gap-2">
          {filteredCustomers.map((customer) => (
            <CustomerChoice
              key={customer.id || customer.nameLower}
              customer={customer}
              selected={selectedCustomer?.nameLower === customer.nameLower}
              onSelect={() => { setSelectedCustomer(customer); onUpdateParams?.({ selectedCustomer: customer }); }}
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

function NewPerson({ params, onBack, onNavigate, onUpdateParams }) {
  // Wiring 34 "No amount field on 34" (15 Nov 2026): no typed amount. In a sale the amount comes
  // from the sale and is shown read-only; in add debt (manualDebt) it is entered next on 53.
  const amountOwedPesewas = getCreditAmountOwedPesewas(params);
  // Wiring 34 "Draft survives Back" (12 Nov 2026): what is typed is also kept in the route params
  // (newPerson*), so Next > 18 > Back (or Back from 19 or 53) shows it again. The error box is local
  // state: it shows only after Next with a problem, never on a returning form.
  const [name, setName] = useState(params.newPersonName ?? "");
  const [phone, setPhone] = useState(params.newPersonPhone ?? "");
  const [ghanaCardNumber, setGhanaCardNumber] = useState(params.newPersonGhanaCard ?? "");
  // Someone who already owes under the name typed here: the debt is added to theirs (the writers
  // find it by name), so say so, and carry what they owe so 19 sizes the plan on the whole balance.
  const [existingDebtor, setExistingDebtor] = useState(null);
  const phoneInvalid = Boolean(phone.trim() && !normalizeWhatsAppPhone(phone));
  // Wiring 34 "Error on 34" and rules_global.form_errors: there is no amount field here, so the box
  // names only the name, phone or card; it shows after Next and goes as soon as that is fixed.
  const formErrors = useFormErrors([
    ["name", name.trim() ? "" : t("credit.nameRequired")],
    ["phone", phoneInvalid ? t("contact.invalidPhone") : ""],
    ["ghanaCard", isValidGhanaCardNumber(ghanaCardNumber) ? "" : t("credit.invalidGhanaCard")]
  ]);

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
    if (!formErrors.check()) return;
    // A sale always reaches 34 with its amount (Owe on 15 needs one); without it there is nothing to
    // owe and nothing the owner can fix here, so Next does nothing.
    if (!params.manualDebt && amountOwedPesewas <= 0) return;
    onNavigate(params.manualDebt ? "ManualDebtAmount" : "WhenWillTheyPay", {
      ...params,
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
        {!params.manualDebt && <OwesFromSale amountPesewas={amountOwedPesewas} />}
        <label className="block">
          <span className="mb-1 block font-extrabold">{t("credit.name")}</span>
          <input autoComplete="name" placeholder={t("credit.namePlaceholder")} value={name} onChange={(event) => { setName(event.target.value); onUpdateParams?.({ newPersonName: event.target.value }); }} className="h-14 w-full rounded-2xl border-[3px] border-slate-500 px-3 text-lg" />
          <span className="text-sm text-slate-700">{t("credit.nameHint")}</span>
          {existingDebtor && (
            <span role="status" className="mt-1 block rounded-xl border-2 border-amber-700 bg-amber-100 p-2 text-sm font-semibold text-amber-950">
              {t("credit.existingDebtor", { name: displayName(existingDebtor.name), amount: formatGhs(existingDebtor.totalDebtPesewas) })}
            </span>
          )}
        </label>
        <label className="block">
          <span className="mb-1 block font-extrabold">{t("credit.phone")}</span>
          <input type="tel" inputMode="tel" autoComplete="tel" placeholder={t("credit.phonePlaceholder")} value={phone} onChange={(event) => { setPhone(event.target.value); onUpdateParams?.({ newPersonPhone: event.target.value }); }} aria-invalid={phoneInvalid} aria-describedby="new-person-phone-hint" className={`h-14 w-full rounded-2xl border-[3px] px-3 text-lg ${phoneInvalid ? "border-rose-900" : "border-slate-500"}`} />
          <span id="new-person-phone-hint" className={`text-sm ${phoneInvalid ? "text-rose-900" : "text-slate-700"}`}>{phoneInvalid ? t("contact.invalidPhone") : t("credit.phoneHint")}</span>
        </label>
        <label className="block">
          <span className="mb-1 block font-extrabold">{t("credit.ghanaCard")}</span>
          <input autoCapitalize="characters" maxLength="15" placeholder={t("credit.ghanaCardPlaceholder")} value={ghanaCardNumber} onChange={(event) => { const formatted = formatGhanaCard(event.target.value); setGhanaCardNumber(formatted); onUpdateParams?.({ newPersonGhanaCard: formatted }); }} className="h-14 w-full rounded-2xl border-[3px] border-slate-500 px-3 text-lg" />
          <span className="text-sm text-slate-700">{t("credit.ghanaCardHint")}</span>
        </label>
        {formErrors.message && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{formErrors.message}</p>}
        <PosPrimaryButton type="submit" className="mt-auto">{t("credit.next")}</PosPrimaryButton>
      </form>
    </PosPage>
  );
}

function WhenWillTheyPay({ params, onBack, onNavigate, onUpdateParams, onReturnToSplit, onSaveCredit }) {
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
  // Wiring 18 "Reason on 18": a field for a keypad sale or split, the items or the 53 note read-only.
  const reasonCase = getCreditReasonCase(params);
  const [reason, setReason] = useState(typeof params.creditReason === "string" ? params.creditReason.slice(0, CREDIT_REASON_MAX) : "");
  const [recentReasons, setRecentReasons] = useState([]);
  const reasonParams = reasonCase.kind === "field" ? { creditReason: reason } : {};

  useEffect(() => {
    if (reasonCase.kind !== "field") return undefined;
    let active = true;
    loadRecentCreditReasons().then((reasons) => { if (active) setRecentReasons(reasons); }, (loadError) => {
      console.error("Could not load recent reasons.", loadError);
    });
    return () => { active = false; };
  }, [reasonCase.kind]);

  // Typing replaces the text; a chip fills it. Kept in the route params with the rest of the draft.
  function changeReason(value) {
    const next = value.slice(0, CREDIT_REASON_MAX);
    setReason(next);
    onUpdateParams?.({ creditReason: next });
  }

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
        ...reasonParams,
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

  // Wiring 18 "Reason on 18": the reason sits above the Pay by choices (60px). Wiring "Save button and
  // Back on 18" (final): Back is at the top beside the title (the title wraps beside it) and scrolls
  // with the content; Save alone stays pinned at the bottom (16px under it, no bottom bar here). The
  // page fills the shell's page area (rules_global.shell_height), so a page that fits ends exactly at
  // the bottom of the screen and a longer one scrolls inside the page area with Save stuck to it.
  return (
    <PosPage className="flex flex-col gap-3 overflow-visible! pb-4!">
      <div className="flex min-w-0 items-center gap-3">
        <PosBackButton onClick={onBack} />
        <h1 className="min-w-0 text-2xl font-extrabold leading-tight">{t("credit.whenPay", { name: customerName })}</h1>
      </div>
      {reasonCase.kind === "field" ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="credit-reason" className="-mb-0.5 text-[17px] font-extrabold text-slate-950">{t("credit.whatFor")}</label>
          <input
            id="credit-reason"
            maxLength={CREDIT_REASON_MAX}
            autoComplete="off"
            placeholder={t("credit.whatForPlaceholder")}
            value={reason}
            onChange={(event) => changeReason(event.target.value)}
            className="h-[52px] w-full min-w-0 rounded-[14px] border-2 border-slate-500 px-3 text-lg"
          />
          {recentReasons.length > 0 && (
            <div role="group" aria-label={t("credit.recentReasons")} data-recent-reasons="" className="flex flex-wrap gap-2">
              {recentReasons.map((recent) => (
                <button key={recent} type="button" data-reason-chip="" onClick={() => changeReason(recent)} className="h-10 max-w-full truncate rounded-full border-2 border-slate-500 bg-white px-3.5 text-base font-bold text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800">
                  {recent}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : reasonCase.text ? <ReasonForRow text={reasonCase.text} /> : null}
      {choices.map((choice) => (
        <button key={choice.value} type="button" aria-pressed={dueChoice === choice.value} onClick={() => { setDueChoice(choice.value); onUpdateParams?.({ creditDueChoice: choice.value }); }} className={`min-h-[60px] shrink-0 rounded-2xl border-[3px] px-4 text-xl font-extrabold ${dueChoice === choice.value ? "border-emerald-900 bg-green-200" : "border-slate-500 bg-white"}`}>
          {choice.label}
        </button>
      ))}
      <button type="button" onClick={() => onNavigate("ALittleAtATime", { ...params, ...reasonParams, creditDueChoice: dueChoice })} className="flex min-h-[60px] shrink-0 flex-col items-center justify-center rounded-2xl border-[3px] border-slate-500 px-4 text-lg font-extrabold leading-tight">
        {t("credit.aLittleAtATime")}
        <span className="text-sm font-semibold text-slate-700">{t("credit.installmentSubtitle")}</span>
      </button>
      {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
      <SaveAttemptNotice saveAttempt={saveAttempt} busy={saving} onTryAgain={() => void save(true)} />
      {/* Wiring "Save button and Back on 18" (final): Save is the only pinned element, full width, at
          least 56px: line 1 "Save" (800, 18px), line 2 "{Name} owes GH₵x" (600, 16px, one line); the
          name for screen readers stays "Save · {Name} owes GH₵x". */}
      <div data-bottom-row="" className="sticky bottom-0 z-10 -mx-4 mt-auto flex flex-col items-stretch bg-white px-4 pt-2 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <PosPrimaryButton type="button" disabled={saving} onClick={() => void save()} aria-label={saving ? undefined : t("credit.saveAmount", { name: shortSaveName(customerName), amount: formatGhs(totalAfterSalePesewas) })} data-save-18="" className="h-auto min-h-14 flex-col gap-0 px-3 py-1.5 leading-tight">
          {saving ? t("credit.saving") : (
            <>
              <span data-save-line="1" className="text-[18px] font-extrabold">{t("credit.saveWord")}</span>
              <span data-save-line="2" className="max-w-full whitespace-nowrap text-base font-semibold">{t("credit.saveDetail", { name: shortSaveName(customerName), amount: formatGhs(totalAfterSalePesewas) })}</span>
            </>
          )}
        </PosPrimaryButton>
      </div>
      {largeAmount.dialog}
    </PosPage>
  );
}

// Wiring 18 cases B and C, and 19: what the credit is for, read-only ("For" on the left).
function ReasonForRow({ text }) {
  return (
    <p data-credit-for="" className="flex min-w-0 items-baseline gap-3 rounded-2xl bg-slate-100 px-3 py-2.5 text-lg">
      <span className="shrink-0 font-extrabold text-slate-700">{t("signature.for")}</span>
      <span className="min-w-0 font-bold text-slate-950 [overflow-wrap:anywhere]">{text}</span>
    </p>
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
      <span data-paying-today-amount="" className="shrink-0 whitespace-nowrap tabular-nums">{formatGhs(part.amountPesewas)}</span>
    </div>
  );
}

// 19 "Owe in the draft panel" (12 Nov 2026): the rows above "Total today" are only the paid parts
// (Cash, MoMo) and add up to it. What is still owed is a separate pink row below the total
// (StillOwedRow, shared with 27).

const paidOnly = (parts) => parts.filter((part) => part.paymentMethod !== "owe");

function ALittleAtATime({ params, onBack, onNavigate, onUpdateParams, onReturnToSplit, onSaveCredit }) {
  const today = localDateString();
  const [installmentAmount, setInstallmentAmount] = useState(params.installmentAmount ?? "");
  const [frequency, setFrequency] = useState(params.frequency ?? "weekly");
  const carriedPaymentParts = getCarriedPaymentParts(params);
  const paidTodayPesewas = getPaidPaymentPesewas(carriedPaymentParts);
  // Wiring 18 split rule: 19 carries the reason and shows it as a read-only "For" row.
  const reasonOn19 = getCreditReasonCase(params).text;
  // In a split sale (flow=split) the payment today is taken on 16, so 19 hides its own
  // payment section and passes 16's parts through unchanged (K5, E2).
  const paymentAlreadyMadeToday = params.paymentAlreadyMadeToday === true ||
    params.flow === "split";
  const [startToday, setStartToday] = useState(paymentAlreadyMadeToday ? false : (params.startToday ?? false));
  const [nextDueDate, setNextDueDate] = useState(params.nextDueDate ?? getNextCycleDate(today, params.frequency ?? "weekly"));
  const [paymentMethod, setPaymentMethod] = useState(params.paymentMethod ?? "cash");
  const [todayPaymentAmount, setTodayPaymentAmount] = useState(params.todayPaymentAmount ?? null);
  const [todayPaymentTyped, setTodayPaymentTyped] = useState(false);
  const [installmentCapped, setInstallmentCapped] = useState(false);
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
  // Wiring 19 "Still owed row, all flows": the pink row is the customer's balance after this sale and
  // today's payment (what 31 shows as "owes"). With a payment already made on 16 the Owed figure at
  // the top is already net of it; a payment taken on 19 is taken off here.
  const stillOwedAfterTodayPesewas = Math.max(0, maxCreditPesewas -
    (paymentAlreadyMadeToday ? 0 : getPaidPaymentPesewas(recordedParts)));
  const validTodayPayment = Number.isSafeInteger(todayPaymentPesewas) &&
    todayPaymentPesewas > 0 &&
    todayPaymentPesewas <= maxCreditPesewas;
  // Wiring 19 (12 Nov 2026): the Paying today panel is also shown for a single method (Cash only or
  // MoMo only: one row) whenever Amount paid today is above zero and a method is chosen. Hidden for
  // Next cycle, for nothing paid today, and while a split is still to be entered on 27.
  const singlePreviewParts = startToday && !paymentAlreadyMadeToday && recordedParts.length === 0 &&
    validTodayPayment && (paymentMethod === "cash" || paymentMethod === "momo")
    // A MoMo row carries its method, so it shows the same status line as on the split panel
    // ("Customer sends · not confirmed yet").
    ? [{ paymentMethod, amountPesewas: todayPaymentPesewas, ...(paymentMethod === "momo" ? { momoMethod: params.momoMethod, verification: params.verification } : {}) }]
    : [];
  // Save plan stays disabled until the plan is valid (K5): an amount each time, a next
  // payment date from today on, and, when paying today on this screen, a valid amount.
  // The first payment date must be after today (brief 3.9 rule 2); the fixed date on 18 may be today.
  const dateValid = isValidDateString(nextDueDate) && nextDueDate > today;
  const planReady = Number.isSafeInteger(installmentPesewas) && installmentPesewas > 0 &&
    dateValid &&
    (!startToday || paymentAlreadyMadeToday || validTodayPayment);
  // rules_global.form_errors: Amount paid today is named under its field and the split check in the
  // box, only after Save plan (or Split) is tapped, and each goes as soon as it is fixed.
  const formErrors = useFormErrors([
    ["todayAmount", startToday && !validTodayPayment
      ? todayPaymentPesewas > maxCreditPesewas
        ? t("credit.paymentTodayTooHigh", { amount: formatGhs(maxCreditPesewas) })
        : t("credit.paymentTodayRequired")
      : ""],
    ["split", startToday && paymentMethod === "split" && splitParts.length === 0 ? t("credit.paymentSplitRequired") : ""]
  ]);
  // Save plan is grey while Amount paid today is wrong, so once something is typed the line under
  // the field also says why (as before); the Split tap shows it when nothing was typed.
  const todayAmountError = formErrors.field === "todayAmount"
    ? formErrors.message
    : todayPaymentTyped && startToday && !validTodayPayment
      ? (todayPaymentPesewas > maxCreditPesewas
        ? t("credit.paymentTodayTooHigh", { amount: formatGhs(maxCreditPesewas) })
        : t("credit.paymentTodayRequired"))
      : "";
  const boxError = (formErrors.field === "split" ? formErrors.message : "") || error;
  // Shown only while the field still holds the capped amount.
  const installmentCappedShown = installmentCapped && installmentAmount === maxInstallmentAmount;

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
    if (!formErrors.check()) return;
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
      // Named once, under Amount paid today (it was also repeated in the box below).
      formErrors.check(["todayAmount"]);
      return;
    }
    // Wiring 27: the parts kept after Back from 27 come back while Amount paid today is unchanged;
    // a changed amount clears them and 27 starts again with the new amount.
    const kept = params.installmentSplitDraft;
    const keptParts = kept?.totalPesewas === todayPaymentPesewas ? kept.splitParts : [];
    if (kept && !keptParts.length) onUpdateParams?.({ installmentSplitDraft: undefined });
    // 19's own MoMo pick (61 Direct) stays in the params with the amount it was picked at. 27 starts
    // from the amount paid today as it is now (the figure the Paying today panel shows): MoMo was
    // the chosen method, so it opens with MoMo for that amount. A pick left over from an earlier
    // amount, or from before Cash was chosen, is dropped, never sent to 27.
    const singleMomo = !keptParts.length && paymentMethod === "momo" && Boolean(params.momoMethod);
    onNavigate("SplitPayment", {
      ...params,
      paymentMethod: "split",
      installmentSplit: true,
      pendingMomoAmountPesewas: singleMomo ? todayPaymentPesewas : undefined,
      momoMethod: singleMomo ? params.momoMethod : undefined,
      verification: singleMomo ? params.verification : undefined,
      installmentSplitDraft: undefined,
      splitParts: keptParts,
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
      {/* Wiring 18 "Reason on 18": the reason carried from 18 (typed, the items or the 53 note), read-only; no row when empty. */}
      {reasonOn19 && <ReasonForRow text={reasonOn19} />}
      <label className="block">
        <span className="mb-1 block text-lg font-extrabold">{t("credit.howMuchEachTime")}</span>
        <span className="flex min-h-16 items-center gap-2 rounded-2xl border-[3px] border-slate-500 px-4">
          <span className="shrink-0 text-lg font-bold text-slate-700">GH₵</span>
          <AmountTextInput
            aria-label={t("credit.howMuchEachTime")}
            value={installmentAmount}
            onValue={(nextValue) => {
              const nextPesewas = toPesewas(nextValue);
              const capped = Number.isSafeInteger(nextPesewas) && nextPesewas > maxInstallmentPesewas;
              const shown = capped ? maxInstallmentAmount : nextValue;
              setInstallmentAmount(shown);
              onUpdateParams?.({ installmentAmount: shown });
              setInstallmentCapped(capped);
              setError("");
            }}
            aria-describedby="installment-amount-limit"
            placeholder="0.00"
            className="w-full min-w-0 bg-transparent text-2xl font-extrabold outline-none placeholder:text-slate-400 sm:text-3xl"
          />
        </span>
        <span id="installment-amount-limit" className="mt-1 block text-sm font-semibold text-slate-700">
          {t("credit.installmentMaximum", { amount: formatGhs(maxInstallmentPesewas) })}
        </span>
        {/* Decided 16 Nov 2026: the capped notice is live under the field (not in the box) and goes as
            soon as the amount is changed to one within the maximum. */}
        {installmentCappedShown && (
          <span role="status" data-installment-capped="" className="mt-1 block text-sm font-semibold text-rose-900">{t("credit.installmentCapped")}</span>
        )}
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
              setTodayPaymentTyped(false);
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
            setTodayPaymentTyped(false);
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
          <span className={`flex min-h-14 items-center gap-2 rounded-2xl border-[3px] px-4 ${todayAmountError ? "border-rose-800" : "border-slate-500"}`}>
            <span className="shrink-0 text-lg font-bold text-slate-700">GH₵</span>
            <AmountTextInput
              aria-label={t("credit.amountPaidToday")}
              aria-describedby="today-payment-limit"
              aria-invalid={Boolean(todayAmountError)}
              value={todayPaymentInput}
              disabled={recordedParts.length > 0}
              onValue={(value) => {
                setTodayPaymentAmount(value);
                // Kept in the route params, so Menu > Settings > Back > Close menu restores it.
                onUpdateParams?.({ todayPaymentAmount: value });
                setTodayPaymentTyped(true);
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
          {todayAmountError && (
            <span role="alert" className="mt-1 block text-sm font-semibold text-rose-900">{todayAmountError}</span>
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
            <div data-paying-today="" className="rounded-2xl border-2 border-emerald-800 bg-emerald-50 p-3" aria-live="polite">
              <p className="mb-2 font-extrabold text-emerald-950">{t("credit.payingToday")}</p>
              <div className="flex flex-col gap-2">
                {paidOnly(recordedParts).map((part) => <RecordedPartRow key={`${part.paymentMethod}-${part.amountPesewas}`} part={part} />)}
              </div>
              <div data-total-today="" className="mt-2 flex items-center justify-between gap-3 border-t border-emerald-200 px-3 pt-2 font-extrabold text-emerald-950">
                <span>{t("credit.totalToday")}</span>
                <span data-paying-today-amount="" className="shrink-0 whitespace-nowrap tabular-nums">{formatGhs(getPaidPaymentPesewas(recordedParts))}</span>
              </div>
              <StillOwedRow amountPesewas={stillOwedAfterTodayPesewas} customerName={params.customer?.name} />
            </div>
          ) : (
            <>
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
            {singlePreviewParts.length > 0 && (
              <div data-single-method-panel="" data-paying-today="" className="mt-3 rounded-2xl border-2 border-emerald-800 bg-emerald-50 p-3" aria-live="polite">
                <p className="mb-2 font-extrabold text-emerald-950">{t("credit.payingToday")}</p>
                <div className="flex flex-col gap-2">
                  {singlePreviewParts.map((part) => <RecordedPartRow key={part.paymentMethod} part={part} />)}
                </div>
                <div data-total-today="" className="mt-2 flex items-center justify-between gap-3 border-t border-emerald-200 px-3 pt-2 font-extrabold text-emerald-950">
                  <span>{t("credit.totalToday")}</span>
                  <span data-paying-today-amount="" className="shrink-0 whitespace-nowrap tabular-nums">{formatGhs(todayPaymentPesewas)}</span>
                </div>
                <StillOwedRow amountPesewas={Math.max(0, maxCreditPesewas - todayPaymentPesewas)} customerName={params.customer?.name} />
              </div>
            )}
            </>
          )}
        </fieldset>
      )}
      {paymentAlreadyMadeToday && paidTodayPesewas > 0 && splitParts.length > 0 && (
        <div data-paying-today="" className="rounded-2xl border-2 border-emerald-800 bg-emerald-50 p-3" aria-live="polite">
        <p className="mb-2 font-extrabold text-emerald-950">{t("credit.payingToday")}</p>
        <div className="flex flex-col gap-2">
          {paidOnly(splitParts).map((part) => (
            <div key={`${part.paymentMethod}-${part.amountPesewas}`} className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 font-bold">
              <span>{t(`credit.method.${part.paymentMethod}`)}</span>
              <span data-paying-today-amount="" className="shrink-0 whitespace-nowrap tabular-nums">{formatGhs(part.amountPesewas)}</span>
            </div>
          ))}
        </div>
        <div data-total-today="" className="mt-2 flex items-center justify-between gap-3 border-t border-emerald-200 px-3 pt-2 font-extrabold text-emerald-950">
          <span>{t("credit.totalToday")}</span>
          <span data-paying-today-amount="" className="shrink-0 whitespace-nowrap tabular-nums">{formatGhs(paidTodayPesewas)}</span>
        </div>
        <StillOwedRow amountPesewas={stillOwedAfterTodayPesewas} customerName={params.customer?.name} />
        </div>
      )}
      {boxError && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{boxError}</p>}
      <SaveAttemptNotice saveAttempt={saveAttempt} busy={saving} onTryAgain={() => void savePlan(true)} />
      <div className="mt-auto grid grid-cols-[auto_minmax(0,1fr)] gap-2">
        <PosBackButton onClick={onBack} className="h-14!" />
        <PosPrimaryButton type="button" disabled={saving || !planReady} className="h-14" onClick={() => void savePlan()}>{saving ? t("credit.saving") : t("credit.savePlan")}</PosPrimaryButton>
      </div>
      {largeAmount.dialog}
    </PosPage>
  );
}

// The credit sale receipt text, or null when the record cannot give one (31 still shows, saved).
function buildCreditReceiptText(result, shopName) {
  if (!isReceiptTemplatesEnabled() || !result?.saleTransaction) return null;
  try {
    return buildCreditSaleReceipt(result, shopName);
  } catch (receiptError) {
    console.error("Could not build the credit sale receipt.", receiptError);
    return null;
  }
}

// 31 (wiring "No reminder button on 31", 14 Nov 2026): no WhatsApp reminder and no contact
// buttons. Reminders live on 29/43, Home's Collect first tile and the Owed list; a number is added
// through Edit contact on 29/43. The saved number is still read so Send receipt opens that chat.
function CreditSaved({ params, onHome, onNavigate, shopName }) {
  const result = params.creditResult;
  const savedCustomer = useLiveQuery(async () => {
    const customerId = result?.customerId ?? params.customer?.id;
    if (customerId) return db.customers.get(customerId);
    const customerName = result?.customerName ?? params.customer?.name ?? "";
    if (!customerName.trim()) return null;
    return db.customers.where("nameLower").equals(customerName.trim().toLowerCase()).first();
  }, [result?.customerId, params.customer?.id, result?.customerName, params.customer?.name], null);
  const phone = savedCustomer?.phone ?? result?.phone ?? params.customer?.phone ?? "";
  const customerName = result?.customerName ?? params.customer?.name ?? "";
  const shownName = displayName(customerName);
  const totalDebtPesewas = result?.totalDebtPesewas ?? 0;
  // Send receipt and Copy receipt show only with VITE_ENABLE_POS_RECEIPTS on (FEATURE_FLAGS.SHOW_POS_RECEIPTS).
  const receiptsOn = isReceiptTemplatesEnabled();
  const receiptText = buildCreditReceiptText(result, shopName);
  const actions = useReceiptActions(receiptText ?? "", normalizeWhatsAppPhone(phone) ?? "");
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
            {result.initialPaymentParts && result.initialPaymentParts.some((part) => part.amountPesewas > 0) ? (
              result.initialPaymentParts.filter((part) => part.amountPesewas > 0).map((part) => (
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
          <div data-total-today="" className="mt-2 flex items-center justify-between gap-3 border-t border-emerald-200 px-3 pt-2 font-extrabold text-emerald-950">
            <span>{t("credit.paymentRecordedTotal")}</span>
            <span className="tabular-nums">{formatGhs(result.initialPaymentPesewas)}</span>
          </div>
        </div>
      )}
      {receiptsOn && receiptText && (
        <div className="flex flex-col gap-2">
          <SendReceiptButton onClick={() => void actions.send()} className="min-h-14 w-full" />
          <ReceiptOfflineLine online={actions.online} />
        </div>
      )}
      {receiptsOn && receiptText && <CopyReceiptButton onClick={() => void actions.copy()} copied={actions.copied} />}
      {receiptsOn && <ReceiptFailedLine failed={actions.failed} />}
      {result?.debtId && <PosSecondaryButton type="button" className="w-full" onClick={() => onNavigate("DebtorDetail", { debtId: result.debtId, customerName })}>{t("credit.seeDetails", { name: shownName })}</PosSecondaryButton>}
      <PosPrimaryButton type="button" onClick={onHome} className="mt-auto h-[68px] text-2xl">{t("credit.done")}</PosPrimaryButton>
    </PosPage>
  );
}

export default function CreditScreens({ route, params, onBack, onNavigate, onUpdateParams, onReturnToSplit, onSaveCredit, onHome, shopName }) {
  if (route === "WhoOwesYou") return <WhoOwesYou params={params} onBack={onBack} onNavigate={onNavigate} onUpdateParams={onUpdateParams} />;
  if (route === "NewPerson") return <NewPerson params={params} onBack={onBack} onNavigate={onNavigate} onUpdateParams={onUpdateParams} />;
  if (route === "WhenWillTheyPay") return <WhenWillTheyPay params={params} onBack={onBack} onNavigate={onNavigate} onUpdateParams={onUpdateParams} onReturnToSplit={onReturnToSplit} onSaveCredit={onSaveCredit} />;
  if (route === "ALittleAtATime") return <ALittleAtATime params={params} onBack={onBack} onNavigate={onNavigate} onUpdateParams={onUpdateParams} onReturnToSplit={onReturnToSplit} onSaveCredit={onSaveCredit} />;
  if (route === "CreditSaved") return <CreditSaved params={params} onHome={onHome} onNavigate={onNavigate} shopName={shopName} />;
  return null;
}
