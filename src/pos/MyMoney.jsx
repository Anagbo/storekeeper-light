import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { db } from "../db/db.js";
import { formatGhs, formatGhsAmount, getFinancialTransactions } from "../lib/money.js";
import { posText as t } from "./i18n.js";
import { getMoneyPeriodRange, getPreviousMoneyPeriodRange } from "./money.js";
import { SHOW_PROFIT_PREFERENCE, buildMyMoneyReport, loadAverageWeeklyProfit } from "./myMoneyReport.js";
import { PosCard, PosPage } from "./PosComponents.jsx";

// Brief 3.11 / wiring screen 33. One strong green block (Money left); every other card is white
// with a thin border.
const COMPARISON_KEYS = {
  week: { more: "money.moreThanLastWeek", less: "money.lessThanLastWeek", same: "money.sameAsLastWeek" },
  month: { more: "money.moreThanLastMonth", less: "money.lessThanLastMonth", same: "money.sameAsLastMonth" }
};
const cardClass = "min-w-0 rounded-[18px] border-2 border-slate-300 bg-white px-3.5 py-3";

export default function MyMoney({ onNavigate }) {
  const [period, setPeriod] = useState("week");
  const ranges = useMemo(() => ({
    current: getMoneyPeriodRange(period),
    previous: getPreviousMoneyPeriodRange(period)
  }), [period]);
  const report = useLiveQuery(async () => {
    const [currentTransactions, previousTransactions, debts, allTransactions, suppliers, profitSetting] = await Promise.all([
      getFinancialTransactions(ranges.current),
      getFinancialTransactions(ranges.previous),
      db.debts.where("status").equals("unpaid").toArray(),
      db.transactions.toArray(),
      db.suppliers.toArray(),
      db.settings.get(SHOW_PROFIT_PREFERENCE)
    ]);
    const showProfit = profitSetting?.value !== false;
    const averageProfitPesewas = showProfit && period === "week" ? await loadAverageWeeklyProfit(ranges.current) : null;
    return buildMyMoneyReport({ currentTransactions, previousTransactions, debts, allTransactions, suppliers, showProfit, averageProfitPesewas });
  }, [period, ranges.current.start, ranges.current.end, ranges.previous.start, ranges.previous.end], null);
  const periodLabel = period === "week" ? t("money.thisWeek").toLowerCase() : t("money.thisMonth").toLowerCase();
  const summary = report?.summary;
  const comparison = report?.comparison;

  return (
    <PosPage style={{ paddingTop: 10 }} className="flex flex-col gap-2.5 lg:min-h-0 lg:grid lg:grid-cols-2 lg:content-start lg:items-start lg:gap-5">
      <div className="flex items-center gap-3 lg:col-span-2">
        <button type="button" onClick={() => onNavigate("Home")} aria-label={t("money.backHome")} className="flex h-11 items-center gap-2 rounded-[14px] border-2 border-slate-900 bg-white px-3 text-base font-extrabold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 sm:h-[52px] sm:px-4 sm:text-lg"><ArrowLeft size={22} aria-hidden="true" />{t("money.back")}</button>
        <h1 className="text-xl font-extrabold sm:text-2xl">{t("money.title")}</h1>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:col-span-2 lg:max-w-xl" role="group" aria-label={t("money.choosePeriod")}>
        {[["week", "money.thisWeek"], ["month", "money.thisMonth"]].map(([value, label]) => (
          <button key={value} type="button" aria-pressed={period === value} onClick={() => setPeriod(value)} className={`h-11 rounded-[14px] border-2 px-3 text-base font-extrabold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 sm:h-[52px] sm:text-lg ${period === value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-500 bg-white text-slate-950"}`}>{t(label)}</button>
        ))}
      </div>

      {!report ? (
        <PosCard><p className="text-base font-semibold">{t("money.loading")}</p></PosCard>
      ) : (
        <>
          <section className="amount-fit-container rounded-[20px] bg-emerald-900 px-4 py-3 text-white lg:col-span-2 lg:p-6">
            <p className="text-base font-bold sm:text-lg">{t("money.moneyLeft", { period: periodLabel })}</p>
            <p className="amount-fit font-extrabold leading-tight">{formatGhs(summary.moneyLeft)}</p>
            {comparison && (
              <p className="text-base leading-snug sm:text-lg">{t(COMPARISON_KEYS[period][comparison.kind], { amount: formatGhs(comparison.amountPesewas) })}</p>
            )}
            <p className="text-sm leading-snug sm:text-base">{t("money.moneyInMinusSpent")}</p>
          </section>

          <div className="grid min-w-0 grid-cols-2 gap-2 lg:col-span-2 lg:gap-5">
            <section className={`amount-fit-container flex flex-col gap-0.5 ${cardClass}`}>
              <p className="text-base font-extrabold sm:text-lg">{t("money.moneyIn")}</p>
              <p className="amount-fit font-extrabold leading-tight">{formatGhs(summary.moneyIn)}</p>
              {summary.moneyIn > 0 && (
                <p className="break-words text-sm leading-snug text-slate-800 sm:text-base">{t("money.cashMomo", { cash: formatGhs(summary.cashIn), momo: formatGhs(summary.momoIn) })}</p>
              )}
            </section>
            <section className={`amount-fit-container flex flex-col gap-0.5 ${cardClass}`}>
              <p className="flex items-center gap-1 text-base font-extrabold sm:text-lg"><ArrowUpRight size={18} className="shrink-0" aria-hidden="true" /> {t("money.moneySpent")}</p>
              <p className="amount-fit font-extrabold leading-tight">{formatGhs(summary.moneySpent)}</p>
              {summary.moneySpent > 0 && (
                <p className="break-words text-sm leading-snug text-slate-800 sm:text-base">{t("money.stockOther", { stock: formatGhs(summary.spentStock), other: formatGhs(summary.spentOther) })}</p>
              )}
            </section>
          </div>

          {report.showProfit && (
            <section className={`amount-fit-container flex flex-col gap-0.5 lg:col-span-2 ${cardClass}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-lg font-extrabold">{t("money.estimatedProfit")}</p>
                <span className="rounded-[10px] border-2 border-slate-500 bg-slate-100 px-2 text-[15px] font-extrabold text-slate-950">{t("money.estimate")}</span>
              </div>
              <p className="amount-fit font-extrabold leading-tight text-emerald-900">{formatGhs(summary.profit)}</p>
              <p className="break-words text-sm leading-snug text-slate-800 sm:text-base">{t("money.profitSum", { sales: formatGhsAmount(summary.sales), stock: formatGhsAmount(summary.stockBought), other: formatGhsAmount(summary.otherCosts) })}</p>
              {report.averageProfitPesewas !== null && period === "week" && (
                <p className="text-sm leading-snug text-slate-800 sm:text-base">{t("money.averageFourWeeks", { amount: formatGhs(report.averageProfitPesewas) })}</p>
              )}
            </section>
          )}

          <div className="grid min-w-0 grid-cols-2 gap-2 lg:col-span-2 lg:gap-5">
            <button type="button" onClick={() => onNavigate("PeopleWhoOweYou")} className="amount-fit-container min-w-0 rounded-[16px] border-2 border-l-[6px] border-slate-300 border-l-rose-900 bg-white px-2.5 py-2 text-left text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 sm:px-3">
              <span className="block text-[15px] font-extrabold leading-snug sm:text-[17px]">{t("money.owedToYou")}</span>
              <span className="amount-fit block font-extrabold leading-tight text-rose-900">{formatGhs(report.debtPesewas)}</span>
              <span className="block text-base font-extrabold text-emerald-900 sm:text-[17px]">{t("money.seeWho")}</span>
            </button>
            <button type="button" onClick={() => onNavigate("YouOweSuppliers")} className="amount-fit-container min-w-0 rounded-[16px] border-2 border-l-[6px] border-slate-300 border-l-amber-700 bg-white px-2.5 py-2 text-left text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 sm:px-3">
              <span className="block text-[15px] font-extrabold leading-snug sm:text-[17px]">{t("money.supplierBalances")}</span>
              <span className="amount-fit block font-extrabold leading-tight text-amber-900">{formatGhs(report.supplierBalancePesewas)}</span>
              <span className="block text-base font-extrabold text-emerald-900 sm:text-[17px]">{t("money.seeList")}</span>
            </button>
          </div>
        </>
      )}
    </PosPage>
  );
}
