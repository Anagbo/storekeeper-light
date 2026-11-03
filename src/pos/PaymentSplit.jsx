import { useState } from "react";
import { Check, HandCoins } from "lucide-react";
import { formatGhs, toPesewas } from "../lib/money.js";
import { posText as t } from "./i18n.js";
import { PosCard, PosPage, PosPrimaryButton, PosSecondaryButton } from "./PosComponents.jsx";
import { areSplitTenderAmountsComplete, areSplitTenderAmountsValid } from "./splitTender.js";

export function SplitTenderFields({ cash, momo, onCashChange, onMomoChange, disabled = false }) {
  return (
    <>
      {[
        { method: "cash", value: cash, onChange: onCashChange },
        { method: "momo", value: momo, onChange: onMomoChange }
      ].map(({ method, value, onChange }) => (
        <label key={method} className="block rounded-2xl border-[3px] border-slate-500 px-3 py-2">
          <span className="flex items-center gap-2 font-extrabold">{t(`credit.method.${method}`)}</span>
          <span className="flex items-center gap-2 text-2xl font-bold">
            <span>GHS</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={value}
              disabled={disabled}
              onChange={(event) => onChange(event.target.value)}
              className="w-full min-w-0 bg-transparent text-right outline-none disabled:opacity-60"
            />
          </span>
        </label>
      ))}
    </>
  );
}

export default function PaymentSplit({ params = {}, onBack, onNavigate, onSaveSale }) {
  const amountPesewas = Number.isSafeInteger(params.amountPesewas) ? params.amountPesewas : 0;
  const [cash, setCash] = useState(amountPesewas > 0 ? (amountPesewas / 100).toFixed(2) : "");
  const [momo, setMomo] = useState("0");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const cashPesewas = toPesewas(cash);
  const momoPesewas = toPesewas(momo);
  const validParts = areSplitTenderAmountsValid(amountPesewas, cashPesewas, momoPesewas);
  const totalPaidPesewas = validParts ? cashPesewas + momoPesewas : 0;
  const canSaveAsSale = areSplitTenderAmountsComplete(amountPesewas, cashPesewas, momoPesewas);

  async function saveSale() {
    if (saving || !canSaveAsSale) return;
    setSaving(true);
    setError("");
    try {
      await onSaveSale({
        amountPesewas,
        cashReceivedPesewas: cashPesewas,
        momoReceivedPesewas: momoPesewas,
        saleItems: params.saleItems ?? []
      });
    } catch (saveError) {
      console.error("Could not save the split-payment sale.", saveError);
      setError(saveError?.name === "QuotaExceededError" ? t("sell.storageFull") : t("split.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  function continueAsCredit() {
    if (!validParts || totalPaidPesewas >= amountPesewas) return;
    const initialPaymentParts = [
      ...(cashPesewas > 0 ? [{ paymentMethod: "cash", amountPesewas: cashPesewas }] : []),
      ...(momoPesewas > 0 ? [{ paymentMethod: "momo", amountPesewas: momoPesewas }] : [])
    ];
    onNavigate("WhoOwesYou", {
      ...params,
      initialPaymentPesewas: totalPaidPesewas,
      initialPaymentParts
    });
  }

  return (
    <PosPage className="flex flex-col gap-3">
      <h1 className="text-2xl font-extrabold">{t("split.title")}</h1>
      <PosCard className="flex items-center justify-between gap-3 text-lg">
        <span>{t("split.saleTotal")}</span><strong>{formatGhs(amountPesewas)}</strong>
      </PosCard>
      <SplitTenderFields
        cash={cash}
        momo={momo}
        onCashChange={(value) => { setCash(value); setError(""); }}
        onMomoChange={(value) => { setMomo(value); setError(""); }}
        disabled={saving}
      />
      <PosCard className="flex items-center justify-between gap-3">
        <span className="font-bold">{t("split.paidNow")}</span><strong>{formatGhs(totalPaidPesewas)}</strong>
      </PosCard>
      {!validParts && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{t("split.amountTooHigh")}</p>}
      {validParts && totalPaidPesewas < amountPesewas && (
        <p className="rounded-xl bg-amber-100 p-3 font-semibold text-amber-950">
          {t("split.remainingCredit", { amount: formatGhs(amountPesewas - totalPaidPesewas) })}
        </p>
      )}
      {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
      <div className="mt-auto flex flex-col gap-2">
        <PosPrimaryButton type="button" disabled={saving || !canSaveAsSale} onClick={() => void saveSale()}>
          {saving ? t("sell.saving") : <><Check size={22} aria-hidden="true" />{t("split.done")}</>}
        </PosPrimaryButton>
        {validParts && totalPaidPesewas < amountPesewas && (
          <PosSecondaryButton type="button" onClick={continueAsCredit} className="min-h-14">
            <HandCoins size={22} aria-hidden="true" />{t("split.owe")}
          </PosSecondaryButton>
        )}
        <PosSecondaryButton type="button" onClick={onBack}>{t("credit.back")}</PosSecondaryButton>
      </div>
    </PosPage>
  );
}
