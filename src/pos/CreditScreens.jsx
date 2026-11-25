import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Banknote, Smartphone } from "lucide-react";
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
import { AddButton, ChoiceChip, TickBadge, PosCard, PosPage, PosPrimaryButton, PosSecondaryButton, PosBackButton, SplitIcons, useTaskColumn, WIDE_TASK_COLUMN_WIDTH_PX } from "./PosComponents.jsx";
import { SOFT_TILE } from "./softTile.js";
import { shortSaveName } from "./saveLabel.js";
import SavedCreditReceiptActions, { useSavedCreditPhone } from "./SavedCreditReceiptActions.jsx";
import { buildCreditSaleReceipt, isReceiptTemplatesEnabled } from "./receiptTemplates.js";
import { posText as t } from "./i18n.js";
import { isSaveOutcomeUnknown } from "../lib/saveAttempt.js";
import { useLargeAmountConfirm } from "./LargeAmountConfirm.jsx";
import SaveAttemptNotice from "./SaveAttemptNotice.jsx";
import SavedCreditSummary from "./SavedCreditSummary.jsx";
import StillOwedRow from "./StillOwedRow.jsx";
import { useSaveAttempt } from "./useSaveAttempt.js";
import { getCarriedPaymentParts, getMomoPickParams, getPaidPaymentPesewas } from "./paymentAmount.js";
import { useBackBlock } from "./browserBack.js";
import { useFormErrors } from "./formErrors.js";
import AmountTextInput from "./AmountTextInput.jsx";
import { confirmDirectMomoParts, describeSplitPart, isLockedMomoRow, isUnconfirmedDirectMomo } from "./splitTender.js";
import { CREDIT_REASON_MAX, reasonChipSelected, toggleReasonChip } from "../lib/creditReason.js";
import { findDuplicatePerson, loadKnownCustomers } from "./duplicatePerson.js";
import DuplicatePersonQuestion from "./DuplicatePersonQuestion.jsx";
import DateField from "./DateField.jsx";
import { tidyPersonName } from "../lib/personName.js";
import { loadRecentCreditReasons } from "../db/recentReasons.js";
import { getCreditReasonCase } from "./creditDraft.js";

function CreditAmount({ amountPesewas, wide = false }) {
  // Wide D10 (19): the soft tile (rules_global.soft_tiles), label above a 40px bold neutral amount that
  // shrinks to fit a long figure instead of clipping. The phone (phone sweep, 24 Nov 2026): one soft tile
  // row, label left, amount right, neutral dark, no pink.
  if (wide) {
    return (
      <section data-owed-tile="" className={`amount-fit-container min-w-0 ${SOFT_TILE} px-4 py-3`}>
        <p className="text-[17px] font-bold text-slate-600">{t("credit.owed")}</p>
        <p className="amount-fit font-bold tabular-nums text-[#0F172A]" style={{ fontSize: "min(40px, 11cqi)" }}>{formatGhs(amountPesewas)}</p>
      </section>
    );
  }
  return (
    <div data-owed-tile="" className={`amount-fit-container amount-fit-row flex items-center justify-between gap-3 ${SOFT_TILE} px-4 py-3 text-[#0F172A]`}>
      <span className="text-lg font-bold">{t("credit.owed")}</span>
      <strong className="amount-fit text-right font-extrabold">{formatGhs(amountPesewas)}</strong>
    </div>
  );
}

