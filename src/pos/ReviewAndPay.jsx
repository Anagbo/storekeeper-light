import { useState } from "react";
import { Banknote, Check, Smartphone, UserRound } from "lucide-react";
import { isSaveOutcomeUnknown, isSaveTimeout } from "../lib/saveAttempt.js";
import { formatGhs } from "../lib/money.js";
import { normalizeSaleItems, totalSaleItemsPesewas } from "../lib/saleItems.js";
import { PosCard, PosPage, PosPrimaryButton, PosSecondaryButton, SplitIcons } from "./PosComponents.jsx";
import { posText as t } from "./i18n.js";
import SaveAttemptNotice from "./SaveAttemptNotice.jsx";
import { useSaveAttempt } from "./useSaveAttempt.js";

const paymentChoices = [
  { value: "cash", label: "sell.cash", icon: Banknote },
  { value: "momo", label: "sell.momo", icon: Smartphone },
  { value: "owe", label: "sell.owe", icon: UserRound }
];

export default function ReviewAndPay({ params = {}, onBack, onNavigate, onSaveSale }) {
  const saleItems = normalizeSaleItems(params.saleItems ?? []);
  const totalPesewas = totalSaleItemsPesewas(saleItems);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saveAttempt = useSaveAttempt();

  function continueToCredit() {
    onNavigate("WhoOwesYou", {
      ...params,
      amountPesewas: totalPesewas,
      saleItems
    });
  }

  async function saveSale() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const content = {
        amountPesewas: totalPesewas,
        cashReceivedPesewas: paymentMethod === "cash" ? totalPesewas : 0,
        momoReceivedPesewas: paymentMethod === "momo" ? totalPesewas : 0,
        saleItems
      };
      await saveAttempt.run(content, (attemptId) => onSaveSale({ ...content, attemptId }));
    } catch (saveError) {
      console.error("Could not save the reviewed sale.", saveError);
      setError(isSaveOutcomeUnknown(saveError)
        ? ""
        : isSaveTimeout(saveError)
        ? t("sell.saveTimedOut")
        : saveError?.name === "QuotaExceededError"
          ? t("sell.storageFull")
          : t("sell.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PosPage className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <PosSecondaryButton type="button" onClick={onBack} disabled={busy} className="min-h-[52px] px-4 text-lg">‹ {t("review.back")}</PosSecondaryButton>
        <h1 className="text-2xl font-extrabold">{t("review.title")}</h1>
      </div>

      <PosCard className="space-y-2">
        {saleItems.map((item) => (
          <div key={item.productId === null ? "other-amount" : item.productId} className="flex justify-between gap-3 text-lg">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-extrabold">{item.name} × {item.quantity}</span>
              {item.subtitle && <span className="block text-sm text-slate-700">{item.subtitle}</span>}
            </span>
            <strong className="shrink-0">{formatGhs(item.total_amount).replace("GH₵", "")}</strong>
          </div>
        ))}
        <div className="flex justify-between gap-3 border-t-2 border-dashed border-slate-400 pt-2 text-xl">
          <strong>{t("review.total")}</strong>
          <strong>{formatGhs(totalPesewas)}</strong>
        </div>
      </PosCard>

      <h2 className="text-xl font-extrabold">{t("review.howPaid")}</h2>
      <div className="grid grid-cols-3 gap-2">
        {paymentChoices.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            aria-pressed={paymentMethod === value}
            onClick={() => {
              if (value === "owe") continueToCredit();
              else if (value === "momo") onNavigate("MoMoChoice", { ...params, amountPesewas: totalPesewas, saleItems });
              else setPaymentMethod(value);
            }}
            className={`flex min-h-[76px] flex-col items-center justify-center gap-1 rounded-[18px] border-[3px] px-2 text-[17px] font-extrabold ${
              paymentMethod === value ? "border-emerald-900 bg-green-200 text-slate-950" : "border-slate-500 bg-white text-slate-900"
            }`}
          >
            <Icon size={28} aria-hidden="true" />{t(label)}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onNavigate("SplitPayment", { ...params, amountPesewas: totalPesewas, saleItems })}
        className="flex min-h-[68px] items-center justify-center gap-2 rounded-[18px] border-[3px] border-emerald-900 bg-white px-3 text-lg font-extrabold text-emerald-900"
      >
        <SplitIcons withOwe size={18} /> {t("review.split")}
      </button>

      {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
      <div className="flex-1" />
      <PosPrimaryButton type="button" disabled={busy} onClick={() => void saveSale()} className="h-[68px] min-h-0 rounded-[20px] text-2xl">
        {busy ? t("sell.saving") : <><Check size={28} aria-hidden="true" />{t("sell.done")}</>}
      </PosPrimaryButton>
    </PosPage>
  );
}
