import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowUpRight } from "lucide-react";
import { saveHideAmounts } from "../db/preferences.js";
import { Amount, amountText, HideAmountsButton } from "./HiddenAmount.jsx";
import { posText as t } from "./i18n.js";
import { PHONE_LAYOUT } from "./layout.js";
import { loadMyMoneyReport } from "./myMoneyReport.js";
import { PosBackButton, PosCard, PosPage } from "./PosComponents.jsx";

// Brief 3.11 / wiring screen 33. One strong green block (Money left); every other card is white
// with a thin border. Every figure follows the period except Owed to you and You owe suppliers.
export const MY_MONEY_PERIODS = [["day", "money.today"], ["week", "money.thisWeek"], ["month", "money.thisMonth"]];
const PERIOD_WORDS = { day: "money.periodToday", week: "money.periodThisWeek", month: "money.periodThisMonth" };
// While amounts are hidden the comparison line must not say up or down (wiring 33 Hide amounts).
const HIDDEN_COMPARISON_KEYS = { day: "money.comparedWithYesterday", week: "money.comparedWithLastWeek", month: "money.comparedWithLastMonth" };
const COMPARISON_KEYS = {
  day: { more: "money.moreThanYesterday", less: "money.lessThanYesterday", same: "money.sameAsYesterday" },
  week: { more: "money.moreThanLastWeek", less: "money.lessThanLastWeek", same: "money.sameAsLastWeek" },
  month: { more: "money.moreThanLastMonth", less: "money.lessThanLastMonth", same: "money.sameAsLastMonth" }
};
const cardClass = "min-w-0 rounded-[18px] border-2 border-slate-300 bg-white px-3.5 py-3";

// One label and amount on a line; the amount never wraps or shrinks. `tone` colours the whole row and
// makes the label bold (Debts paid, On credit): text only, no fill and no border.
function Row({ label, amountPesewas, hidden, tone = "", ...rest }) {
  return (
    <p {...rest} className={`flex min-w-0 items-baseline justify-between gap-3 text-base sm:text-lg ${tone}`}>
      <span className={`min-w-0 ${tone ? "font-bold" : ""}`}>{label}</span>
      <strong className="shrink-0 whitespace-nowrap"><Amount hidden={hidden} pesewas={amountPesewas} /></strong>
    </p>
  );
}

function CardTitle({ children, amountPesewas, hidden }) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
      <p className="flex items-center gap-1 text-base font-extrabold sm:text-lg">{children}</p>
      {amountPesewas !== undefined && <p className="whitespace-nowrap text-xl font-extrabold"><Amount hidden={hidden} pesewas={amountPesewas} /></p>}
    </div>
  );
}

