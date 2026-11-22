import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { UserRound } from "lucide-react";
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
import { createPosTransactionRows, describeHomeTableRow, describeTransactionRow, filterPosTransactionRows } from "./transactionFeed.js";
import { displayName } from "../lib/displayName.js";
import { AmountCell, DASH, WhatText } from "./Home.jsx";
import { PHONE_LAYOUT } from "./layout.js";

const FILTERS = ["all", "sold", "spent", "credit"];
// The Spent and Given on credit amounts: 22px bold, smaller only when the tile is too narrow for it.
const TILE_AMOUNT = "whitespace-nowrap text-[length:min(22px,14.3cqi)] font-extrabold leading-tight";

// Amount colours (wiring 24): money in green with +, spent amber-brown with −, credit-only dark red
// with no sign (nothing was received).
const AMOUNT_TONES = {
  in: { className: "text-[#03543F]", sign: "+" },
  spent: { className: "text-[#92400E]", sign: "−" },
  credit: { className: "text-[#7F1D1D]", sign: "" },
  neutral: { className: "text-slate-800", sign: "" }
};

// Calmer colours (20 Nov 2026): a person chip is pink only when it says someone owes money; a person who
// only paid (or a chip with only the name) gets a neutral white chip with a 2px grey outline (py-0 keeps
// it the same height as the filled chips). Payment chips are unchanged.
const CHIP_STYLES = {
  payment: "py-0.5 bg-[#CBD5E1] text-[#0F172A]",
  person: "py-0.5 bg-[#FECDD3] text-[#0F172A]",
  personNeutral: "border-2 border-slate-500 bg-white py-0 text-[#0F172A]",
  category: "py-0.5 bg-[#FDE68A] text-[#0F172A]",
  reason: "py-0.5 bg-[#CBD5E1] text-[#0F172A]",
  credit: "py-0.5 bg-rose-100 text-rose-950"
};
const chipStyle = (chip) => (chip.kind === "person" && !chip.owes ? CHIP_STYLES.personNeutral : CHIP_STYLES[chip.kind] ?? CHIP_STYLES.payment);

function Chip({ chip, nowrap = false }) {
  return (
    <span data-chip={chip.kind} data-owes={chip.kind === "person" ? String(Boolean(chip.owes)) : undefined} className={`inline-flex max-w-full items-center gap-1 rounded-[10px] px-2 text-base font-bold ${nowrap ? "whitespace-nowrap" : "[overflow-wrap:anywhere]"} ${chipStyle(chip)}`}>
      {chip.kind === "person" && <UserRound size={16} aria-hidden="true" className="shrink-0" />}
      {chip.label}
    </span>
  );
}

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

// What each wide row shows: Home's cut of the row (Money in, On credit, Spent, same tones) plus the
// Details (payment chips, the spent category, the correction's reason, and for stock bought from a supplier
// the pink "You owe {Supplier} GH₵x" chip) and the Person. Decided 22 Nov 2026: stock bought on credit shows
// its amount only in that chip, so its Spent and On credit cells are dashes (nothing was paid out, nothing was
// given on credit) and every Total today cell equals the sum of the amounts shown above it.
function describeWideRow(row) {
  const cut = describeHomeTableRow(row);
  const view = describeTransactionRow(row);
  const stockOnCredit = row.kind === "credit";
  const supplierOwed = (row.kind === "credit" || row.kind === "spent") && row.owedPesewas > 0;
  return {
    ...cut,
    spentPesewas: stockOnCredit ? 0 : cut.spentPesewas,
    details: view.chips.filter((chip) => chip.kind === "payment" || chip.kind === "category" || chip.kind === "reason" || (supplierOwed && chip.kind === "person" && chip.owes)),
    person: displayName(row.customerName) || displayName(row.supplierName)
  };
}

