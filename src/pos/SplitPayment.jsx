import { useState } from "react";
import { Banknote, Check, Smartphone, UserRound, X } from "lucide-react";
import { formatGhs } from "../lib/money.js";
import { formatPesewasText, parseAmountToPesewas } from "../lib/parsePesewas.js";
import { posText as t } from "./i18n.js";
import { PosPage, PosPrimaryButton, PosSecondaryButton } from "./PosComponents.jsx";
import { addRemainingToPart, isLockedMomoRow, planMomoRowEdit, setPartAmount } from "./splitTender.js";

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
  const [draftError, setDraftError] = useState("");
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

  const hasLockedMomoRow = parts.some(isLockedMomoRow);

  // Tapping a row's amount edits it (brief 3.8 rule 2). Cash and Owe are one tap on a tile;
  // the MoMo tile first asks how much (prefilled with Left to pay), because that amount is what
  // 61 and 62 ask the customer for.
  function startEdit(part) {
    setDraft({ paymentMethod: part.paymentMethod, value: formatDraft(part.amountPesewas), mode: "edit" });
    setDraftError("");
  }

  function startMomoAdd() {
    setDraft({ paymentMethod: "momo", value: formatDraft(leftPesewas), mode: "add" });
    setDraftError("");
  }

  function confirmDraft() {
    if (draft.mode === "add") {
      // MoMo tile: the amount goes to 61 and 62; the row is added when 62 confirms it.
      if (!Number.isSafeInteger(draftPesewas) || draftPesewas <= 0 || draftPesewas > leftPesewas) {
        setDraftError(t("split.amountTooHigh"));
        return;
      }
      setDraft(null);
      setDraftError("");
      onMoMo(parts, draftPesewas);
      return;
    }
    if (draft.paymentMethod === "momo") {
      const plan = planMomoRowEdit(parts, draftPesewas, totalPesewas);
      if (!plan || (plan.kind === "confirm" && !onMoMo)) {
        setDraftError(t("split.amountTooHigh"));
        return;
      }
      setDraft(null);
      setDraftError("");
      // Above the confirmed amount only the extra is confirmed again on 62.
      if (plan.kind === "confirm") onMoMo(parts, plan.extraPesewas, { momoRowAmountPesewas: plan.rowAmountPesewas });
      else commitParts(plan.parts);
      return;
    }
    const next = setPartAmount(parts, draft.paymentMethod, draftPesewas, totalPesewas);
    if (!next) {
      setDraftError(t("split.amountTooHigh"));
      return;
    }
    commitParts(next);
    setDraft(null);
    setDraftError("");
  }

  return (
    <PosPage className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <PosSecondaryButton type="button" onClick={onBack} disabled={busy} aria-label={t("split.back")} className="min-h-[52px] px-4 text-lg">‹ {t("split.back")}</PosSecondaryButton>
        <h1 className="text-2xl font-extrabold">{t("split.title")}</h1>
      </div>
      <div className="flex items-center justify-between gap-3 text-lg font-bold">
        <span>{totalLabel}</span>
        <strong className="text-3xl">{formatGhs(totalPesewas)}</strong>
      </div>
      {parts.map((part) => {
        const Icon = METHOD_ICONS[part.paymentMethod];
        const name = t(`sell.${part.paymentMethod}`);
        const detail = partDetail(part);
        return (
          <div key={part.paymentMethod} className="flex min-h-16 items-center gap-3 rounded-2xl border-2 border-slate-500 bg-white px-3">
            <Icon size={28} className="text-emerald-900" aria-hidden="true" />
            <button type="button" disabled={busy || part.paymentMethod === "owe" || isLockedMomoRow(part)} onClick={() => startEdit(part)} className={`flex-1 text-left text-xl font-extrabold${busy ? " opacity-50" : ""}`}>
              {name}
              {detail && <span className="block text-sm font-semibold text-slate-700">{detail}</span>}
            </button>
            <strong className="text-[22px]">{formatGhs(part.amountPesewas)}</strong>
            {!isLockedMomoRow(part) && <button
              type="button"
              disabled={busy}
              aria-label={t("split.remove", { method: name })}
              onClick={() => commitParts(parts.filter((item) => item !== part))}
              className="grid h-12 w-12 place-items-center rounded-xl bg-slate-300 text-slate-950 disabled:opacity-50"
            >
              <X size={22} aria-hidden="true" />
            </button>}
          </div>
        );
      })}
      {/* Brief 3.8 rule 12: a change to Left to pay is announced ("Left to pay GH₵5.00"). */}
      <div role="status" aria-live="polite" aria-atomic="true" className={`flex items-center justify-between gap-3 rounded-[18px] border-[3px] px-4 py-3 ${leftPesewas === 0 ? "border-emerald-900 bg-green-100" : "border-amber-700 bg-amber-100"}`}>
        <span className="text-xl font-extrabold">{t("split.leftToPay")}</span>
        <strong className="text-3xl">{formatGhs(leftPesewas)}</strong>
      </div>
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
              onChange={(event) => { setDraft({ ...draft, value: event.target.value }); setDraftError(""); }}
              className="h-14 w-full min-w-0 bg-transparent text-right text-2xl font-extrabold outline-none"
            />
          </div>
          {draftError && <p role="alert" className="font-semibold text-rose-900">{draftError}</p>}
          <div className="grid grid-cols-2 gap-2">
            <PosSecondaryButton type="button" onClick={() => { setDraft(null); setDraftError(""); }}>{t("credit.cancel")}</PosSecondaryButton>
            <PosPrimaryButton type="button" onClick={confirmDraft}>{t("split.save")}</PosPrimaryButton>
          </div>
        </section>
      )}
      {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
      {notice}
      <div className="flex-1" />
      <PosPrimaryButton type="button" aria-disabled={busy || leftPesewas !== 0 || parts.length === 0 || !partsValid ? "true" : undefined} disabled={busy || leftPesewas !== 0 || parts.length === 0 || !partsValid} onClick={() => onDone(parts)} className="h-[68px] min-h-0 rounded-[20px] text-2xl">
        {busy ? t("sell.saving") : <><Check size={28} aria-hidden="true" />{doneLabel}</>}
      </PosPrimaryButton>
    </PosPage>
  );
}
