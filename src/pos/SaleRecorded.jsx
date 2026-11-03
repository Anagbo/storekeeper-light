import { useState } from "react";
import { Check, Plus } from "lucide-react";
import { formatGhs } from "../lib/money.js";
import { PosCard, PosPage, PosPrimaryButton, PosSecondaryButton, PosStatusTag } from "./PosComponents.jsx";
import { posText as t } from "./i18n.js";
import { buildSaleReceiptMessage, getSaleReceiptDetails } from "./saleReceipt.js";

export default function SaleRecorded({ transaction, shopName, onDone, onNewSale }) {
  const [shareStatus, setShareStatus] = useState("");
  const details = getSaleReceiptDetails(transaction);
  const when = new Date(details.timestamp);
  const time = when.toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit" });
  const dateLabel = when.toDateString() === new Date().toDateString()
    ? t("saleRecorded.today")
    : when.toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });

  async function shareReceipt() {
    const text = buildSaleReceiptMessage(transaction, shopName);
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: t("saleRecorded.title"), text });
        setShareStatus(t("saleRecorded.shared"));
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setShareStatus(t("saleRecorded.copied"));
      } else {
        setShareStatus(t("saleRecorded.shareUnavailable"));
      }
    } catch (shareError) {
      if (shareError?.name === "AbortError") return;
      console.error("Could not share the sale receipt.", shareError);
      setShareStatus(t("saleRecorded.shareFailed"));
    }
  }

  return (
    <PosPage className="flex flex-col gap-3">
      <section className="pt-2 text-center">
        <div className="mx-auto mb-3 grid h-24 w-24 place-items-center rounded-full bg-emerald-900 text-white">
          <Check size={56} aria-hidden="true" />
        </div>
        <h1 className="text-xl font-bold">{t("saleRecorded.title")}</h1>
        <p className="amount-fit-container text-4xl font-extrabold">{formatGhs(details.amountPesewas)}</p>
        <p className="text-lg text-slate-700">{dateLabel} · {time}</p>
      </section>

      <PosCard className="space-y-2">
        {details.items.length ? details.items.map((item, index) => (
          <div key={`${item.name}-${index}`} className="flex justify-between gap-3 text-lg">
            <span className="min-w-0 flex-1 truncate">{item.name} × {item.quantity}</span>
            <strong className="shrink-0">{formatGhs(item.amountPesewas)}</strong>
          </div>
        )) : (
          <div className="flex justify-between gap-3 text-lg">
            <span>{t("saleRecorded.sale")}</span>
            <strong>{formatGhs(details.amountPesewas)}</strong>
          </div>
        )}
        <div className="border-t-2 border-dashed border-slate-400 pt-2">
          {details.paymentMethod === "split" ? (
            <div className="flex flex-wrap gap-2">
              <PosStatusTag>{t("saleRecorded.method.cash")} · {formatGhs(details.cashReceivedPesewas)}</PosStatusTag>
              <PosStatusTag>{t("saleRecorded.method.momo")} · {formatGhs(details.momoReceivedPesewas)}</PosStatusTag>
            </div>
          ) : (
            <PosStatusTag>{t(`saleRecorded.method.${details.paymentMethod}`)} · {formatGhs(details.amountPesewas)}</PosStatusTag>
          )}
        </div>
      </PosCard>

      <div className="grid grid-cols-2 gap-2">
        <PosSecondaryButton type="button" onClick={() => void shareReceipt()}>{t("saleRecorded.sendReceipt")}</PosSecondaryButton>
        <PosSecondaryButton type="button" onClick={onDone}>{t("saleRecorded.done")}</PosSecondaryButton>
      </div>
      {shareStatus && <p role="status" className="text-center text-sm font-semibold text-slate-700">{shareStatus}</p>}
      <PosPrimaryButton type="button" onClick={onNewSale} className="mt-auto h-[68px] text-2xl">
        <Plus size={28} aria-hidden="true" />{t("saleRecorded.newSale")}
      </PosPrimaryButton>
    </PosPage>
  );
}
