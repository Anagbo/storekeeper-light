import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowUpRight } from "lucide-react";
import { saveHideAmounts } from "../db/preferences.js";
import { Amount, amountText, HideAmountsButton } from "./HiddenAmount.jsx";
import { posText as t } from "./i18n.js";
import { PHONE_LAYOUT } from "./layout.js";
import { loadMyMoneyReport } from "./myMoneyReport.js";
import { PosBackButton, PosCard, PosPage, PosSecondaryButton } from "./PosComponents.jsx";
import { SOFT_HERO, SOFT_HERO_LABEL, SOFT_TILE } from "./softTile.js";

// Brief 3.11 / wiring screen 33. Money left is the soft hero, the same as Home (rules_global.soft_tiles,
// 24 Nov 2026); Where your money should be is a soft tile on the phone and a white card on wide; every other card is white with a thin border.
// No coloured left edge and no red or amber amounts (rules_global.left_edge_marker). Every figure follows the period except Owed to you and You owe suppliers.
export const MY_MONEY_PERIODS = [["day", "money.today"], ["week", "money.thisWeek"], ["month", "money.thisMonth"]];
const PERIOD_WORDS = { day: "money.periodToday", week: "money.periodThisWeek", month: "money.periodThisMonth" };
const cardClass = "min-w-0 rounded-[18px] border-2 border-slate-300 bg-white px-3.5 py-3";
// Wide (D7): one inner padding (24px) and 8px-grid gaps for every card; neutral dark amounts at 700.
const WIDE_CARD = "min-w-0 rounded-[18px] border-2 border-slate-300 bg-white p-6";
const softCard = (wide) => `min-w-0 ${SOFT_TILE} ${wide ? "p-6" : "px-3.5 py-3"}`;
const WIDE_AMOUNT = "whitespace-nowrap text-[40px] font-bold leading-tight text-[#0F172A]";
// Wide hero (D7): white card, 2px #CBD5E1 border, 20px radius, as on Home. Every wide card label is dark, 800, 17px or more.
const WIDE_HERO_CARD = "rounded-[20px] border-2 border-[#CBD5E1] bg-white text-[#0F172A]";
const WIDE_LABEL = "text-[18px] font-extrabold leading-snug text-[#0F172A]";
const WIDE_NOTE = "text-[17px] leading-snug";

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

