import { useState } from "react";
import { Banknote, Check, Pencil, Smartphone, UserRound, X } from "lucide-react";
import { formatGhs } from "../lib/money.js";
import { formatPesewasText, parseAmountToPesewas } from "../lib/parsePesewas.js";
import { posText as t } from "./i18n.js";
import { PosPage, PosPrimaryButton, PosSecondaryButton, PosBackButton } from "./PosComponents.jsx";
import { useLargeAmountConfirm } from "./LargeAmountConfirm.jsx";
import StillOwedRow from "./StillOwedRow.jsx";
import { addRemainingToPart, isLockedMomoRow, removePart, setPartAmount } from "./splitTender.js";
import { useFormErrors } from "./formErrors.js";

const METHOD_ICONS = { cash: Banknote, momo: Smartphone, owe: UserRound };

function sumParts(parts) {
  return parts.reduce((sum, part) => sum + part.amountPesewas, 0);
}

function formatDraft(amountPesewas) {
  return formatPesewasText(amountPesewas);
}

export default function SplitPayment({
  totalPesewas,
  totalLabel,
  allowOwe = false,
  doneLabel,
  busy = false,
  error = "",
  notice = null,
  // 27 opened from 26 or 19: { amountPesewas, customerName } of the balance after this payment.
  stillOwed = null,
  onPartsChange,
  onBack,
  onDone,
  onOwe,
  onMoMo,
  initialParts = [],
  partDetail = () => ""
}) {
  const [parts, setParts] = useState(initialParts);
  const [draft, setDraft] = useState(null);
  const largeAmount = useLargeAmountConfirm();
  // Every change of the parts is also reported, so the screen's owner can keep the draft in the
  // route params and it survives a trip to Settings (brief 3.8 rule 13).
  function commitParts(next) {
    setParts(next);
    onPartsChange?.(next);
  }
  const leftPesewas = Math.max(0, totalPesewas - sumParts(parts));
  const partsTotalPesewas = sumParts(parts);
  const partsValid = parts.every((part) => Number.isSafeInteger(part?.amountPesewas) && part.amountPesewas >= 0) &&
    partsTotalPesewas <= totalPesewas;
  // Integer math on the typed text (cleanup batch, 1a), not floating-point toPesewas.
  const draftPesewas = draft ? parseAmountToPesewas(draft.value) : 0;
  // rules_global.form_errors: the editor's amount is named after Save with a problem, and the message
  // goes as soon as the amount fits (more than zero, no more than Left to pay).
  const draftFits = !draft ? true : draft.mode === "add"
    ? Number.isSafeInteger(draftPesewas) && draftPesewas > 0 && draftPesewas <= leftPesewas
    : Boolean(setPartAmount(parts, draft.paymentMethod, draftPesewas, totalPesewas));
  const draftErrors = useFormErrors([["amount", draftFits ? "" : t("split.amountTooHigh")]]);

  // One row per mode, so while a MoMo row is locked (money received) the MoMo tile is hidden: a
  // second pick would grow a row that can no longer change.
  const hasLockedMomoRow = parts.some(isLockedMomoRow);
  // Cash and MoMo amounts can be changed here; Owe is set on 18/19 and a received MoMo row is final.
  const isEditablePart = (part) => part.paymentMethod !== "owe" && !isLockedMomoRow(part);
  const editableParts = parts.filter(isEditablePart).length;

  // Tapping a row's amount edits it (brief 3.8 rule 2). Cash and Owe are one tap on a tile;
  // the MoMo tile first asks how much (prefilled with Left to pay), because that amount is what
  // 61 and 62 ask the customer for.
  function startEdit(part) {
    setDraft({ paymentMethod: part.paymentMethod, value: formatDraft(part.amountPesewas), mode: "edit" });
    draftErrors.clear();
  }

  function startMomoAdd() {
    setDraft({ paymentMethod: "momo", value: formatDraft(leftPesewas), mode: "add" });
    draftErrors.clear();
  }

  // `confirmed` is true when Yes, save on the large-amount dialog continues this same Save.
  function confirmDraft(confirmed = false) {
    if (!draftErrors.check()) return;
    if (draft.mode === "add") {
      // MoMo tile: the amount goes to 61 and 62; the row is added when 62 confirms it.
      // Brief 3.12: a large MoMo amount asks before it goes to 61; Change amount leaves this editor as it is.
      if (!confirmed && largeAmount.guard(draftPesewas, () => confirmDraft(true), { momo: true })) return;
      setDraft(null);
      onMoMo(parts, draftPesewas);
      return;
    }
    // Only Cash and a MoMo row not yet confirmed get here; setPartAmount refuses a locked row.
    commitParts(setPartAmount(parts, draft.paymentMethod, draftPesewas, totalPesewas));
    setDraft(null);
  }

  return (
    <PosPage className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <PosBackButton onClick={onBack} disabled={busy} />
        <h1 className="text-2xl font-extrabold">{t("split.title")}</h1>
      </div>
      <div className="flex items-center justify-between gap-3 text-lg font-bold">
        <span>{totalLabel}</span>
        <strong className="text-3xl">{formatGhs(totalPesewas)}</strong>
      </div>
      {editableParts > 0 && <p data-edit-hint="" className="-mt-1.5 text-[15px] text-slate-600">{t("split.tapToChange")}</p>}
      {parts.map((part) => {
        const Icon = METHOD_ICONS[part.paymentMethod];
        const name = t(`sell.${part.paymentMethod}`);
        const detail = partDetail(part);
        const editable = isEditablePart(part);
        const locked = isLockedMomoRow(part);
        // 16 and 27: the amount is a chip (grey, 2px border, bold 21px, 48px tall). An editable row's
        // chip has a green pencil and opens the editor; Owe shows the chip with no pencil. A locked
        // MoMo row (money received) shows a plain amount, a green "received ✓" line, and no buttons.
        const chipClass = "flex min-h-12 shrink-0 items-center gap-1 whitespace-nowrap rounded-xl border-2 border-slate-400 bg-slate-100 px-2 text-[21px] font-extrabold text-[#0F172A]";
        const nameClass = `grow shrink-0 whitespace-nowrap text-left text-lg font-extrabold${busy ? " opacity-50" : ""}`;
        return (
          // Wiring "Row layout on 16 and 27" (12 Nov 2026), the same at every width: line 1 = icon,
          // short name, chip and x; line 2 = the status across the full card width (at most 2 lines).
          // The name never breaks ("MoMo" stays whole). Only an amount too long for the phone
          // (GH₵12,345.00 at 360px) moves the chip and x under the name, so neither is clipped.
          <div key={part.paymentMethod} data-split-row={part.paymentMethod} className="flex min-h-16 min-w-0 flex-col justify-center gap-1 rounded-2xl border-2 border-slate-500 bg-white px-2 py-2">
            <div data-row-line="" className="flex min-w-0 flex-wrap items-center gap-1.5">
              <Icon size={22} className="shrink-0 text-emerald-900" aria-hidden="true" />
              {editable ? (
                <button type="button" disabled={busy} onClick={() => startEdit(part)} className={nameClass}>{name}</button>
              ) : (
                <div className={nameClass}>{name}</div>
              )}
              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                {locked ? (
                  <strong data-row-amount="" className="shrink-0 whitespace-nowrap text-[21px] font-extrabold text-[#0F172A]">{formatGhs(part.amountPesewas)}</strong>
                ) : editable ? (
                  <button type="button" disabled={busy} aria-label={t("split.editAmount", { method: name })} onClick={() => startEdit(part)} className={`${chipClass} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:opacity-50`}>
                    {formatGhs(part.amountPesewas)}
                    <Pencil data-pencil="" size={16} className="shrink-0 text-emerald-900" aria-hidden="true" />
                  </button>
                ) : (
                  <strong className={chipClass}>{formatGhs(part.amountPesewas)}</strong>
                )}
                {!locked && <button
                  type="button"
                  disabled={busy}
                  aria-label={t("split.remove", { method: name })}
                  onClick={() => { const next = removePart(parts, part); if (next) commitParts(next); }}
                  className="grid h-12 w-11 shrink-0 place-items-center rounded-xl bg-slate-300 text-slate-950 disabled:opacity-50"
                >
                  <X size={22} aria-hidden="true" />
                </button>}
              </div>
            </div>
            {detail && (
              <p data-row-status="" className={`line-clamp-2 w-full text-[15px] leading-snug [overflow-wrap:anywhere] ${locked ? "font-bold text-emerald-900" : "font-semibold text-slate-700"}${busy ? " opacity-50" : ""}`}>{detail}</p>
            )}
          </div>
        );
      })}
      {/* Brief 3.8 rule 12: a change to Left to pay is announced ("Left to pay GH₵5.00"). */}
      <div role="status" aria-live="polite" aria-atomic="true" className={`flex items-center justify-between gap-3 rounded-[18px] border-[3px] px-4 py-3 ${leftPesewas === 0 ? "border-emerald-900 bg-green-100" : "border-amber-700 bg-amber-100"}`}>
        <span className="text-xl font-extrabold">{t("split.leftToPay")}</span>
        <strong className="text-3xl">{formatGhs(leftPesewas)}</strong>
      </div>
      {stillOwed && <StillOwedRow amountPesewas={stillOwed.amountPesewas} customerName={stillOwed.customerName} />}
      {leftPesewas > 0 && !draft && (
        <>
          <p className="text-xl font-extrabold">{t("split.addTheRest")}</p>
          <div className={`grid gap-2 ${allowOwe ? "grid-cols-3" : "grid-cols-2"}`}>
            {["cash", ...(hasLockedMomoRow ? [] : ["momo"]), ...(allowOwe ? ["owe"] : [])].map((method) => {
              const Icon = METHOD_ICONS[method];
              return (
                <button
                  key={method}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    // One tap puts the whole Left to pay into Cash or Owe (K1). MoMo first asks how much,
                    // then opens 61; nothing is requested yet.
                    if (method === "owe") {
                      if (partsValid) onOwe?.([...parts, { paymentMethod: "owe", amountPesewas: leftPesewas }]);
                    } else if (method === "momo" && onMoMo) startMomoAdd();
                    else commitParts(addRemainingToPart(parts, method, totalPesewas));
                  }}
                  className="flex h-[76px] flex-col items-center justify-center gap-0.5 rounded-[18px] border-[3px] border-slate-500 bg-white px-2 text-[17px] font-extrabold text-slate-950 disabled:opacity-50"
                >
                  <Icon size={28} aria-hidden="true" />{t(`sell.${method}`)}
                </button>
              );
            })}
          </div>
        </>
      )}
      {draft && (
        <section aria-label={t("split.howMuch", { method: t(`sell.${draft.paymentMethod}`) })} className="space-y-2 rounded-2xl border-[3px] border-emerald-900 p-3">
          <label className="block text-lg font-extrabold" htmlFor="split-draft-amount">{t("split.howMuch", { method: t(`sell.${draft.paymentMethod}`) })}</label>
          <div className="flex items-center gap-2 rounded-xl border-2 border-slate-500 px-3">
            <span className="font-bold text-slate-700">GH₵</span>
            <input
              id="split-draft-amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              autoFocus
              value={draft.value}
              onChange={(event) => setDraft({ ...draft, value: event.target.value })}
              className="h-14 w-full min-w-0 bg-transparent text-right text-2xl font-extrabold outline-none"
            />
          </div>
          {draftErrors.message && <p role="alert" className="font-semibold text-rose-900">{draftErrors.message}</p>}
          <div className="grid grid-cols-2 gap-2">
            <PosSecondaryButton type="button" onClick={() => { setDraft(null); draftErrors.clear(); }}>{t("credit.cancel")}</PosSecondaryButton>
            <PosPrimaryButton type="button" onClick={() => confirmDraft()}>{t("split.save")}</PosPrimaryButton>
          </div>
        </section>
      )}
      {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
      {notice}
      <div className="flex-1" />
      <PosPrimaryButton type="button" aria-disabled={busy || leftPesewas !== 0 || parts.length === 0 || !partsValid ? "true" : undefined} disabled={busy || leftPesewas !== 0 || parts.length === 0 || !partsValid} onClick={() => onDone(parts)} className="h-[68px] min-h-0 rounded-[20px] text-2xl">
        {busy ? t("sell.saving") : <><Check size={28} aria-hidden="true" />{doneLabel}</>}
      </PosPrimaryButton>
      {largeAmount.dialog}
    </PosPage>
  );
}
