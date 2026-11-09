import { useState } from "react";
import { Banknote, Check, Smartphone, UserRound, X } from "lucide-react";
import { formatGhs, toPesewas } from "../lib/money.js";
import { posText as t } from "./i18n.js";
import { PosPage, PosPrimaryButton, PosSecondaryButton } from "./PosComponents.jsx";

const METHOD_ICONS = { cash: Banknote, momo: Smartphone, owe: UserRound };

function sumParts(parts) {
  return parts.reduce((sum, part) => sum + part.amountPesewas, 0);
}

function addPart(parts, paymentMethod, amountPesewas) {
  const existing = parts.find((part) => part.paymentMethod === paymentMethod);
  if (!existing) return [...parts, { paymentMethod, amountPesewas }];
  return parts.map((part) => (part === existing ? { ...part, amountPesewas: part.amountPesewas + amountPesewas } : part));
}

function formatDraft(amountPesewas) {
  return (amountPesewas / 100).toFixed(2);
}

export default function SplitPayment({
  totalPesewas,
  totalLabel,
  allowOwe = false,
  doneLabel,
  busy = false,
  error = "",
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
  const leftPesewas = Math.max(0, totalPesewas - sumParts(parts));
  const partsTotalPesewas = sumParts(parts);
  const partsValid = parts.every((part) => Number.isSafeInteger(part?.amountPesewas) && part.amountPesewas >= 0) &&
    partsTotalPesewas <= totalPesewas;
  const draftPesewas = draft ? toPesewas(draft.value) : 0;

  function startDraft(paymentMethod) {
    setDraft({ paymentMethod, value: formatDraft(leftPesewas) });
    setDraftError("");
  }

  function confirmDraft() {
    if (!Number.isSafeInteger(draftPesewas) || draftPesewas <= 0 || draftPesewas > leftPesewas) {
      setDraftError(t("split.amountTooHigh"));
      return;
    }
    if (draft.paymentMethod === "momo" && onMoMo) {
      onMoMo(parts, draftPesewas);
      setDraft(null);
      setDraftError("");
      return;
    }
    setParts((current) => addPart(current, draft.paymentMethod, draftPesewas));
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
            <button type="button" disabled={busy || part.paymentMethod === "owe"} onClick={() => startDraft(part.paymentMethod)} className="flex-1 text-left text-xl font-extrabold disabled:opacity-50">
              {name}
              {detail && <span className="block text-sm font-semibold text-slate-700">{detail}</span>}
            </button>
            <strong className="text-[22px]">{formatGhs(part.amountPesewas)}</strong>
            <button
              type="button"
              disabled={busy}
              aria-label={t("split.remove", { method: name })}
              onClick={() => setParts((current) => current.filter((item) => item !== part))}
              className="grid h-12 w-12 place-items-center rounded-xl bg-slate-300 text-slate-950 disabled:opacity-50"
            >
              <X size={22} aria-hidden="true" />
            </button>
          </div>
        );
      })}
      <div className={`flex items-center justify-between gap-3 rounded-[18px] border-[3px] px-4 py-3 ${leftPesewas === 0 ? "border-emerald-900 bg-green-100" : "border-amber-700 bg-amber-100"}`}>
        <span className="text-xl font-extrabold">{t("split.leftToPay")}</span>
        <strong className="text-3xl">{formatGhs(leftPesewas)}</strong>
      </div>
      {leftPesewas > 0 && !draft && (
        <>
          <p className="text-xl font-extrabold">{t("split.addTheRest")}</p>
          <div className={`grid gap-2 ${allowOwe ? "grid-cols-3" : "grid-cols-2"}`}>
            {["cash", "momo", ...(allowOwe ? ["owe"] : [])].map((method) => {
              const Icon = METHOD_ICONS[method];
              return (
                <button
                  key={method}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (method === "owe") {
                      if (partsValid) onOwe?.([...parts, { paymentMethod: "owe", amountPesewas: leftPesewas }]);
                    } else if (method === "momo" && onMoMo) {
                      startDraft(method);
                    } else {
                      startDraft(method);
                    }
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
            <PosPrimaryButton type="button" onClick={confirmDraft}>{t("split.add")}</PosPrimaryButton>
          </div>
        </section>
      )}
      {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
      <div className="flex-1" />
      <PosPrimaryButton type="button" aria-disabled={busy || leftPesewas !== 0 || parts.length === 0 || !partsValid ? "true" : undefined} disabled={busy || leftPesewas !== 0 || parts.length === 0 || !partsValid} onClick={() => onDone(parts)} className="h-[68px] min-h-0 rounded-[20px] text-2xl">
        {busy ? t("sell.saving") : <><Check size={28} aria-hidden="true" />{doneLabel}</>}
      </PosPrimaryButton>
    </PosPage>
  );
}
