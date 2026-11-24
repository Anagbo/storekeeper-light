import { UserRound } from "lucide-react";
import { displayName } from "../lib/displayName.js";
import { formatGhs } from "../lib/money.js";
import { posText as t } from "./i18n.js";

// The quiet "Still owed · {Name}" line (wiring 19 "Owe in the draft panel" and "Still owed row,
// all flows"): the customer's balance after this sale and today's payment. Shown on 19 under "Total
// today" and on 27 (opened from 26 or 19) where the screen shows a payment total but no balance.
// Nothing is shown when nothing remains owed.
// neutral (19, inside the soft tile): a white row. Otherwise (27, on a white page) the soft fill #F1F5F9.
// Both bold neutral #0F172A, no pink, no dark red (rules_global.soft_tiles, phone sweep, 24 Nov 2026).
export default function StillOwedRow({ amountPesewas, customerName, neutral = false }) {
  if (!(amountPesewas > 0)) return null;
  const name = displayName(customerName ?? "");
  const look = neutral ? "bg-white px-3 py-2 font-bold text-[#0F172A]" : "bg-[#F1F5F9] px-3 py-2 font-bold text-[#0F172A]";
  return (
    <div data-still-owed="" className={`mt-2 flex min-w-0 items-center justify-between gap-3 rounded-xl ${look}`}>
      <span className="flex min-w-0 items-center gap-2">
        <UserRound size={18} className="shrink-0" aria-hidden="true" />
        <span className="min-w-0 [overflow-wrap:anywhere]">{name ? t("credit.stillOwedName", { name }) : t("credit.stillOwed")}</span>
      </span>
      <span data-paying-today-amount="" className="shrink-0 whitespace-nowrap tabular-nums">{formatGhs(amountPesewas)}</span>
    </div>
  );
}