// The table totals: each column adds the amounts shown in it. A balance correction (plain dark, in On credit)
// is added to nothing.
export function sumWideRows(rows) {
  const totals = { moneyIn: 0, spent: 0, onCredit: 0 };
  for (const row of rows) {
    const cut = describeWideRow(row);
    totals.moneyIn += cut.moneyInPesewas;
    totals.spent += cut.spentPesewas;
    if (cut.owedTone === "credit") totals.onCredit += cut.owedPesewas;
  }
  return totals;
}

const WIDE_CARD = "flex min-w-0 flex-col justify-center rounded-[18px] border-2 border-l-[6px] border-slate-300 bg-white px-4 py-4 text-[#0F172A]";
// 40px bold at most; smaller only when the card is too narrow for GH₵12,345.00 (never clipped).
const WIDE_AMOUNT = "block whitespace-nowrap text-[length:max(28px,min(40px,12.5cqi))] font-bold leading-tight";

function WideSummary({ totals, rail }) {
  return (
    <section aria-label={t("transactions.summary")} className={`grid min-w-0 gap-4 ${rail ? "grid-cols-2" : "grid-cols-[1.5fr_1fr_1fr]"}`}>
      <div data-summary="money-in" className={`amount-fit-container flex min-w-0 flex-col justify-center rounded-[18px] bg-[#03543F] px-4 py-4 text-white ${rail ? "col-span-2" : ""}`}>
        <p className="text-[17px] font-bold">{t("transactions.moneyIn")}</p>
        <p data-wide-amount="" className="block whitespace-nowrap text-[length:max(28px,min(56px,12.5cqi))] font-bold leading-none">{formatGhs(totals.cashInflow)}</p>
      </div>
      <div data-summary="spent" className={`amount-fit-container border-l-amber-700 ${WIDE_CARD}`}>
        <p className="text-[17px] font-bold">{t("transactions.spent")}</p>
        <p data-wide-amount="" className={WIDE_AMOUNT}>{formatGhs(totals.expenses)}</p>
      </div>
      <div data-summary="given-on-credit" className={`amount-fit-container border-l-rose-900 ${WIDE_CARD}`}>
        <p className="text-[17px] font-bold">{t("transactions.givenOnCredit")}</p>
        <p data-credit-amount="" data-wide-amount="" className={WIDE_AMOUNT}>{formatGhs(totals.creditGiven)}</p>
      </div>
    </section>
  );
}

