import { useMemo, useState } from "react";
import { Check, Plus } from "lucide-react";
import { formatDate } from "../lib/formatDate.js";
import { formatGhs, formatGhsAmount } from "../lib/money.js";
import { PosCard, PosPage, PosPrimaryButton, PosSecondaryButton } from "./PosComponents.jsx";
import { posText as t } from "./i18n.js";
import { getSaleReceiptDetails } from "./saleReceipt.js";
import { getSaleReceiptText } from "./receiptTemplates.js";
import { getMomoDisplayLabel } from "./momoMapping.js";

function WhatsAppIcon({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z" fill="#25D366" />
      <path d="M8.5 7.2c.3-.5.8-.5 1.1-.3l1 2c.1.3 0 .6-.2.8l-.6.7c.7 1.3 1.7 2.3 3 3l.8-.6c.2-.2.5-.2.8-.1l1.9 1c.3.2.4.6.2 1-.4 1-1.4 1.6-2.4 1.4-3.2-.7-6-3.4-6.8-6.5-.1-.6.1-1.1.3-1.6z" fill="#fff" />
    </svg>
  );
}

// The receipt details and text, or null when the record cannot give them. 30 opens only after the
// sale is saved, so a bad record must not hide that: it is logged with the sale id instead.
function readReceipt(transaction, shopName) {
  try {
    return { details: getSaleReceiptDetails(transaction), receiptText: getSaleReceiptText(transaction, shopName) };
  } catch (error) {
    console.warn(`Sale ${transaction?.id ?? "(no id)"} was saved, but its receipt could not be built.`, error);
    return null;
  }
}

function SaleSaved({ onDone }) {
  return (
    <PosPage className="flex flex-col gap-3">
      <section className="pt-2 text-center">
        <div className="mx-auto mb-3 grid h-24 w-24 place-items-center rounded-full bg-emerald-900 text-white">
          <Check size={56} aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-extrabold">{t("saleRecorded.savedFallback")}</h1>
      </section>
      <PosPrimaryButton type="button" onClick={onDone} className="mt-auto h-[68px] text-2xl">
        {t("saleRecorded.done")}
      </PosPrimaryButton>
    </PosPage>
  );
}

export default function SaleRecorded({ transaction, shopName, onDone, onNewSale }) {
  const [shareStatus, setShareStatus] = useState("");
  const receipt = useMemo(() => readReceipt(transaction, shopName), [transaction, shopName]);
  if (!receipt) return <SaleSaved onDone={onDone} />;
  const { details, receiptText } = receipt;
  // Records saved before MoMo verification was stored keep the translated plain label.
  const momoLabel = transaction?.momoVerification ? getMomoDisplayLabel(transaction) : t("saleRecorded.method.momo");
  const when = new Date(details.timestamp);
  const time = when.toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit" });
  const dateLabel = formatDate(when) === formatDate(new Date())
    ? t("saleRecorded.today")
    : formatDate(when);

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(receiptText)}`;
  const owedPesewas = transaction?.creditExtendedPesewas ?? 0;
  const paidPesewas = details.cashReceivedPesewas + details.momoReceivedPesewas;
  const isSplit = details.paymentMethod === "split";
  const customerName = transaction?.customer_name ?? transaction?.customerName ?? "";

  async function shareReceiptFallback() {
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: t("saleRecorded.title"), text: receiptText });
        setShareStatus(t("saleRecorded.shared"));
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(receiptText);
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
            <span className="min-w-0 flex-1">
              <span className="block truncate">{item.name} × {item.quantity}</span>
              {item.subtitle && <span className="block text-sm text-slate-700">{item.subtitle}</span>}
            </span>
            <strong className="shrink-0">{formatGhsAmount(item.amountPesewas)}</strong>
          </div>
        )) : (
          <div className="flex justify-between gap-3 text-lg">
            <span>{t("saleRecorded.sale")}</span>
            <strong>{formatGhsAmount(details.amountPesewas)}</strong>
          </div>
        )}
        <div className="border-t-2 border-dashed border-slate-400 pt-2">
          {/* A split, or a sale with a part on credit (Owe on 16): each paid part, then what is still owed.
              A zero part is left out unless the sale is a Cash + MoMo split. */}
          {isSplit || owedPesewas > 0 ? (
            <div className="flex flex-col gap-1 text-lg">
              {(isSplit || details.cashReceivedPesewas > 0) && (
                <div className="flex justify-between gap-2">
                  <span>{t("saleRecorded.method.cash")}</span>
                  <strong>{formatGhs(details.cashReceivedPesewas)}</strong>
                </div>
              )}
              {(isSplit || details.momoReceivedPesewas > 0) && (
                <div className="flex justify-between gap-2">
                  <span>{momoLabel}</span>
                  <strong>{formatGhs(details.momoReceivedPesewas)}</strong>
                </div>
              )}
              <div className={paidPesewas > 0 || isSplit ? "border-t-2 border-dashed border-slate-400 pt-1" : undefined}>
                <div className="flex justify-between gap-2">
                  <span>{customerName ? t("collect.customerStillOwes", { name: customerName }) : t("credit.owed")}</span>
                  <strong className="text-rose-900">{formatGhs(owedPesewas)}</strong>
                </div>
              </div>
            </div>
            ) : (
              <div className="flex justify-between gap-2 text-lg">
                <span>{details.paymentMethod === "momo" ? momoLabel : t(`saleRecorded.method.${details.paymentMethod}`)}</span>
                <strong>{formatGhs(details.amountPesewas)}</strong>
              </div>
            )}
        </div>
      </PosCard>

      <div className="grid grid-cols-2 gap-2">
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            // Also trigger copy or fallback if opening external link isn't supported
            if (!whatsappUrl) {
              e.preventDefault();
              void shareReceiptFallback();
            }
          }}
          className="flex h-14 items-center justify-center gap-2 rounded-2xl border-2 border-emerald-900 bg-white px-2 text-center text-[17px] font-extrabold text-emerald-900"
        >
          <WhatsAppIcon size={26} />
          <span>{t("saleRecorded.sendReceipt")}</span>
        </a>
        <PosSecondaryButton type="button" onClick={onDone} className="h-14 min-h-0 rounded-2xl border-2 border-slate-900 text-[17px]">
          {t("saleRecorded.done")}
        </PosSecondaryButton>
      </div>
      {shareStatus && <p role="status" className="text-center text-sm font-semibold text-slate-700">{shareStatus}</p>}
      <PosPrimaryButton type="button" onClick={onNewSale} className="mt-auto h-[68px] text-2xl">
        <Plus size={28} aria-hidden="true" />{t("saleRecorded.newSale")}
      </PosPrimaryButton>
    </PosPage>
  );
}
