import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowDown, ArrowUp, CreditCard } from "lucide-react";
import { db } from "../db/db.js";
import { formatDate, formatTime } from "../lib/formatDate.js";
import {
  formatGhs,
  getFinancialTransactions,
  summarizeFinancialTransactionsSafely
} from "../lib/money.js";
import { posText as t } from "./i18n.js";
import { getMoneyPeriodRange } from "./money.js";
import { PosBackButton, PosPage } from "./PosComponents.jsx";
import { createPosTransactionRows, describeTransactionRow, filterPosTransactionRows } from "./transactionFeed.js";
import { Chip, sumWideRows, TransactionTable } from "./TransactionTable.jsx";
import { PHONE_LAYOUT } from "./layout.js";
import { SOFT_TILE } from "./softTile.js";

// Summary tiles (rules_global.soft_tiles, 24 Nov 2026, phone and wide): Money in, Spent and Given on
// credit are soft tiles (#F1F5F9, no border, no coloured edge, dark text). Each label has a small neutral
// 22px icon: arrow up for Money in, arrow down for Spent, card for Given on credit.
const SUMMARY_ICONS = { "money-in": ArrowUp, spent: ArrowDown, "given-on-credit": CreditCard };
function SummaryLabel({ kind, className = "" }) {
  const Icon = SUMMARY_ICONS[kind];
  const key = { "money-in": "transactions.moneyIn", spent: "transactions.spent", "given-on-credit": "transactions.givenOnCredit" }[kind];
  return (
    <p className={`flex min-w-0 items-center gap-1.5 font-bold text-[#334155] ${className}`}>
      <Icon data-summary-icon="" size={22} strokeWidth={2.2} className="shrink-0 text-[#334155]" aria-hidden="true" />
      <span className="min-w-0">{t(key)}</span>
    </p>
  );
}

const FILTERS = ["all", "sold", "spent", "credit"];
// The Spent and Given on credit amounts: 22px bold, smaller only when the tile is too narrow for it.
const TILE_AMOUNT = "whitespace-nowrap text-[length:min(22px,14.3cqi)] font-extrabold leading-tight";

// Amount colours (wiring 24): money in green with +, spent amber-brown with −, credit-only dark red
// with no sign (nothing was received).
const AMOUNT_TONES = {
  in: { className: "text-[#03543F]", sign: "+" },
  spent: { className: "text-[#0F172A]", sign: "−" },
  credit: { className: "text-[#0F172A]", sign: "" },
  neutral: { className: "text-slate-800", sign: "" }
};

// One row: title and amount on line 1, chips and time on line 2. Rows are not buttons (no
// chevron, no hover, not focusable) until their detail view is designed.
function TransactionRow({ row }) {
  const view = describeTransactionRow(row);
  const tone = AMOUNT_TONES[view.tone] ?? AMOUNT_TONES.neutral;
  return (
    <article role="listitem" aria-label={view.ariaLabel ? `${view.ariaLabel}. ${formatTime(row.timestamp)}` : undefined} data-row-tone={view.tone} className="flex min-w-0 flex-col gap-1.5 rounded-[18px] border-2 border-[#CBD5E1] bg-white px-3.5 py-2.5">
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <b data-row-title="" className="min-w-0 text-lg font-extrabold leading-tight [overflow-wrap:anywhere]">{view.title}</b>
        <b data-row-amount="" className={`shrink-0 whitespace-nowrap text-[22px] font-extrabold leading-tight ${tone.className}`}>{`${tone.sign}${formatGhs(view.amountPesewas)}`}</b>
      </div>
      <div className="flex min-w-0 items-end justify-between gap-2">
        <span className="flex min-w-0 flex-wrap gap-1.5">
          {view.chips.map((chip) => <Chip key={`${chip.kind}:${chip.label}`} chip={chip} />)}
        </span>
        <time className="shrink-0 whitespace-nowrap text-base font-bold text-slate-800" dateTime={new Date(row.timestamp).toISOString()}>
          {formatTime(row.timestamp)}
        </time>
      </div>
    </article>
  );
}

// ---- Wide layout (wiring 24, D4): three cards, the filters, then one table. Wide only; the phone is unchanged. ----

const WIDE_CARD = `flex min-w-0 flex-col justify-center ${SOFT_TILE} px-4 py-4 text-[#0F172A]`;
// 40px bold at most; smaller only when the card is too narrow for GH₵12,345.00 (never clipped).
const WIDE_AMOUNT = "block whitespace-nowrap text-[length:max(28px,min(40px,12.5cqi))] font-bold leading-tight";

