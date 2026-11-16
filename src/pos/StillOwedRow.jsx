import { UserRound } from "lucide-react";
import { displayName } from "../lib/displayName.js";
import { formatGhs } from "../lib/money.js";
import { posText as t } from "./i18n.js";

// The quiet pink "Still owed · {Name}" line (wiring 19 "Owe in the draft panel" and "Still owed row,
// all flows"): the customer's balance after this sale and today's payment. Shown on 19 under "Total
// today" and on 27 (opened from 26 or 19) where the screen shows a payment total but no balance.
// Nothing is shown when nothing remains owed.
export default function StillOwedRow({ amountPesewas, customerName }) {
  if (!(amountPesewas > 0)) return null;
  const name = displayName(customerName ?? "");
  return (
    <div data-still-owed="" className="mt-2 flex min-w-0 items-center justify-between gap-3 rounded-xl bg-rose-100 px-3 py-2 font-extrabold text-rose-900">
      <span className="flex min-w-0 items-center gap-2">
        <UserRound size={18} className="shrink-0" aria-hidden="true" />
        <span className="min-w-0 [overflow-wrap:anywhere]">{name ? t("credit.stillOwedName", { name }) : t("credit.stillOwed")}</span>
      </span>
      <span data-paying-today-amount="" className="shrink-0 whitespace-nowrap tabular-nums">{formatGhs(amountPesewas)}</span>
    </div>
  );
}
