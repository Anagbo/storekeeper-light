import { Check } from "lucide-react";
import { EventDetail, KeyValueRows } from "./EventRows.jsx";
import { formatGhs } from "../lib/money.js";
import { posText as t } from "./i18n.js";
import { SOFT_TILE, SOFT_TILE_DIVIDERS } from "./softTile.js";

// rules_global.saved_credit_layout (25 Nov 2026): one layout for Saved as credit after a sale on credit
// and after Add debt. The tick, "Saved as credit", one large line "{name} owes GH₵X" (the name appears once),
// a line under it (This sale GH₵X, or For: the reason), then the card: Before, This sale (or Added to
// debt), Paid today (only when something was paid), Now owes, and the plan line when a plan exists.
// Paid today is one row. Its label names the method when there is one and is plain "Paid today" when two
// methods were used, so the label never wraps. There is no waiting line: by now every MoMo part listed
// is confirmed (the owner tapped Money received on the Customer sends screen).
export function paidTodayLabel(parts, fallbackMethod = "cash") {
  const methods = [...new Set((parts ?? []).filter((part) => part.amountPesewas > 0).map((part) => part.paymentMethod === "momo" ? "momo" : "cash"))];
  if (methods.length > 1) return t("credit.paidToday");
  const method = methods[0] ?? (fallbackMethod === "momo" ? "momo" : "cash");
  return t("credit.paidTodayMethod", { method: t(`credit.method.${method}`) });
}

export default function SavedCreditSummary({ name, owesPesewas, subline, beforePesewas, addedLabel, addedPesewas, paidPesewas = 0, parts, fallbackMethod, planLine }) {
  return (
    <>
      <div className="pt-2 text-center">
        <div className="mx-auto mb-2 grid h-20 w-20 place-items-center rounded-full bg-emerald-900 text-white"><Check size={44} aria-hidden="true" /></div>
        <h1 className="text-xl font-bold">{t("credit.saved")}</h1>
        <p data-saved-owes="" className="mt-1 min-w-0 text-2xl font-extrabold leading-tight text-[#0F172A] [overflow-wrap:anywhere] sm:text-4xl">{t("credit.customerOwes", { name, amount: formatGhs(owesPesewas) })}</p>
        {subline && <p data-saved-subline="" className="mt-1 text-[17px] text-slate-700">{subline}</p>}
      </div>
      {/* The soft card (rules_global.soft_tiles: a read-only block is the soft tile, #F1F5F9, no border,
          #E2E8F0 row dividers). */}
      <KeyValueRows name="saved-credit" data-debt-saved-rows="" className={`${SOFT_TILE} ${SOFT_TILE_DIVIDERS} px-4 py-2 text-left [&>div:first-child]:border-t-0 [&>div:first-child]:pt-0`}>
        <EventDetail label={t("credit.before")} name="before">{formatGhs(beforePesewas)}</EventDetail>
        <EventDetail label={addedLabel} name="added">{formatGhs(addedPesewas)}</EventDetail>
        {paidPesewas > 0 && <EventDetail label={paidTodayLabel(parts, fallbackMethod)} name="paid-today">{`− ${formatGhs(paidPesewas)}`}</EventDetail>}
        <EventDetail label={t("credit.nowOwes")} name="now-owes">{formatGhs(owesPesewas)}</EventDetail>
      </KeyValueRows>
      {planLine && <p data-saved-plan="" className="text-center text-[17px] font-bold text-[#0F172A]">{planLine}</p>}
    </>
  );
}