function WideSummary({ totals, rail }) {
  return (
    <section aria-label={t("transactions.summary")} className={`grid min-w-0 gap-4 ${rail ? "grid-cols-2" : "grid-cols-[1.5fr_1fr_1fr]"}`}>
      <div data-summary="money-in" className={`amount-fit-container ${WIDE_CARD} ${rail ? "col-span-2" : ""}`}>
        <SummaryLabel kind="money-in" className="text-[17px]" />
        <p data-wide-amount="" className="block whitespace-nowrap text-[length:max(28px,min(56px,12.5cqi))] font-bold leading-none">{formatGhs(totals.cashInflow)}</p>
      </div>
      <div data-summary="spent" className={`amount-fit-container ${WIDE_CARD}`}>
        <SummaryLabel kind="spent" className="text-[17px]" />
        <p data-wide-amount="" className={WIDE_AMOUNT}>{formatGhs(totals.expenses)}</p>
      </div>
      <div data-summary="given-on-credit" className={`amount-fit-container ${WIDE_CARD}`}>
        <SummaryLabel kind="given-on-credit" className="text-[17px]" />
        <p data-credit-amount="" data-wide-amount="" className={WIDE_AMOUNT}>{formatGhs(totals.creditGiven)}</p>
      </div>
    </section>
  );
}

function WideTransactions({ data, filter, setFilter, visibleRows, date, layout, onRetry }) {
  const rail = layout.mode === "rail";
  return (
    <PosPage wide rail={rail} className="flex flex-col gap-5 tabular-nums">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-[30px] font-bold leading-tight">{t("transactions.title")}</h1>
        <p data-today-date="" className="text-[17px] font-semibold text-slate-800">{t("transactions.todayDate", { date })}</p>
      </div>
      {data.status === "loading" ? (
        <section role="status" aria-label={t("transactions.loading")} className="h-40 animate-pulse rounded-[18px] bg-slate-200" />
      ) : data.status === "error" ? (
        <section role="alert" className="flex flex-col items-center gap-3 rounded-2xl border-2 border-rose-300 bg-rose-50 p-5 text-center">
          <p className="text-[17px] font-bold text-rose-950">{t("transactions.loadFailed")}</p>
          <button type="button" onClick={onRetry} className="min-h-12 rounded-xl border-2 border-rose-900 bg-white px-4 font-bold text-rose-900">{t("transactions.retry")}</button>
        </section>
      ) : (
        <>
          <WideSummary totals={data.totals} rail={rail} />
          <div role="group" aria-label={t("transactions.filters")} className={rail ? "grid grid-cols-4 gap-3" : "flex flex-wrap gap-3"}>
            {FILTERS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={`h-[52px] ${rail ? "w-full min-w-0" : "w-40"} whitespace-nowrap rounded-[14px] border-2 px-1 text-[17px] font-bold ${filter === value ? "border-[#03543F] bg-[#03543F] text-white" : "border-slate-500 bg-white text-slate-950"}`}
              >
                {t(`transactions.filter.${value}`)}
              </button>
            ))}
          </div>
          {visibleRows.length ? (
            <TransactionTable rows={visibleRows} totals={sumWideRows(data.transactions)} layout={layout} />
          ) : (
            <p data-empty="" className="py-2 text-[17px] font-semibold text-slate-700">{t("transactions.empty")}</p>
          )}
        </>
      )}
    </PosPage>
  );
}

