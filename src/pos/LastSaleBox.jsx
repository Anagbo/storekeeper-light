import { useEffect, useState } from "react";
import { formatTime } from "../lib/formatDate.js";
import { formatGhs } from "../lib/money.js";
import { posText as t } from "./i18n.js";
import { loadLastSaleToday } from "./lastSale.js";

const METHOD_LABELS = {
  cash: "sell.cash",
  momo: "sell.momo",
  split: "sell.lastSaleSplit",
  credit: "sell.lastSaleOnCredit",
  part_paid: "sell.lastSalePartPaid"
};

// Wide 15 (D2, D15): the quiet "Last sale" box. Read-only and not tappable; hidden when there is no
// sale today. It loads after Sell has drawn (an effect), so it never holds up the pad.
export default function LastSaleBox({ load = loadLastSaleToday }) {
  const [sale, setSale] = useState(null);
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => load())
      .then((found) => { if (live) setSale(found ?? null); })
      .catch((error) => console.warn("Could not read the last sale.", error));
    return () => { live = false; };
  }, []);
  if (!sale) return null;
  return (
    <section aria-label={t("sell.lastSale")} data-last-sale="" className="rounded-[20px] border-2 border-slate-300 bg-slate-50 px-4 py-3">
      <p className="text-[17px] font-bold text-slate-600">{t("sell.lastSale")}</p>
      <p className="mt-0.5 flex flex-wrap text-[17px] items-baseline justify-between gap-x-3">
        <b className="text-[19px] font-bold text-slate-900 tabular-nums">{formatGhs(sale.amountPesewas)} · {t(METHOD_LABELS[sale.method] ?? "sell.cash")}</b>
        <span className="text-[17px] text-slate-600 tabular-nums">{formatTime(sale.timestamp)}</span>
      </p>
    </section>
  );
}