// One structure at every wide width: five fixed columns (Time 72px, three money columns 140px, What takes
// the rest). What holds the title, the person's name (grey) and the chips; chips wrap between chips, never
// inside one. Cell padding is the normal 8px.
function WideTable({ rows, totals }) {
  const head = "p-2 font-bold";
  return (
    <div className="min-w-0 rounded-[18px] border-2 border-slate-300 bg-white px-0 py-3">
      <table data-wide-table="" data-columns={5} className="w-full table-fixed border-collapse text-[17px] tabular-nums [&_td]:font-bold">
        <colgroup>
          <col style={{ width: 72 }} />
          <col />
          <col style={{ width: 140 }} />
          <col style={{ width: 140 }} />
          <col style={{ width: 140 }} />
        </colgroup>
        <thead>
          <tr className="border-b-2 border-slate-300 text-[17px] text-slate-600">
            <th scope="col" className={`${head} whitespace-nowrap text-left`}>{t("home.tableTime")}</th>
            <th scope="col" className={`${head} text-left`}>{t("home.tableWhat")}</th>
            <th scope="col" className={`${head} whitespace-nowrap text-right`}>{t("home.tableMoneyIn")}</th>
            <th scope="col" className={`${head} whitespace-nowrap text-right`}>{t("home.tableSpent")}</th>
            <th scope="col" className={`${head} whitespace-nowrap text-right`}>{t("transactions.tableOnCredit")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const view = describeWideRow(row);
            return (
              <tr key={row.id} data-wide-row="" data-row-kind={row.kind} data-row-id={row.id} className="border-b border-slate-200 align-top">
                <td className="whitespace-nowrap p-2 font-normal text-slate-600"><time dateTime={new Date(row.timestamp).toISOString()}>{formatTime(row.timestamp)}</time></td>
                <td data-cell="what" className="min-w-0 p-2 leading-snug">
                  <WhatText text={view.title} />
                  {view.person && <span data-cell="person" className="block font-normal text-slate-600 [overflow-wrap:anywhere]">{view.person}</span>}
                  {view.details.length > 0 && (
                    <span data-cell="chips" className="mt-1 flex flex-wrap gap-1.5">
                      {view.details.map((chip) => <Chip key={`${chip.kind}:${chip.label}`} chip={chip} nowrap />)}
                    </span>
                  )}
                </td>
                <AmountCell name="money-in" tone="in" pesewas={view.moneyInPesewas} hidden={false} />
                <AmountCell name="spent" tone={view.spentTone} pesewas={view.spentPesewas} hidden={false} />
                <AmountCell name="owed" tone={view.owedTone} pesewas={view.owedPesewas} hidden={false} />
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr data-wide-total="" className="border-t-2 border-slate-400 font-bold text-[#0F172A]">
            <th scope="row" colSpan={2} className="p-2 text-left">{t("transactions.totalToday")}</th>
            <td data-cell="total-money-in" className="whitespace-nowrap p-2 text-right">{formatGhs(totals.moneyIn)}</td>
            <td data-cell="total-spent" className="whitespace-nowrap p-2 text-right">{formatGhs(totals.spent)}</td>
            <td data-cell="total-owed" className="whitespace-nowrap p-2 text-right">{formatGhs(totals.onCredit)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
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
          <div role="group" aria-label={t("transactions.filters")} className="flex flex-wrap gap-3">
            {FILTERS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={`h-[52px] w-40 whitespace-nowrap rounded-[14px] border-2 px-1 text-[17px] font-bold ${filter === value ? "border-[#03543F] bg-[#03543F] text-white" : "border-slate-500 bg-white text-slate-950"}`}
              >
                {t(`transactions.filter.${value}`)}
              </button>
            ))}
          </div>
          {visibleRows.length ? (
            <WideTable rows={visibleRows} totals={sumWideRows(data.transactions)} />
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
            <div data-summary="money-in" className="min-w-0 rounded-[20px] bg-[#03543F] px-4 py-3 text-white">
              <p className="text-base font-bold">{t("transactions.moneyIn")}</p>
              <p className="whitespace-nowrap text-[34px] font-extrabold leading-tight">{formatGhs(data.totals.cashInflow)}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {/* Calmer colours (20 Nov 2026): white cards, 2px light grey border, a 6px coloured left edge
                  (amber for Spent, red for Given on credit) like the debt tiles on My money; dark numbers, dark
                  red only for Given on credit above zero. Never a coloured fill. The borders take 8px of the
                  width, so, like the My money tiles, the amount follows the tile width (22px at most) and
                  a five-digit cedi amount is never clipped at 340px. */}
              <div data-summary="spent" className="amount-fit-container min-w-0 rounded-[18px] border-2 border-l-[6px] border-slate-300 border-l-amber-700 bg-white px-1.5 py-2 sm:px-3 text-[#0F172A]">
                <p className="text-base font-bold">{t("transactions.spent")}</p>
                <p className={TILE_AMOUNT}>{formatGhs(data.totals.expenses)}</p>
              </div>
              <div data-summary="given-on-credit" className="amount-fit-container min-w-0 rounded-[18px] border-2 border-l-[6px] border-slate-300 border-l-rose-900 bg-white px-1.5 py-2 sm:px-3 text-[#0F172A]">
                <p className="text-base font-bold">{t("transactions.givenOnCredit")}</p>
                <p data-credit-amount="" className={`${TILE_AMOUNT} ${data.totals.creditGiven > 0 ? "text-[#7F1D1D]" : ""}`}>{formatGhs(data.totals.creditGiven)}</p>
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