// Back returns to the screen My money was opened from (Home, or the page under the Menu drawer, wiring
// 23); with nothing behind it, Home (wiring 33: Back to 22).
// layout comes from PosApp (layout.js, the one decision). D7 from 1024px (layout.wideMyMoney); below that
// the phone layout. On every wide screen (rail or sidebar) Back is not shown: the sidebar reaches every
// page (wide_layout.same_as_phone (b)).
export default function MyMoney({ onNavigate, onBack = () => onNavigate("Home"), layout = PHONE_LAYOUT }) {
  const wide = layout.wideMyMoney;
  const w = (wideClasses, phoneClasses = "") => (wide ? wideClasses : phoneClasses);
  const [period, setPeriod] = useState("day");
  // The day the report is for is fixed when the period is chosen, so the screen does not re-read at midnight.
  const now = useMemo(() => new Date(), [period]);
  const report = useLiveQuery(() => loadMyMoneyReport({ period, now }), [period, now.getTime()], null);
  const periodWords = t(PERIOD_WORDS[period]);
  const summary = report?.summary;
  const comparison = report?.comparison;
  // Hidden until the setting is known to be false: a real amount never flashes.
  const hidden = report?.hideAmounts !== false;
  const toggleHidden = () => saveHideAmounts(!hidden).catch(() => {});

  return (
    // Wide layout (D7): the title with the period selector at the top right; Money left and
    // the profit card side by side; the three cards Money in, Money spent and What you should have left
    // in one row; then the two balance tiles. Same content and order of reading as the phone.
    <PosPage wide={layout.wide} style={layout.wide ? undefined : { paddingTop: 10 }} className={`${w("grid min-h-0 grid-cols-2 content-start items-stretch gap-5", "flex flex-col gap-2.5")} ${layout.wide ? "tabular-nums" : ""}`}>
      <div data-wide-header="" className={w("col-span-2 flex flex-row items-center justify-between gap-5", "flex flex-col gap-2.5")}>
      <div data-title-row="" className="flex items-center gap-3">
        {!layout.wide && <PosBackButton onClick={onBack} aria-label={t("money.back")} />}
        <h1 className={layout.wide ? "min-w-0 text-[30px] font-extrabold leading-tight" : "min-w-0 text-xl font-extrabold sm:text-2xl"}>{t("money.title")}</h1>
        <HideAmountsButton hidden={hidden} onToggle={toggleHidden} disabled={!report} className={`border-[#0F172A] bg-white text-[#0F172A] ${w("ml-0", "ml-auto")}`} />
      </div>

      {/* (0) Today / This week / This month: three equal buttons, 16px, one line each at 340px. */}
      <div data-periods="" className={`grid grid-cols-3 gap-1 sm:gap-2 ${w("w-[420px] shrink-0")}`} role="group" aria-label={t("money.choosePeriod")}>
        {MY_MONEY_PERIODS.map(([value, label]) => (
          <button key={value} type="button" aria-pressed={period === value} onClick={() => setPeriod(value)} className={`h-11 min-w-0 whitespace-nowrap rounded-[14px] border-2 px-0 text-base font-extrabold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 sm:h-[52px] ${period === value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-500 bg-white text-slate-950"}`}>{t(label)}</button>
        ))}
      </div>
      </div>

      {!report ? (
        <PosCard className={w("col-span-2")}><p className="text-base font-semibold">{t("money.loading")}</p></PosCard>
      ) : (
        <>
          {/* (1) The one strong block (wide: beside the profit card, or the full row when it is hidden). */}
          <section data-block="money-left" className={`amount-fit-container rounded-[20px] bg-emerald-900 px-4 py-3 text-white ${w(`order-1 p-6 ${report.showProfit ? "" : "col-span-2"}`)}`}>
            <p className="text-base font-bold sm:text-lg">{t("money.moneyLeft", { period: periodWords })}</p>
            <p className="amount-fit font-extrabold leading-tight"><Amount hidden={hidden} pesewas={summary.moneyLeft} /></p>
            {comparison && (
              <p className="text-base leading-snug sm:text-lg">{amountText(hidden ? HIDDEN_COMPARISON_KEYS[period] : COMPARISON_KEYS[period][comparison.kind], { amount: comparison.amountPesewas }, hidden)}</p>
            )}
            <p className="text-sm leading-snug sm:text-base">{t("money.moneyInMinusSpent")}</p>
          </section>

          {(report.uncounted?.sales > 0 || report.uncounted?.other > 0) && (
            <div className={`flex flex-col gap-0.5 px-1 ${w("order-3 col-span-2")}`}>
              {report.uncounted.sales > 0 && <p className="text-sm text-slate-700 sm:text-base">{report.uncounted.sales === 1 ? t("money.uncountedSale") : t("money.uncountedSales", { n: report.uncounted.sales })}</p>}
              {report.uncounted.other > 0 && <p className="text-sm text-slate-700 sm:text-base">{report.uncounted.other === 1 ? t("money.uncountedRecord") : t("money.uncountedRecords", { n: report.uncounted.other })}</p>}
            </div>
          )}

          <div data-method-cards="" className={`grid min-w-0 ${w("order-4 col-span-2 grid-cols-3 gap-5", "gap-2.5")}`}>
            {/* (2) Money in: Cash + MoMo = Money in. Under a thicker line, Debts paid (already inside Cash
                and MoMo, never added again) and On credit (= Given on credit on 24, not money received);
                each row only when above zero. */}
            <section data-card="money-in" className={`flex flex-col gap-1 ${cardClass}`}>
              <CardTitle hidden={hidden} amountPesewas={summary.moneyIn}>{t("money.moneyIn")}</CardTitle>
              <Row data-row="cash-in" label={t("money.cash")} hidden={hidden} amountPesewas={summary.cashIn} />
              <Row data-row="momo-in" label={t("money.momo")} hidden={hidden} amountPesewas={summary.momoIn} />
              {(summary.collectedIn > 0 || summary.givenOnCredit > 0) && (
                <div data-line="money-in-extras" className="mt-1 flex flex-col gap-1 border-t-[3px] border-slate-300 pt-1.5">
                  {summary.collectedIn > 0 && <Row data-row="debts-paid" tone="text-emerald-900" label={t("money.debtsPaid")} hidden={hidden} amountPesewas={summary.collectedIn} />}
                  {summary.givenOnCredit > 0 && <Row data-row="on-credit" tone="text-rose-900" label={t("money.onCredit")} hidden={hidden} amountPesewas={summary.givenOnCredit} />}
                </div>
              )}
            </section>

            {/* (3) Money spent: Paid in cash + Paid by MoMo + Method not recorded = Money spent. */}
            <section data-card="money-spent" className={`flex flex-col gap-1 ${cardClass}`}>
              <CardTitle hidden={hidden} amountPesewas={summary.moneySpent}><ArrowUpRight size={18} className="shrink-0" aria-hidden="true" /> {t("money.moneySpent")}</CardTitle>
              <Row data-row="cash-spent" label={t("money.paidInCash")} hidden={hidden} amountPesewas={summary.spentCash} />
              <Row data-row="momo-spent" label={t("money.paidByMomo")} hidden={hidden} amountPesewas={summary.spentMomo} />
              {summary.spentUnrecorded > 0 && <Row data-row="unrecorded-spent" label={t("money.methodNotRecorded")} hidden={hidden} amountPesewas={summary.spentUnrecorded} />}
            </section>

            {/* (4) What you should have left, this period only. */}
            <section data-card="should-have-left" className={`flex flex-col gap-1 ${cardClass}`}>
              <CardTitle>{t("money.shouldHaveLeft")}</CardTitle>
              <Row data-row="cash-left" label={t("money.cash")} hidden={hidden} amountPesewas={summary.cashShouldHave} />
              <Row data-row="momo-left" label={t("money.momo")} hidden={hidden} amountPesewas={summary.momoShouldHave} />
              <p className="text-sm leading-snug text-slate-700 sm:text-base">{t("money.shouldHaveLeftCaption")}</p>
            </section>
          </div>

          {/* (5) The profit card follows the period. */}
          {report.showProfit && (
            <section data-card="profit" className={`amount-fit-container flex flex-col gap-0.5 ${w("order-2")} ${cardClass}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-lg font-extrabold">{t("money.estimatedProfit")}</p>
                <span className="rounded-[10px] border-2 border-slate-500 bg-slate-100 px-2 text-[15px] font-extrabold text-slate-950">{t("money.estimate")}</span>
              </div>
              <p className="amount-fit font-extrabold leading-tight text-emerald-900"><Amount hidden={hidden} pesewas={summary.profit} /></p>
              <p className="break-words text-sm leading-snug text-slate-800 sm:text-base">{amountText("money.profitSum", { sales: summary.sales, stock: summary.stockBought, other: summary.otherCosts }, hidden)}</p>
              {report.averageProfitPesewas !== null && period === "week" && (
                <p className="text-sm leading-snug text-slate-800 sm:text-base">{amountText("money.averageFourWeeks", { amount: report.averageProfitPesewas }, hidden)}</p>
              )}
            </section>
          )}

          {/* (6) Balances right now: they do not change with the period. */}
          <div data-tiles="" className={`grid min-w-0 grid-cols-2 ${w("order-5 col-span-2 gap-5", "gap-2")}`}>
            <button type="button" onClick={() => onNavigate("PeopleWhoOweYou")} className="amount-fit-container min-w-0 rounded-[16px] border-2 border-l-[6px] border-slate-300 border-l-rose-900 bg-white px-2.5 py-2 text-left text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 sm:px-3">
              <span className="block text-[15px] font-extrabold leading-snug sm:text-[17px]">{t("money.owedToYou")}</span>
              <span className="amount-fit block font-extrabold leading-tight text-rose-900"><Amount hidden={hidden} pesewas={report.debtPesewas} /></span>
              <span className="block text-base font-extrabold text-emerald-900 sm:text-[17px]">{t("money.seeWho")}</span>
            </button>
            <button type="button" onClick={() => onNavigate("YouOweSuppliers")} className="amount-fit-container min-w-0 rounded-[16px] border-2 border-l-[6px] border-slate-300 border-l-amber-700 bg-white px-2.5 py-2 text-left text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 sm:px-3">
              <span className="block text-[15px] font-extrabold leading-snug sm:text-[17px]">{t("money.supplierBalances")}</span>
              <span className="amount-fit block font-extrabold leading-tight text-amber-900"><Amount hidden={hidden} pesewas={report.supplierBalancePesewas} /></span>
              <span className="block text-base font-extrabold text-emerald-900 sm:text-[17px]">{t("money.seeList")}</span>
            </button>
          </div>
        </>
      )}
    </PosPage>
  );
}