// 34 in a sale (wiring "No amount field on 34"): one read-only row, label left, amount right, never
// wrapping. The amount is up to 28px; a longer amount gets a smaller font so it still fits the row:
// the box is the container, the label keeps about 10.5rem, and a bold amount character is about
// 0.62em wide (measured at 340px). Soft tile (phone sweep, 24 Nov 2026): #F1F5F9, neutral dark amount.
function OwesFromSale({ amountPesewas }) {
  const amountText = formatGhs(amountPesewas);
  return (
    <p data-owes-from-sale="" className={`@container flex min-h-14 items-center justify-between gap-2 ${SOFT_TILE} px-3 py-2 text-[#0F172A]`}>
      <span className="shrink-0 whitespace-nowrap text-base font-bold">{t("credit.owesFromThisSale")}</span>{" "}
      <strong
        className="min-w-0 overflow-hidden whitespace-nowrap font-extrabold leading-tight text-[#0F172A]"
        style={{ "--amount-chars": String(amountText.length), fontSize: "clamp(0.75rem, calc((100cqi - 10.5rem) / (var(--amount-chars) * 0.62)), 1.75rem)" }}
      >
        {amountText}
      </strong>
    </p>
  );
}

function CustomerChoice({ customer, selected, onSelect }) {
  // Wide task column (design principles): the amount is 17px, bold 700, neutral #0F172A, on one line;
  // the 640px panel has room, so it is not squeezed into a 96px fit box. The phone keeps its look.
  const wide = Boolean(useTaskColumn());
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
      {customer.totalDebtPesewas > 0 && (wide ? (
        <span data-person-amount="" className="shrink-0 whitespace-nowrap text-right text-[17px] font-bold tabular-nums text-[#0F172A]">{formatGhs(customer.totalDebtPesewas)}</span>
      ) : (
        <span className="amount-fit-container w-24 shrink-0 text-right font-extrabold text-[#0F172A]">
          <span className="amount-fit">{formatGhs(customer.totalDebtPesewas)}</span>
        </span>
      ))}
      {selected && <TickBadge />}
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
      {/* rules_global.button_system.open_text_sweep: "+ New person" is the add look on every path. */}
      <AddButton onClick={() => onNavigate("NewPerson", { ...params })}>{t("credit.newPerson")}</AddButton>
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
  // rules_global.duplicate_person: someone already known by this name or phone (owing 0 too) is asked
  // about under the field: Use this person (goes on as if picked on 17, so 19 sizes the plan on the whole
  // balance) or Save as a new person. Next waits for that answer. A phone match saved as new is a
  // different name, so a new person; a name match must be renamed (the writers keep people by name).
  const [duplicate, setDuplicate] = useState(null);
  const [keptAsNew, setKeptAsNew] = useState("");
  const useThisPerson = useRef(null);
  const nameInput = useRef(null);
  const duplicateKey = duplicate ? `${duplicate.by}:${duplicate.person.id || duplicate.person.name}` : "";
  const renaming = Boolean(duplicate && keptAsNew === duplicateKey && duplicate.by === "name");
  const unresolved = Boolean(duplicate && keptAsNew !== duplicateKey) || renaming;
  const phoneInvalid = Boolean(phone.trim() && !normalizeWhatsAppPhone(phone));
  // Wiring 34 "Error on 34" and rules_global.form_errors: there is no amount field here, so the box
  // names only the name, phone or card; it shows after Next and goes as soon as that is fixed.
  const formErrors = useFormErrors([
    ["name", name.trim() ? "" : t("credit.nameRequired")],
    ["phone", phoneInvalid ? t("contact.invalidPhone") : ""],
    ["ghanaCard", isValidGhanaCardNumber(ghanaCardNumber) ? "" : t("credit.invalidGhanaCard")]
  ]);

  useEffect(() => {
    if (!name.trim() && !phone.trim()) {
      setDuplicate(null);
      return undefined;
    }
    let active = true;
    loadKnownCustomers().then((people) => {
      if (active) setDuplicate(findDuplicatePerson(people, { name, phone }));
    }).catch((lookupError) => {
      console.error("Could not check whether this person already exists.", lookupError);
      if (active) setDuplicate(null);
    });
    return () => { active = false; };
  }, [name, phone]);

  function goOn(customer, extra = {}) {
    onNavigate(params.manualDebt ? "ManualDebtAmount" : "WhenWillTheyPay", { ...params, customer, ...extra });
  }

  function continueWithNewCustomer(event) {
    event.preventDefault();
    // rules_global.form_fields: the name is saved tidied, a capital first letter per word.
    const cleanName = tidyPersonName(name);
    if (!formErrors.check()) return;
    // A sale always reaches 34 with its amount (Owe on 15 needs one); without it there is nothing to
    // owe and nothing the owner can fix here, so Next does nothing.
    if (!params.manualDebt && amountOwedPesewas <= 0) return;
    if (unresolved) {
      (renaming ? nameInput : useThisPerson).current?.focus();
      return;
    }
    goOn({
      name: cleanName,
      nameLower: cleanName.toLowerCase(),
      phone: phone.trim(),
      ghanaCardNumber: normalizeGhanaCardNumber(ghanaCardNumber)
    }, { isNewCustomer: true });
  }

  function saveAsNew() {
    setKeptAsNew(duplicateKey);
    if (duplicate?.by === "name") setTimeout(() => nameInput.current?.focus(), 0);
  }

  const question = unresolved ? (
    <DuplicatePersonQuestion match={duplicate} renaming={renaming} buttonRef={useThisPerson} onUse={() => goOn(duplicate.person)} onNew={saveAsNew} />
  ) : null;

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
          <input ref={nameInput} data-person-name="" autoComplete="off" autoCapitalize="words" data-example-placeholder="" placeholder={t("credit.namePlaceholder")} value={name} onChange={(event) => { setName(event.target.value); onUpdateParams?.({ newPersonName: event.target.value }); }} className="h-14 w-full rounded-2xl border-[3px] border-slate-500 px-3 text-lg" />
          <span className="text-sm text-slate-700">{t("credit.nameHint")}</span>
        </label>
        {duplicate?.by === "name" && question}
        <label className="block">
          <span className="mb-1 block font-extrabold">{t("credit.phone")}</span>
          <input type="tel" inputMode="tel" autoComplete="off" data-example-placeholder="" placeholder={t("credit.phonePlaceholder")} value={phone} onChange={(event) => { setPhone(event.target.value); onUpdateParams?.({ newPersonPhone: event.target.value }); }} aria-invalid={phoneInvalid} aria-describedby="new-person-phone-hint" className={`h-14 w-full rounded-2xl border-[3px] px-3 text-lg ${phoneInvalid ? "border-rose-900" : "border-slate-500"}`} />
          <span id="new-person-phone-hint" className={`text-sm ${phoneInvalid ? "text-rose-900" : "text-slate-700"}`}>{phoneInvalid ? t("contact.invalidPhone") : t("credit.phoneHint")}</span>
        </label>
        {duplicate?.by === "phone" && question}
        <label className="block">
          <span className="mb-1 block font-extrabold">{t("credit.ghanaCard")}</span>
          <input autoCapitalize="characters" maxLength="15" placeholder={t("credit.ghanaCardPlaceholder")} value={ghanaCardNumber} onChange={(event) => { const formatted = formatGhanaCard(event.target.value); setGhanaCardNumber(formatted); onUpdateParams?.({ newPersonGhanaCard: formatted }); }} className="h-14 w-full rounded-2xl border-[3px] border-slate-500 px-3 text-lg" />
          <span className="text-[15px] font-normal text-[#475569]">{t("credit.ghanaCardHint")}</span>
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
  const taskColumn = useTaskColumn();
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

  // Typing edits the text; a chip adds its text as one more item (joined with ", ") or, when already one of
  // the items, removes it (polish 6). Kept in the route params with the rest of the draft.
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

  // Wiring 18 "Reason on 18": the reason sits above the Pay by choices. So that 18 fits 360x667 with a
  // short name (16 Nov 2026): options 56px, 10px between blocks, 6px inside the field block and between
  // chip rows, 16px top padding. Wiring "Save button and Back on 18" (final): Back is at the top beside the title (the title wraps beside it) and scrolls
  // with the content; Save alone stays pinned at the bottom (16px under it, no bottom bar here). The
  // page fills the shell's page area (rules_global.shell_height), so a page that fits ends exactly at
  // the bottom of the screen and a longer one scrolls inside the page area with Save stuck to it.
  return (
    <PosPage className="flex flex-col gap-2.5 overflow-visible! pt-4! pb-4!">
      <div className="flex min-w-0 items-center gap-3">
        <PosBackButton onClick={onBack} />
        <h1 className="min-w-0 text-2xl font-extrabold leading-tight">{t("credit.whenPay", { name: customerName })}</h1>
      </div>
      {reasonCase.kind === "field" ? (
        <div className="flex flex-col gap-1.5">
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
            <div role="group" aria-label={t("credit.recentReasons")} data-recent-reasons="" className="flex flex-wrap gap-x-2 gap-y-1.5">
              {recentReasons.map((recent) => (
                <ChoiceChip key={recent} data-reason-chip="" selected={reasonChipSelected(reason, recent)} onClick={() => changeReason(toggleReasonChip(reason, recent))} className="h-10! min-h-10! max-w-full px-3.5 text-[17px] font-bold">
                  <span className="min-w-0 truncate">{recent}</span>
                </ChoiceChip>
              ))}
            </div>
          )}
        </div>
      ) : reasonCase.text ? <ReasonForRow text={reasonCase.text} /> : null}
      {choices.map((choice) => (
        <ChoiceChip key={choice.value} selected={dueChoice === choice.value} onClick={() => { setDueChoice(choice.value); onUpdateParams?.({ creditDueChoice: choice.value }); }} className="min-h-14 shrink-0 px-4 text-xl">
          {choice.label}
        </ChoiceChip>
      ))}
      <button type="button" onClick={() => onNavigate("ALittleAtATime", { ...params, ...reasonParams, creditDueChoice: dueChoice })} className="flex min-h-14 shrink-0 flex-col items-center justify-center rounded-2xl border-[3px] border-slate-500 px-4 text-lg font-extrabold leading-tight">
        {t("credit.aLittleAtATime")}
        <span className="text-sm font-semibold text-slate-700">{t("credit.installmentSubtitle")}</span>
      </button>
      {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
      <SaveAttemptNotice saveAttempt={saveAttempt} busy={saving} onTryAgain={() => void save(true)} />
      {/* Wiring "Save button and Back on 18" (final): Save is the only pinned element, full width, at
          least 56px: line 1 "Save" (800, 18px), line 2 "{Name} owes GH₵x" (600, 16px, one line); the
          name for screen readers stays "Save · {Name} owes GH₵x". */}
      {/* Wide task column: Save at the bottom of the panel, not pinned (no phone margins to cancel). */}
      <div data-bottom-row="" className={taskColumn ? "mt-auto flex flex-col items-stretch pt-2" : "sticky bottom-0 z-10 -mx-4 mt-auto flex flex-col items-stretch bg-white px-4 pt-2 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"}>
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
// (Cash, MoMo) and add up to it. What is still owed is a separate neutral row below the total
// (StillOwedRow, shared with 27).

const paidOnly = (parts) => parts.filter((part) => part.paymentMethod !== "owe");

// The Paying today panel on 19 (one of three: the recorded parts, one method, or the parts paid on 16).
// Phone and wide D10 (soft tiles on phone 19, 24 Nov 2026): the soft tile (#F1F5F9, no border, white
// rows, a #E2E8F0 divider) with the neutral Still owed row; on wide it is drawn in the summary column.
function PayingTodayPanel({ wide, single = false, totalPesewas, stillOwedPesewas, customerName, children }) {
  const box = wide
    ? `${SOFT_TILE} p-4`
    : `${single ? "mt-3 " : ""}${SOFT_TILE} p-3`;
  return (
    <div {...(single ? { "data-single-method-panel": "" } : {})} data-paying-today="" className={box} aria-live="polite">
      <p className={wide ? "mb-2 text-[19px] font-bold text-[#0F172A]" : "mb-2 font-extrabold text-[#0F172A]"}>{t("credit.payingToday")}</p>
      <div className="flex flex-col gap-2">{children}</div>
      <div data-total-today="" className={wide
        ? "mt-2 flex items-center justify-between gap-3 border-t border-[#E2E8F0] px-3 pt-2 text-[19px] font-bold text-[#0F172A]"
        : "mt-2 flex items-center justify-between gap-3 border-t border-[#E2E8F0] px-3 pt-2 font-extrabold text-[#0F172A]"}>
        <span>{t("credit.totalToday")}</span>
        <span data-paying-today-amount="" className="shrink-0 whitespace-nowrap tabular-nums">{formatGhs(totalPesewas)}</span>
      </div>
      <StillOwedRow amountPesewas={stillOwedPesewas} customerName={customerName} neutral />
    </div>
  );
}

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
  // Wide D10 (wide_layout.screens["19 A little at a time"]): form left, summary right. Layout only.
  const wide = Boolean(useTaskColumn());
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
  // Wiring 19 "Still owed row, all flows": the neutral row is the customer's balance after this sale and
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

  // The one Paying today panel shown, picked as on the phone (each case keeps its own figures).
  const panelKind = startToday && !paymentAlreadyMadeToday
    ? (recordedParts.length > 0 ? "recorded" : singlePreviewParts.length > 0 ? "single" : null)
    : paymentAlreadyMadeToday && paidTodayPesewas > 0 && splitParts.length > 0 ? "split16" : null;
  const customerName = params.customer?.name;
  const payingToday = panelKind === "recorded" ? (
    <PayingTodayPanel wide={wide} totalPesewas={getPaidPaymentPesewas(recordedParts)} stillOwedPesewas={stillOwedAfterTodayPesewas} customerName={customerName}>
      {paidOnly(recordedParts).map((part) => <RecordedPartRow key={`${part.paymentMethod}-${part.amountPesewas}`} part={part} />)}
    </PayingTodayPanel>
  ) : panelKind === "single" ? (
    <PayingTodayPanel wide={wide} single totalPesewas={todayPaymentPesewas} stillOwedPesewas={Math.max(0, maxCreditPesewas - todayPaymentPesewas)} customerName={customerName}>
      {singlePreviewParts.map((part) => <RecordedPartRow key={part.paymentMethod} part={part} />)}
    </PayingTodayPanel>
  ) : panelKind === "split16" ? (
    <PayingTodayPanel wide={wide} totalPesewas={paidTodayPesewas} stillOwedPesewas={stillOwedAfterTodayPesewas} customerName={customerName}>
      {paidOnly(splitParts).map((part) => (
        <div key={`${part.paymentMethod}-${part.amountPesewas}`} className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 font-bold">
          <span>{t(`credit.method.${part.paymentMethod}`)}</span>
          <span data-paying-today-amount="" className="shrink-0 whitespace-nowrap tabular-nums">{formatGhs(part.amountPesewas)}</span>
        </div>
      ))}
    </PayingTodayPanel>
  ) : null;
  // Wide D10: tile labels are 17px; helper lines stay text-sm, which the task column draws at 15px.
  const amountMissing = !(Number.isSafeInteger(installmentPesewas) && installmentPesewas > 0);
  const saveButton = (
    <>
      <PosPrimaryButton type="button" disabled={saving || !planReady} className={wide ? "min-h-14 w-full" : "h-14"} onClick={() => void savePlan()}>{saving ? t("credit.saving") : t("credit.savePlan")}</PosPrimaryButton>
      {amountMissing && <p data-save-hint="" className="mt-1 text-center text-[15px] font-normal text-[#475569]">{t("expense.enterAmountHint")}</p>}
    </>
  );
  const notices = (
    <>
      {boxError && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{boxError}</p>}
      <SaveAttemptNotice saveAttempt={saveAttempt} busy={saving} onTryAgain={() => void savePlan(true)} />
    </>
  );

  const form = (
    <>
      {/* Wiring 18 "Reason on 18": the reason carried from 18 (typed, the items or the 53 note), read-only; no row when empty. */}
      {reasonOn19 && (wide ? <div className="col-span-2"><ReasonForRow text={reasonOn19} /></div> : <ReasonForRow text={reasonOn19} />)}
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
      <fieldset className={wide ? "col-span-2" : undefined}>
        <legend className="mb-1 text-lg font-extrabold">{t("credit.howOften")}</legend>
        <div className="grid grid-cols-3 gap-2">
          {PAYMENT_FREQUENCIES.map((option) => (
            <ChoiceChip key={option.value} selected={frequency === option.value} onClick={() => selectFrequency(option.value)} className={`min-h-14 ${wide ? "text-[17px]" : "text-sm sm:text-base"}`}>
              {t(`credit.frequency.${option.value}`)}
            </ChoiceChip>
          ))}
        </div>
      </fieldset>
      <fieldset className={wide ? "col-span-2" : undefined}>
        <legend className="mb-1 text-lg font-extrabold">{t("credit.firstPayment")}</legend>
        {/* Wide: Next cycle ({frequency}) gets two thirds, so its 17px label stays on one line at 1024px. */}
        <div className={wide ? "grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2" : "grid grid-cols-2 gap-2"}>
          <ChoiceChip
            selected={startToday}
            aria-describedby={alreadyPaidPesewas > 0 ? "first-payment-today-why" : undefined}
            disabled={paymentAlreadyMadeToday || alreadyPaidPesewas > 0}
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
            className="min-h-14"
          >
            {t("credit.today")}
          </ChoiceChip>
          <ChoiceChip selected={!startToday} disabled={hasReceivedMomo} onClick={() => {
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
          }} className={`min-h-14 ${wide ? "text-[17px]" : "text-[15px]"}`}>{t("credit.nextCycle", { frequency: t(`credit.frequency.${frequency}`) })}</ChoiceChip>
        </div>
        {alreadyPaidPesewas > 0 && <p id="first-payment-today-why" data-first-payment-why="" className="mt-1 text-[15px] font-normal text-[#475569]">{t("credit.alreadyPaidToday", { amount: formatGhs(alreadyPaidPesewas) })}</p>}
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
        <DateField min={dayAfter(today)} value={nextDueDate} aria-invalid={!dateValid} onChange={(event) => { setNextDueDate(event.target.value); onUpdateParams?.({ nextDueDate: event.target.value }); }} className="h-14 w-full rounded-2xl border-[3px] border-slate-500 px-3 text-lg font-bold" />
        {!dateValid && <span role="alert" className="mt-1 block text-sm font-semibold text-rose-900">{t("credit.invalidDueDate")}</span>}
      </label>
      {/* Wide D10: with the parts recorded, the panel is the only content here and it sits in the
          summary column, so the empty group is left out of the form. */}
      {startToday && !paymentAlreadyMadeToday && !(wide && recordedParts.length > 0) && (
        <fieldset className={wide ? "col-span-2" : undefined}>
          <legend className={wide ? "mb-1 text-lg font-extrabold" : "mb-1 text-base font-extrabold"}>{t("credit.firstPaymentMethod")}</legend>
          {recordedParts.length > 0 ? payingToday : (
            <>
            <div className="grid grid-cols-3 gap-2">
              {["cash", "momo"].map((method) => (
                <ChoiceChip
                  key={method}
                  selected={paymentMethod === method}
                  onClick={() => {
                    choosePaymentMethod(method);
                  }}
                  className={wide ? "gap-2 text-[17px]" : "text-sm"}
                >
                  {/* rules_global.icons: on wide each choice shows its icon with the label (the name stays the label). */}
                  {wide && (method === "cash" ? <Banknote size={20} className="shrink-0" aria-hidden="true" /> : <Smartphone size={20} className="shrink-0" aria-hidden="true" />)}
                  {t(`credit.method.${method}`)}
                </ChoiceChip>
              ))}
              {/* split_payment_look (21 Nov 2026): the add look with the joined cash + phone icons and the
                  label; chosen, it keeps the dashed border with the green fill of the tiles beside it. The
                  corners are 14px like the Cash and MoMo choice chips beside it (selected_states, 25 Nov 2026). */}
              <AddButton
                plus={false}
                pressed={paymentMethod === "split"}
                aria-label={t("split.title")}
                data-split-19=""
                onClick={() => choosePaymentMethod("split")}
                className={wide
                  ? "min-h-12! flex-col gap-0.5! overflow-hidden rounded-[14px]! px-1! py-1! text-[17px]!"
                  : "min-h-12! flex-col gap-0.5! overflow-hidden rounded-[14px]! px-1! py-1! text-xs! sm:text-sm!"}
              >
                <SplitIcons size={16} />
                <span className="w-full min-w-0 truncate text-center">{t("split.title")}</span>
              </AddButton>
            </div>
            {!wide && panelKind === "single" && payingToday}
            </>
          )}
        </fieldset>
      )}
      {!wide && panelKind === "split16" && payingToday}
    </>
  );

  if (wide) {
    // Wide D10: Back and the title on top; the form on the left (its fields paired, in the phone's
    // order) and the summary on the right (Owed, the one Paying today panel, Save plan at the bottom).
    // The panel is a container: below about 820px of room (768px rail) the summary stacks under the form.
    return (
      <PosPage taskWidth={WIDE_TASK_COLUMN_WIDTH_PX} className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <PosBackButton onClick={onBack} className="h-14!" />
          <h1 className="min-w-0 text-2xl font-extrabold">{t("credit.aLittleAtATime")}</h1>
        </div>
        <div className="@container flex min-w-0 flex-1 flex-col">
          <div data-d10="" className="grid min-w-0 flex-1 grid-cols-1 gap-6 @min-[820px]:grid-cols-[minmax(0,1fr)_380px]">
            <div data-d10-form="" className="grid min-w-0 grid-cols-2 content-start gap-x-4 gap-y-4">{form}</div>
            <div data-d10-summary="" className="flex min-w-0 flex-col gap-3">
              <CreditAmount amountPesewas={maxCreditPesewas} wide />
              {payingToday}
              {notices}
              <div data-d10-save="" className="sticky bottom-0 mt-auto flex flex-col bg-white pt-2">{saveButton}</div>
            </div>
          </div>
        </div>
        {largeAmount.dialog}
      </PosPage>
    );
  }

  return (
    <PosPage className="flex flex-col gap-3">
      <h1 className="text-2xl font-extrabold">{t("credit.aLittleAtATime")}</h1>
      <CreditAmount amountPesewas={maxCreditPesewas} />
      {form}
      {notices}
      <div className="mt-auto grid grid-cols-[auto_minmax(0,1fr)] gap-2">
        <PosBackButton onClick={onBack} className="h-14!" />
        {saveButton}
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
// through Edit contact on 29/43. The saved number is still read so Send receipt opens that chat;
// without a valid number (saved_credit_layout, 25 Nov 2026) the dashed add-phone button replaces it.
function CreditSaved({ params, onHome, onNavigate, onSaveCustomerContact, shopName }) {
  const result = params.creditResult;
  const savedCustomer = useLiveQuery(async () => {
    const customerId = result?.customerId ?? params.customer?.id;
    if (customerId) return db.customers.get(customerId);
    const customerName = result?.customerName ?? params.customer?.name ?? "";
    if (!customerName.trim()) return null;
    return db.customers.where("nameLower").equals(customerName.trim().toLowerCase()).first();
  }, [result?.customerId, params.customer?.id, result?.customerName, params.customer?.name], null);
  const { phone, hasPhone, setAddedContact } = useSavedCreditPhone(savedCustomer?.phone ?? result?.phone ?? params.customer?.phone ?? "");
  const customerName = result?.customerName ?? params.customer?.name ?? "";
  const customerId = savedCustomer?.id ?? result?.customerId ?? params.customer?.id ?? "";
  const contact = { customerId, id: customerId, name: customerName, phone, ghanaCardNumber: savedCustomer?.ghanaCardNumber ?? params.customer?.ghanaCardNumber ?? "" };
  const shownName = displayName(customerName);
  const totalDebtPesewas = result?.totalDebtPesewas ?? 0;
  // Send receipt and Copy receipt show only with VITE_ENABLE_POS_RECEIPTS on (FEATURE_FLAGS.SHOW_POS_RECEIPTS).
  const receiptsOn = isReceiptTemplatesEnabled();
  const receiptText = buildCreditReceiptText(result, shopName);
  const wide = Boolean(useTaskColumn());
  return (
    <PosPage className="flex flex-col gap-2">
      <SavedCreditSummary
        name={shownName}
        owesPesewas={totalDebtPesewas}
        subline={t("credit.thisSaleLine", { amount: formatGhs(result?.amountPesewas ?? params.amountPesewas ?? 0) })}
        beforePesewas={result?.previousDebtPesewas ?? 0}
        addedLabel={t("credit.thisSaleRow")}
        addedPesewas={result?.addedDebtPesewas ?? 0}
        paidPesewas={result?.initialPaymentPesewas ?? 0}
        parts={result?.initialPaymentParts}
        fallbackMethod={result?.saleTransaction?.payment_method}
        planLine={params.installmentPlan?.isInstallmentPlan ? params.payBackLabel ?? null : null}
      />
      {/* Wide D11: Send and Copy side by side, the offline line full width under the pair. */}
      {/* saved_credit_layout (25 Nov 2026, polish 6): Send receipt is always there. Without a phone
          openWhatsApp opens WhatsApp's contact chooser (share sheet), as on a cash or MoMo sale; the dashed
          add-phone button sits under it. */}
      {receiptsOn && receiptText && (
        <SavedCreditReceiptActions
          text={receiptText}
          phone={phone}
          hasPhone={hasPhone}
          customer={contact}
          onSaveCustomerContact={onSaveCustomerContact}
          onSaved={setAddedContact}
          wide={wide}
        />
      )}
      {result?.debtId && <PosSecondaryButton type="button" className="w-full" onClick={() => onNavigate("DebtorDetail", { debtId: result.debtId, customerName })}>{t("credit.seeDetails", { name: shownName })}</PosSecondaryButton>}
      <PosPrimaryButton type="button" onClick={onHome} className="mt-auto h-14 text-2xl">{t("credit.done")}</PosPrimaryButton>
    </PosPage>
  );
}

export default function CreditScreens({ route, params, onBack, onNavigate, onUpdateParams, onReturnToSplit, onSaveCredit, onSaveCustomerContact, onHome, shopName }) {
  if (route === "WhoOwesYou") return <WhoOwesYou params={params} onBack={onBack} onNavigate={onNavigate} onUpdateParams={onUpdateParams} />;
  if (route === "NewPerson") return <NewPerson params={params} onBack={onBack} onNavigate={onNavigate} onUpdateParams={onUpdateParams} />;
  if (route === "WhenWillTheyPay") return <WhenWillTheyPay params={params} onBack={onBack} onNavigate={onNavigate} onUpdateParams={onUpdateParams} onReturnToSplit={onReturnToSplit} onSaveCredit={onSaveCredit} />;
  if (route === "ALittleAtATime") return <ALittleAtATime params={params} onBack={onBack} onNavigate={onNavigate} onUpdateParams={onUpdateParams} onReturnToSplit={onReturnToSplit} onSaveCredit={onSaveCredit} />;
  if (route === "CreditSaved") return <CreditSaved params={params} onHome={onHome} onNavigate={onNavigate} onSaveCustomerContact={onSaveCustomerContact} shopName={shopName} />;
  return null;
}