export default function TodaysTransactions({ onBack, layout = PHONE_LAYOUT }) {
  const [filter, setFilter] = useState("all");
  const [reloadKey, setReloadKey] = useState(0);
  const range = useMemo(() => getMoneyPeriodRange("day"), []);
  const data = useLiveQuery(async () => {
    try {
      const [transactions, suppliers] = await Promise.all([getFinancialTransactions(range), db.suppliers.toArray()]);
      return {
        status: "ready",
        transactions: createPosTransactionRows(transactions, new Map(suppliers.map((supplier) => [supplier.id, supplier.name]))),
        totals: summarizeFinancialTransactionsSafely(transactions).totals
      };
    } catch (error) {
      console.error("Could not load today’s transactions.", error);
      return { status: "error", transactions: [], totals: null };
    }
  }, [range.start, range.end, reloadKey], { status: "loading", transactions: [], totals: null });
  const visibleRows = data.status === "ready" ? filterPosTransactionRows(data.transactions, filter) : [];

  if (layout.wide) {
    return <WideTransactions data={data} filter={filter} setFilter={setFilter} visibleRows={visibleRows} date={formatDate(range.start)} layout={layout} onRetry={() => setReloadKey((key) => key + 1)} />;
  }

  return (
    <PosPage className="flex flex-col gap-3 px-4 sm:px-6 lg:gap-5">
      <div className="flex items-center gap-2.5">
        <PosBackButton onClick={onBack} />
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold leading-tight">{t("transactions.title")}</h1>
          <p data-today-date="" className="text-base font-semibold text-slate-800">{t("transactions.todayDate", { date: formatDate(range.start) })}</p>
        </div>
      </div>

      {data.status === "loading" ? (
        <section role="status" aria-label={t("transactions.loading")} className="flex flex-col gap-3">
          <div className="h-20 animate-pulse rounded-[20px] bg-slate-200" />
          <div className="grid grid-cols-2 gap-2">
            {[1, 2].map((card) => <div key={card} className="h-16 animate-pulse rounded-[18px] bg-slate-200" />)}
          </div>
          <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
            {[1, 2, 3, 4].map((filterButton) => <div key={filterButton} className="h-[52px] animate-pulse rounded-[14px] bg-slate-200" />)}
          </div>
          <div className="flex flex-col gap-2">
            {[1, 2, 3].map((row) => <div key={row} className="h-[76px] animate-pulse rounded-[18px] bg-slate-200" />)}
          </div>
        </section>
      ) : data.status === "error" ? (
        <section role="alert" className="flex flex-col items-center gap-3 rounded-2xl border-2 border-rose-300 bg-rose-50 p-5 text-center">
          <p className="font-bold text-rose-950">{t("transactions.loadFailed")}</p>
          <button type="button" onClick={() => setReloadKey((key) => key + 1)} className="min-h-11 rounded-xl border-2 border-rose-900 bg-white px-4 font-extrabold text-rose-900">
            {t("transactions.retry")}
          </button>
        </section>
      ) : (
        <>
          <section aria-label={t("transactions.summary")} className="flex flex-col gap-2 lg:gap-4">
            <div data-summary="money-in" className={`min-w-0 ${SOFT_TILE} px-4 py-3 text-[#0F172A]`}>
              <SummaryLabel kind="money-in" className="text-base" />
              <p className="whitespace-nowrap text-[34px] font-extrabold leading-tight">{formatGhs(data.totals.cashInflow)}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {/* Soft tiles (24 Nov 2026): no border, no coloured edge, dark numbers (Given on credit is not
                  red). The amount follows the tile width (22px at most), so a five-digit cedi amount is never
                  clipped at 340px. */}
              <div data-summary="spent" className={`amount-fit-container min-w-0 ${SOFT_TILE} px-1.5 py-2 sm:px-3 text-[#0F172A]`}>
                <SummaryLabel kind="spent" className="text-base" />
                <p className={TILE_AMOUNT}>{formatGhs(data.totals.expenses)}</p>
              </div>
              <div data-summary="given-on-credit" className={`amount-fit-container min-w-0 ${SOFT_TILE} px-1.5 py-2 sm:px-3 text-[#0F172A]`}>
                <SummaryLabel kind="given-on-credit" className="text-base" />
                <p data-credit-amount="" className={TILE_AMOUNT}>{formatGhs(data.totals.creditGiven)}</p>
              </div>
            </div>
          </section>

          <div role="group" aria-label={t("transactions.filters")} className="grid grid-cols-4 gap-1.5 sm:gap-2">
            {FILTERS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={`h-[52px] min-w-0 rounded-[14px] border-2 px-1 text-[17px] font-extrabold ${filter === value ? "border-[#03543F] bg-[#03543F] text-white" : "border-slate-500 bg-white text-slate-950"}`}
              >
                {t(`transactions.filter.${value}`)}
              </button>
            ))}
          </div>

          {visibleRows.length ? (
            <div role="list" aria-label={t(`transactions.filter.${filter}`)} className="flex flex-col gap-2">
              {visibleRows.map((row) => <TransactionRow key={row.id} row={row} />)}
            </div>
          ) : (
            <p data-empty="" className="py-2 text-center text-base font-semibold text-slate-700">{t("transactions.empty")}</p>
          )}
        </>
      )}
    </PosPage>
  );
}