function CardTitle({ children, amountPesewas, hidden, wide = false }) {
  return (
    <div className={wide ? "flex min-w-0 flex-col" : "flex min-w-0 flex-wrap items-baseline justify-between gap-x-3"}>
      <p className={wide ? "flex items-center gap-1 whitespace-nowrap text-[17px] font-extrabold text-[#0F172A]" : "flex items-center gap-1 text-base font-extrabold sm:text-lg"}>{children}</p>
      {amountPesewas !== undefined && <p className={wide ? "whitespace-nowrap text-2xl font-bold text-[#0F172A]" : "whitespace-nowrap text-xl font-extrabold"}><Amount hidden={hidden} pesewas={amountPesewas} /></p>}
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
  const card = wide ? WIDE_CARD : cardClass;
  const note = (phoneClasses) => (wide ? WIDE_NOTE : phoneClasses);
  const [period, setPeriod] = useState("day");
  // The day the report is for is fixed when the period is chosen, so the screen does not re-read at midnight.
  const now = useMemo(() => new Date(), [period]);
  const report = useLiveQuery(() => loadMyMoneyReport({ period, now }), [period, now.getTime()], null);
  const periodWords = t(PERIOD_WORDS[period]);
  const summary = report?.summary;
  // Hidden until the setting is known to be false: a real amount never flashes.
  const hidden = report?.hideAmounts !== false;
  const shouldBeTotal = summary ? summary.cashShouldHave + summary.momoShouldHave : 0;
  const toggleHidden = () => saveHideAmounts(!hidden).catch(() => {});

  return (
    // Wide layout (D7): the title with the period selector at the top right; Money left and
    // the profit card side by side; the three cards Money in, Money spent and Where your money should be
    // in one row; then the two balance tiles. Same content and order of reading as the phone.
    <PosPage wide={layout.wide} rail={layout.mode === "rail"} style={layout.wide ? undefined : { paddingTop: 10 }} className={`${w("grid min-h-0 grid-cols-2 content-start items-stretch gap-5", "flex flex-col gap-2.5")} ${layout.wide ? "tabular-nums" : ""}`}>
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
          {/* (1) The soft hero (wide: beside the profit card, or the full row when it is hidden). */}
          <section data-block="money-left" className={`amount-fit-container ${wide ? WIDE_HERO_CARD : `${SOFT_HERO} px-4 py-3`} ${w(`order-1 flex flex-col justify-center gap-2 p-6 ${report.showProfit ? "" : "col-span-2"}`, "amount-fit-hero")}`}>
            <p className={wide ? WIDE_LABEL : `text-base font-bold sm:text-lg ${SOFT_HERO_LABEL}`}>{t("money.moneyLeft", { period: periodWords })}</p>
            <p className={wide ? "whitespace-nowrap text-[56px] font-bold leading-tight" : "amount-fit font-extrabold leading-tight"}><Amount hidden={hidden} pesewas={summary.moneyLeft} /></p>
            <p className={`${note("text-sm leading-snug sm:text-base")} ${wide ? "text-[#0F172A]" : SOFT_HERO_LABEL}`}>{t("money.moneyInMinusSpent")}</p>
          </section>

          {(report.uncounted?.sales > 0 || report.uncounted?.other > 0) && (
            <div className={`flex flex-col gap-0.5 px-1 ${w("order-3 col-span-2")}`}>
              {report.uncounted.sales > 0 && <p className={wide ? "text-[17px] text-slate-700" : "text-sm text-slate-700 sm:text-base"}>{report.uncounted.sales === 1 ? t("money.uncountedSale") : t("money.uncountedSales", { n: report.uncounted.sales })}</p>}
              {report.uncounted.other > 0 && <p className={wide ? "text-[17px] text-slate-700" : "text-sm text-slate-700 sm:text-base"}>{report.uncounted.other === 1 ? t("money.uncountedRecord") : t("money.uncountedRecords", { n: report.uncounted.other })}</p>}
            </div>
          )}

          <div data-method-cards="" className={`grid min-w-0 ${w("order-4 col-span-2 grid-cols-3 gap-6", "gap-2.5")}`}>
            {/* (2) Money in: Cash + MoMo = Money in. Under a thicker line, Debts paid (already inside Cash
                and MoMo, never added again) and On credit (= Given on credit on 24, not money received);
                each row only when above zero. */}
            <section data-card="money-in" className={`flex flex-col ${w("gap-2", "gap-1")} ${card}`}>
              <CardTitle wide={wide} hidden={hidden} amountPesewas={summary.moneyIn}>{t("money.moneyIn")}</CardTitle>
              <Row data-row="cash-in" label={t("money.cash")} hidden={hidden} amountPesewas={summary.cashIn} />
              <Row data-row="momo-in" label={t("money.momo")} hidden={hidden} amountPesewas={summary.momoIn} />
              {(summary.collectedIn > 0 || summary.givenOnCredit > 0) && (
                <div data-line="money-in-extras" className="mt-1 flex flex-col gap-1 border-t-[3px] border-slate-300 pt-1.5">
                  {summary.collectedIn > 0 && <Row data-row="debts-paid" tone="text-emerald-900" label={t("money.debtsPaid")} hidden={hidden} amountPesewas={summary.collectedIn} />}
                  {summary.givenOnCredit > 0 && <Row data-row="on-credit" tone="text-[#475569]" label={t("money.onCredit")} hidden={hidden} amountPesewas={summary.givenOnCredit} />}
                </div>
              )}
            </section>

            {/* (3) Money spent: Paid in cash + Paid by MoMo + Method not recorded = Money spent. */}
            <section data-card="money-spent" className={`flex flex-col ${w("gap-2", "gap-1")} ${card}`}>
              <CardTitle wide={wide} hidden={hidden} amountPesewas={summary.moneySpent}>{!wide && <ArrowUpRight size={18} className="shrink-0" aria-hidden="true" />}{!wide && " "}{t("money.moneySpent")}</CardTitle>
              <Row data-row="cash-spent" label={t("money.paidInCash")} hidden={hidden} amountPesewas={summary.spentCash} />
              <Row data-row="momo-spent" label={t("money.paidByMomo")} hidden={hidden} amountPesewas={summary.spentMomo} />
              {summary.spentUnrecorded > 0 && <Row data-row="unrecorded-spent" label={t("money.methodNotRecorded")} hidden={hidden} amountPesewas={summary.spentUnrecorded} />}
            </section>

            {/* (4) Where your money should be, this period only. */}
            <section data-card="should-have-left" className={`flex flex-col ${w("gap-2", "gap-1")} ${wide ? card : softCard(wide)}`}>
              {/* The total (Cash + MoMo): big at the top on wide, in the title line on the phone ("Where your money should be · amount"). */}
              <CardTitle wide={wide} hidden={hidden} amountPesewas={wide ? shouldBeTotal : undefined}>{t("money.shouldHaveLeft")}{!wide && <>{" · "}<Amount hidden={hidden} pesewas={shouldBeTotal} /></>}</CardTitle>
              <Row data-row="cash-left" label={t("money.cash")} hidden={hidden} amountPesewas={summary.cashShouldHave} />
              <Row data-row="momo-left" label={t("money.momo")} hidden={hidden} amountPesewas={summary.momoShouldHave} />
              <p className={`${note("text-sm leading-snug sm:text-base")} text-slate-700`}>{t("money.shouldHaveLeftCaption")}</p>
            </section>
          </div>

          {/* (5) The profit card follows the period. Wiring 33 PROFIT VIEW: once at least one item sold in
              the period has a cost, profit is worked out from the costs (N of M lines counted, an unknown
              cost never zero); until then the cash-based Estimated profit card stays as it was. */}
          {report.showProfit && report.itemProfit?.countedLines > 0 && (
            <section data-card="profit" data-profit-view="items" className={`amount-fit-container flex min-w-0 flex-col ${w(`order-2 justify-center gap-2 ${WIDE_HERO_CARD} p-6`, `gap-1 ${SOFT_TILE} px-3.5 py-3`)}`}>
              <p className={`text-lg font-extrabold ${wide ? "text-[#0F172A]" : ""}`}>{t("money.profitTitle", { period: periodWords })}</p>
              <p className={wide ? WIDE_AMOUNT : "amount-fit font-extrabold leading-tight text-[#0F172A]"}><Amount hidden={hidden} pesewas={report.itemProfit.profitPesewas} /></p>
              {report.itemProfit.countedLines < report.itemProfit.totalLines ? (
                <>
                  <p data-profit-counts="" className={`${note("text-base leading-snug")} text-[#0F172A]`}>{t("money.profitCounts", { counted: report.itemProfit.countedLines, total: report.itemProfit.totalLines })}</p>
                  <p className="text-[15px] font-normal leading-snug text-[#475569]">{t("money.profitGuess")}</p>
                  <PosSecondaryButton type="button" data-add-costs="" onClick={() => onNavigate("MyItems")} className={`mt-1 ${w("w-full max-w-[240px]", "w-full")}`}>{t("money.addCosts")}</PosSecondaryButton>
                </>
              ) : (
                <p data-profit-counts="" className={`${note("text-base leading-snug")} text-[#0F172A]`}>{report.itemProfit.totalLines === 1 ? t("money.profitCountsOne") : t("money.profitCountsAll", { total: report.itemProfit.totalLines })}</p>
              )}
            </section>
          )}
          {report.showProfit && !(report.itemProfit?.countedLines > 0) && (
            <section data-card="profit" className={`amount-fit-container flex flex-col ${w("order-2 justify-center gap-2", "gap-0.5")} ${card}`}>
              <p className={`text-lg font-extrabold ${wide ? "text-[#0F172A]" : ""}`}>{t("money.estimatedProfit")}</p>
              <p className={wide ? WIDE_AMOUNT : "amount-fit font-extrabold leading-tight text-emerald-900"}><Amount hidden={hidden} pesewas={summary.profit} /></p>
              <p className={`break-words ${note("text-sm leading-snug sm:text-base")} text-slate-800`}>{amountText("money.profitSum", { sales: summary.sales, stock: summary.stockBought, other: summary.otherCosts }, hidden)}</p>
              {report.averageProfitPesewas !== null && period === "week" && (
                <p className={`${note("text-sm leading-snug sm:text-base")} text-slate-800`}>{amountText("money.averageFourWeeks", { amount: report.averageProfitPesewas }, hidden)}</p>
              )}
            </section>
          )}

          {/* (6) Balances right now: they do not change with the period. */}
          <div data-tiles="" className={`grid min-w-0 grid-cols-2 ${w("order-5 col-span-2 gap-6", "gap-2")}`}>
            {[
              ["PeopleWhoOweYou", "money.owedToYou", report.debtPesewas, "money.seeWho"],
              ["YouOweSuppliers", "money.supplierBalances", report.supplierBalancePesewas, "money.seeList"]
            ].map(([route, label, pesewas, link]) => wide ? (
              // Wide (D7): a white card with the label, the amount and a full-width 52px outlined button; the whole card opens the screen too.
              <div key={route} data-link-card={route} onClick={() => onNavigate(route)} className="amount-fit-container flex min-w-0 cursor-pointer flex-col gap-3 rounded-[18px] border-2 border-slate-300 bg-white p-6 text-slate-950">
                <span className={WIDE_LABEL}>{t(label)}</span>
                <span className={`block ${WIDE_AMOUNT}`}><Amount hidden={hidden} pesewas={pesewas} /></span>
                <button type="button" aria-label={`${t(link)}: ${t(label)}`} onClick={(event) => { event.stopPropagation(); onNavigate(route); }} className="h-[52px] w-full rounded-[14px] border-2 border-slate-500 bg-white text-[17px] font-extrabold text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800">{t(link)}</button>
              </div>
            ) : (
              <button key={route} type="button" onClick={() => onNavigate(route)} className={`amount-fit-container min-w-0 rounded-[16px] border-2 border-slate-300 bg-white text-left text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 px-2.5 py-2 sm:px-3`}>
                <span className="min-w-0">
                  <span className="block text-[15px] font-extrabold leading-snug sm:text-[17px]">{t(label)}</span>
                  <span className="amount-fit block font-extrabold leading-tight text-[#0F172A]"><Amount hidden={hidden} pesewas={pesewas} /></span>
                  <span className="block text-base font-extrabold text-emerald-900 sm:text-[17px]">{t(link)}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </PosPage>
  );
}
