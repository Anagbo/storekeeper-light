import { Banknote, Check, Smartphone, UserRound } from "lucide-react";
import { formatGhs } from "../lib/money.js";
import { normalizeSaleItems, totalSaleItemsPesewas } from "../lib/saleItems.js";
import { AddButton, PosCard, PosPage, PosPrimaryButton, SplitIcons, PosBackButton } from "./PosComponents.jsx";
import { posText as t } from "./i18n.js";
import { useItemsSaleSave } from "./useItemsSaleSave.js";

const paymentChoices = [
  { value: "cash", label: "sell.cash", icon: Banknote },
  { value: "momo", label: "sell.momo", icon: Smartphone },
  { value: "owe", label: "sell.owe", icon: UserRound }
];

export default function ReviewAndPay({ params = {}, onBack, onNavigate, onUpdateParams, onSaveSale }) {
  const saleItems = normalizeSaleItems(params.saleItems ?? []);
  const totalPesewas = totalSaleItemsPesewas(saleItems);
  const { paymentMethod, choosePayment, openSplit, saveSale, busy, error, largeAmount } = useItemsSaleSave({ params, saleItems, totalPesewas, onNavigate, onUpdateParams, onSaveSale });

  return (
    <PosPage className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <PosBackButton onClick={onBack} disabled={busy} />
        <h1 className="text-2xl font-extrabold">{t("review.title")}</h1>
      </div>

      <PosCard className="space-y-2">
        {saleItems.map((item) => (
          <div key={item.productId === null ? "other-amount" : item.productId} className="flex justify-between gap-3 text-lg">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-extrabold">{item.name} × {item.quantity}</span>
              {item.subtitle && <span className="block text-sm text-slate-700">{item.subtitle}</span>}
            </span>
            {/* Wiring 55 "Amounts on Review and pay" (16 Nov 2026): every line amount keeps GH₵. */}
            <strong className="shrink-0 whitespace-nowrap">{formatGhs(item.total_amount)}</strong>
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
            onClick={() => choosePayment(value)}
            className={`flex min-h-[76px] flex-col items-center justify-center gap-1 rounded-[18px] border-[3px] px-2 text-[17px] font-extrabold ${
              paymentMethod === value ? "border-emerald-900 bg-green-200 text-slate-950" : "border-slate-500 bg-white text-slate-900"
            }`}
          >
            <Icon size={28} aria-hidden="true" />{t(label)}
          </button>
        ))}
      </div>
      {/* split_payment_look (21 Nov 2026): Split is the add look (dashed 2px dark green), keeping its
          Cash + MoMo + Owe icon. On 55 it is a full-width button under the three tiles, so the full label fits. */}
      <AddButton
        plus={false}
        aria-label={t("review.split")}
        data-split-55=""
        onClick={openSplit}
        className="min-h-[68px]! w-full"
      >
        <SplitIcons withOwe size={18} /> {t("review.split")}
      </AddButton>

      {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
      <div className="flex-1" />
      <PosPrimaryButton type="button" disabled={busy} onClick={() => void saveSale()} className="h-[68px] min-h-0 rounded-[20px] text-2xl">
        {busy ? t("sell.saving") : <><Check size={28} aria-hidden="true" />{t("sell.done")}</>}
      </PosPrimaryButton>
      {largeAmount.dialog}
    </PosPage>
  );
}
