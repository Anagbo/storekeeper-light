import { useState } from "react";
import { Banknote, Smartphone } from "lucide-react";
import { formatGhs, toPesewas } from "../lib/money.js";
import { posText as t } from "./i18n.js";
import { PosCard, PosPage, PosPrimaryButton, PosSecondaryButton } from "./PosComponents.jsx";

export default function PaymentSplit({ params = {}, onBack, onNavigate, onSaveSale }) {
  const amountPesewas = Number.isSafeInteger(params.amountPesewas) ? params.amountPesewas : 0;
  const [cash, setCash] = useState(amountPesewas > 0 ? (amountPesewas / 100).toFixed(2) : "");
  const [momo, setMomo] = useState("0");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const cashPesewas = toPesewas(cash);
  const momoPesewas = toPesewas(momo);
  const validParts = Number.isSafeInteger(cashPesewas) && cashPesewas >= 0 &&
    Number.isSafeInteger(momoPesewas) && momoPesewas >= 0 &&
    Number.isSafeInteger(cashPesewas + momoPesewas) &&
    cashPesewas + momoPesewas <= amountPesewas;
  const totalPaidPesewas = validParts ? cashPesewas + momoPesewas : 0;
  const canSaveAsSale = amountPesewas > 0 && validParts && totalPaidPesewas === amountPesewas;

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
      <label className="block rounded-2xl border-[3px] border-slate-500 px-3 py-2">
        <span className="flex items-center gap-2 font-extrabold"><Banknote size={22} aria-hidden="true" />{t("credit.method.cash")}</span>
        <span className="flex items-center gap-2 text-2xl font-bold"><span>GHS</span><input type="number" min="0" step="0.01" value={cash} onChange={(event) => { setCash(event.target.value); setError(""); }} className="w-full min-w-0 bg-transparent text-right outline-none" /></span>
      </label>
      <label className="block rounded-2xl border-[3px] border-slate-500 px-3 py-2">
        <span className="flex items-center gap-2 font-extrabold"><Smartphone size={22} aria-hidden="true" />{t("credit.method.momo")}</span>
        <span className="flex items-center gap-2 text-2xl font-bold"><span>GHS</span><input type="number" min="0" step="0.01" value={momo} onChange={(event) => { setMomo(event.target.value); setError(""); }} className="w-full min-w-0 bg-transparent text-right outline-none" /></span>
      </label>
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
          {saving ? t("sell.saving") : t("split.recordSale")}
        </PosPrimaryButton>
        {validParts && totalPaidPesewas < amountPesewas && (
          <PosSecondaryButton type="button" onClick={continueAsCredit}>
            {t("split.recordRemainingAsCredit")}
          </PosSecondaryButton>
        )}
        <PosSecondaryButton type="button" onClick={onBack}>{t("credit.back")}</PosSecondaryButton>
      </div>
    </PosPage>
  );
}
