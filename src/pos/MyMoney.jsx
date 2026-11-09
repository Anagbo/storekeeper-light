import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpRight } from "lucide-react";
import { db } from "../db/db.js";
import { formatGhs, getFinancialTransactions, summarizePosMoney } from "../lib/money.js";
import { getSupplierBalances } from "../utils/suppliers.js";
import { posText as t } from "./i18n.js";
import { getMoneyPeriodRange, getOutstandingDebtPesewas, getPreviousMoneyPeriodRange } from "./money.js";
import { PosCard, PosPage } from "./PosComponents.jsx";

export default function MyMoney({ onNavigate }) {
  const [period, setPeriod] = useState("week");
  const ranges = useMemo(() => ({
    current: getMoneyPeriodRange(period),
    previous: getPreviousMoneyPeriodRange(period)
  }), [period]);
  const report = useLiveQuery(async () => {
    const [currentTransactions, previousTransactions, debts, allTransactions, suppliers] = await Promise.all([
      getFinancialTransactions(ranges.current),
      getFinancialTransactions(ranges.previous),
      db.debts.where("status").equals("unpaid").toArray(),
      db.transactions.toArray(),
      db.suppliers.toArray()
    ]);
    const totals = summarizePosMoney(currentTransactions);
    const previousTotals = summarizePosMoney(previousTransactions);
    return {
      totals,
      previousCashLeft: previousTotals.cashLeft,
      debtPesewas: getOutstandingDebtPesewas(debts),
      supplierBalancePesewas: getSupplierBalances(allTransactions, suppliers)
        .reduce((sum, supplier) => sum + supplier.balancePesewas, 0)
    };
  }, [period, ranges.current.start, ranges.current.end, ranges.previous.start, ranges.previous.end], null);
  const periodLabel = period === "week" ? t("money.thisWeek").toLowerCase() : t("money.thisMonth").toLowerCase();
  const difference = report ? report.totals.cashLeft - report.previousCashLeft : 0;

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
          <section className="amount-fit-container rounded-[18px] border-[3px] border-emerald-900 bg-green-200 px-3 py-2 lg:col-span-2 lg:rounded-[20px] lg:p-6">
            <p className="text-base font-extrabold text-emerald-900 sm:text-lg">{t("money.cashLeftWeekLabel", { period: periodLabel })}</p>
            <p className="amount-fit font-extrabold leading-tight text-green-950">{formatGhs(report.totals.cashLeft)}</p>
            <p className="flex items-start gap-1.5 text-base font-extrabold leading-snug text-emerald-900 sm:text-lg">
              {difference >= 0 ? <ArrowUp size={20} className="mt-0.5 shrink-0" aria-hidden="true" /> : <ArrowDown size={20} className="mt-0.5 shrink-0" aria-hidden="true" />}
              {t(difference >= 0 ? "money.up" : "money.down")} {formatGhs(Math.abs(difference))} {t(period === "week" ? "money.fromLastWeek" : "money.fromLastMonth")}
            </p>
            <p className="text-sm text-slate-800 sm:text-base">{t("money.moneyInMinusSpent")}</p>
          </section>

          <div className="grid min-w-0 grid-cols-2 gap-2 lg:col-span-2 lg:gap-5">
            <section className="amount-fit-container flex min-w-0 flex-col gap-0.5 rounded-[16px] border-2 border-slate-500 bg-white p-2.5 sm:p-3">
              <p className="text-base font-extrabold sm:text-lg">{t("money.moneyIn")}</p>
              <p className="amount-fit font-extrabold leading-tight">{formatGhs(report.totals.moneyIn)}</p>
              <p className="break-words text-sm leading-snug text-slate-800 sm:text-base">{t("money.cashMomo", { cash: formatGhs(report.totals.cashIn), momo: formatGhs(report.totals.momoIn) })}</p>
            </section>
            <section className="amount-fit-container flex min-w-0 flex-col gap-0.5 rounded-[16px] border-2 border-slate-500 bg-white p-2.5 sm:p-3">
              <p className="flex items-center gap-1 text-base font-extrabold sm:text-lg"><ArrowUpRight size={18} className="shrink-0" aria-hidden="true" /> {t("money.moneySpent")}</p>
              <p className="amount-fit font-extrabold leading-tight">{formatGhs(report.totals.moneySpent)}</p>
              <p className="text-sm leading-snug text-slate-800 sm:text-base">{t("money.spendingBreakdownUnavailable")}</p>
            </section>
          </div>

          <div className="grid min-w-0 grid-cols-2 gap-2 lg:col-span-2 lg:gap-5">
            <button type="button" onClick={() => onNavigate("PeopleWhoOweYou")} className="amount-fit-container min-w-0 rounded-[16px] border-[3px] border-rose-900 bg-rose-200 px-2.5 py-2 text-left text-rose-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-900 sm:px-3">
              <span className="block text-[15px] font-extrabold leading-snug sm:text-[17px]">{t("money.owedToYou")}</span>
              <span className="amount-fit block font-extrabold leading-tight">{formatGhs(report.debtPesewas)}</span>
              <span className="block text-sm font-bold sm:text-base">{t("money.seeWho")}</span>
            </button>
            <button type="button" onClick={() => onNavigate("YouOweSuppliers")} className="amount-fit-container min-w-0 rounded-[16px] border-[3px] border-amber-800 bg-amber-100 px-2.5 py-2 text-left text-amber-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800 sm:px-3">
              <span className="block text-[15px] font-extrabold leading-snug sm:text-[17px]">{t("money.supplierBalances")}</span>
              <span className="amount-fit block font-extrabold leading-tight">{formatGhs(report.supplierBalancePesewas)}</span>
              <span className="block text-sm font-bold sm:text-base">{t("money.seeList")}</span>
            </button>
          </div>

          <section className="flex flex-col gap-1 rounded-[18px] border-2 border-slate-500 bg-white px-4 py-3 lg:col-span-2 lg:p-5">
            <p className="text-[19px] font-extrabold">{t("money.wantProfit")}</p>
            <p className="text-base text-slate-700">{t("money.profitSettingsPrompt")}</p>
            <button type="button" onClick={() => onNavigate("SettingsProfitTools")} className="mt-1 h-[52px] rounded-[14px] border-2 border-emerald-900 bg-white text-lg font-extrabold text-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800">{t("money.openSettings")}</button>
          </section>
        </>
      )}
    </PosPage>
  );
}
