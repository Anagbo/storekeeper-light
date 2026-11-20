import { useMemo } from "react";
import { Check, Plus } from "lucide-react";
import { formatDate, formatTime } from "../lib/formatDate.js";
import { formatGhs } from "../lib/money.js";
import { PosCard, PosPage, PosPrimaryButton, PosSecondaryButton } from "./PosComponents.jsx";
import { posText as t } from "./i18n.js";
import { displayName } from "../lib/displayName.js";
import { getSaleReceiptDetails } from "./saleReceipt.js";
import { getSaleReceiptText, isReceiptTemplatesEnabled } from "./receiptTemplates.js";
import { getMomoDisplayLabel } from "./momoMapping.js";
import { normalizeWhatsAppPhone } from "../utils/whatsapp.js";
import { CopyReceiptButton, ReceiptFailedLine, ReceiptOfflineLine, SendReceiptButton, useReceiptActions } from "./ReceiptActions.jsx";

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

// The owe row's name: at most 10 characters, then an ellipsis (Owe line on 30).
const NAME_MAX = 10;
function shortName(name) {
  const chars = [...name];
  return chars.length > NAME_MAX ? `${chars.slice(0, NAME_MAX).join("").trimEnd()}…` : name;
}

function SaleSaved({ onDone }) {
  return (
    <PosPage className="flex flex-col gap-3">
      <section className="pt-2 text-center">
        <div data-check-circle="" className="mx-auto mb-3 grid h-20 w-20 place-items-center rounded-full bg-emerald-900 text-white">
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

export default function SaleRecorded({ transaction, creditResult, shopName, onDone, onNewSale }) {
  const receipt = useMemo(() => readReceipt(transaction, shopName), [transaction, shopName]);
  // A customer with a valid saved number (a sale with a part owed) is messaged directly; else the share sheet.
  const actions = useReceiptActions(receipt?.receiptText ?? "", normalizeWhatsAppPhone(creditResult?.phone ?? transaction?.customer_phone) ?? "");
  if (!receipt) return <SaleSaved onDone={onDone} />;
  const { details, receiptText } = receipt;
  // Records saved before MoMo verification was stored keep the translated plain label.
  const momoLabel = transaction?.momoVerification ? getMomoDisplayLabel(transaction) : t("saleRecorded.method.momo");
  const when = new Date(details.timestamp);
  const time = formatTime(when);
  const dateLabel = formatDate(when) === formatDate(new Date())
    ? t("saleRecorded.today")
    : formatDate(when);

  // Send receipt shows only with VITE_ENABLE_POS_RECEIPTS on (FEATURE_FLAGS.SHOW_POS_RECEIPTS).
  const receiptsOn = isReceiptTemplatesEnabled();
  const owedPesewas = transaction?.creditExtendedPesewas ?? 0;
  const paidPesewas = details.cashReceivedPesewas + details.momoReceivedPesewas;
  // Wiring 30: with an earlier balance one quiet line shows the customer's total (the figure 31 and Home show).
  const earlierBalance = creditResult?.previousDebtPesewas > 0 && Number.isSafeInteger(creditResult?.totalDebtPesewas);
  const isSplit = details.paymentMethod === "split";
  const customerName = transaction?.customer_name ?? transaction?.customerName ?? "";

  return (
    <PosPage className="flex flex-col gap-3">
      <section className="pt-2 text-center">
        <div data-check-circle="" className="mx-auto mb-3 grid h-20 w-20 place-items-center rounded-full bg-emerald-900 text-white">
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
            <strong className="shrink-0">{formatGhs(item.amountPesewas)}</strong>
          </div>
        )) : (
          <div className="flex justify-between gap-3 text-lg">
            <span>{t("saleRecorded.sale")}</span>
            <strong>{formatGhs(details.amountPesewas)}</strong>
          </div>
        )}
        <div className="border-t-2 border-dashed border-slate-400 pt-2">
          {/* A split, or a sale with a part on credit (Owe on 16): each paid part, then what is still owed.
              A zero part is left out unless the sale is a Cash + MoMo split. */}
          {isSplit || owedPesewas > 0 ? (
            <div className="flex flex-col gap-1 text-lg">
              {details.cashReceivedPesewas > 0 && (
                <div className="flex justify-between gap-2">
                  <span>{t("saleRecorded.method.cash")}</span>
                  <strong>{formatGhs(details.cashReceivedPesewas)}</strong>
                </div>
              )}
              {details.momoReceivedPesewas > 0 && (
                <div className="flex justify-between gap-2">
                  <span>{momoLabel}</span>
                  <strong>{formatGhs(details.momoReceivedPesewas)}</strong>
                </div>
              )}
              {owedPesewas > 0 && (
                <div className={paidPesewas > 0 || isSplit ? "border-t-2 border-dashed border-slate-400 pt-1" : undefined}>
                  {/* Owe line on 30 (final, 17 Nov 2026): the last row of the sale card. Label "{Name} owes" (name cut
                      at 10 characters with an ellipsis, one line) with "from this sale" small and grey under it;
                      the amount bold dark red on the right, centred against the two lines. */}
                  <div data-owe-row="" className="flex items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span data-owe-label="" className="block whitespace-nowrap">
                        {customerName ? t("saleRecorded.owesLabel", { name: shortName(displayName(customerName)) }) : t("saleRecorded.owedLabel")}
                      </span>
                      <span data-owe-sub="" className="block text-sm text-slate-700">{t("saleRecorded.fromThisSale")}</span>
                    </span>
                    <strong data-owe-amount="" className="shrink-0 whitespace-nowrap text-rose-900">{formatGhs(owedPesewas)}</strong>
                  </div>
                  {earlierBalance && (
                    <p data-total-owed="" className="text-base text-slate-700">{t("saleRecorded.totalOwed", { amount: formatGhs(creditResult.totalDebtPesewas) })}</p>
                  )}
                </div>
              )}
            </div>
            ) : (
              <div className="flex justify-between gap-2 text-lg">
                <span>{details.paymentMethod === "momo" ? momoLabel : t(`saleRecorded.method.${details.paymentMethod}`)}</span>
                <strong>{formatGhs(details.amountPesewas)}</strong>
              </div>
            )}
        </div>
      </PosCard>

      {/* Buttons on 30 (17 Nov 2026): all stacked, full width, never side by side. Send receipt (other, WhatsApp
          icon), the offline line 8px under it, Copy receipt (other), Done (other), New sale (main). The receipt
          buttons only with the receipts flag on. */}
      {/* As on 31: the stack follows the card and the main button sits at the bottom. */}
      {receiptsOn && (
        <div className="flex flex-col gap-2">
          <SendReceiptButton look="other" onClick={() => void actions.send()} />
          <ReceiptOfflineLine online={actions.online} />
        </div>
      )}
      {receiptsOn && <CopyReceiptButton look="other" onClick={() => void actions.copy()} copied={actions.copied} />}
      {receiptsOn && <ReceiptFailedLine failed={actions.failed} />}
      <PosSecondaryButton type="button" className="w-full" onClick={onDone}>
        {t("saleRecorded.done")}
      </PosSecondaryButton>
      <PosPrimaryButton type="button" onClick={onNewSale} className="mt-auto h-[68px] text-2xl">
        <Plus size={28} aria-hidden="true" />{t("saleRecorded.newSale")}
      </PosPrimaryButton>
    </PosPage>
  );
}
