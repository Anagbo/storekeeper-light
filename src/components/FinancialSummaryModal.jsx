import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, CalendarDays, X } from "lucide-react";
import { formatGhs } from "../lib/money.js";
import { getFinancialDateRange, getFinancialSummary } from "../utils/financials.js";

function localDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function FinancialSummaryModal({ isOpen, onClose, refreshKey = 0 }) {
  const [period, setPeriod] = useState("week");
  const [customStart, setCustomStart] = useState(localDateInputValue);
  const [customEnd, setCustomEnd] = useState(localDateInputValue);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const range = getFinancialDateRange(period, customStart, customEnd);
  const invalidCustomRange = period === "custom" && !range;

  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    if (!range) {
      setSummary(null);
      setLoading(false);
      setError("");
      return undefined;
    }

    setLoading(true);
    setError("");
    getFinancialSummary(range)
      .then((result) => {
        if (!cancelled) setSummary(result);
      })
      .catch((loadError) => {
        console.error("Could not load financial summary.", loadError);
        if (!cancelled) setError("Financial summary could not be loaded. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, range?.start, range?.end, refreshKey]);

  useEffect(() => {
    if (!isOpen) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section role="dialog" aria-modal="true" aria-labelledby="financial-summary-title" className="max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-4 shadow-xl sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <p className="text-sm font-medium text-leaf">Cash and credit overview</p>
            <h2 id="financial-summary-title" className="mt-1 text-xl font-bold">Financial Overview</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close financial overview" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-700 transition hover:bg-slate-200">
            <X size={19} aria-hidden="true" />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Financial reporting period">
          {[
            { value: "week", label: "This Week" },
            { value: "month", label: "This Month" },
            { value: "custom", label: "Custom" }
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={period === option.value}
              onClick={() => setPeriod(option.value)}
              className={`min-h-10 rounded-lg px-3 text-sm font-semibold transition ${period === option.value ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
            >
              {option.label}
            </button>
          ))}
        </div>

      {period === "custom" && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm font-semibold text-slate-700">
            From
            <span className="mt-1 flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3">
              <CalendarDays size={17} className="shrink-0 text-slate-500" aria-hidden="true" />
              <input type="date" value={customStart} max={customEnd} onChange={(event) => setCustomStart(event.target.value)} className="min-w-0 flex-1 bg-transparent text-base outline-none sm:text-sm" />
            </span>
          </label>
          <label className="text-sm font-semibold text-slate-700">
            To
            <span className="mt-1 flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3">
              <CalendarDays size={17} className="shrink-0 text-slate-500" aria-hidden="true" />
              <input type="date" value={customEnd} min={customStart} onChange={(event) => setCustomEnd(event.target.value)} className="min-w-0 flex-1 bg-transparent text-base outline-none sm:text-sm" />
            </span>
          </label>
        </div>
      )}

      {invalidCustomRange && <p role="alert" className="mt-3 text-sm text-amber-800">Choose a valid date range to view the report.</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}

      {!invalidCustomRange && !error && (
        <>
          <article className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm font-semibold text-emerald-900">Real Cash Profit</p>
            <p className="mt-1 break-words text-3xl font-bold tracking-tight text-emerald-950">
              {loading || !summary ? "…" : formatGhs(summary.realCashProfit)}
            </p>
            <p className="mt-1 text-xs text-emerald-800">Cash received minus expenses paid</p>
          </article>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <article className="rounded-xl bg-emerald-50/70 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-emerald-950">Total Cash Inflow</p>
                <ArrowDownLeft size={18} className="text-emerald-800" aria-hidden="true" />
              </div>
              <p className="mt-2 text-2xl font-bold text-emerald-950">
                {loading || !summary ? "…" : formatGhs(summary.cashInflow)}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="inline-flex rounded-full bg-white px-2.5 py-1 text-xs font-medium text-emerald-900">
                  💵 Cash Received: {loading || !summary ? "…" : formatGhs(summary.cashReceived)}
                </span>
                <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-950">
                  📱 MoMo Received: {loading || !summary ? "…" : formatGhs(summary.momoReceived)}
                </span>
              </div>
            </article>
            <article className="rounded-xl bg-slate-100 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-800">Expenses</p>
                <ArrowUpRight size={18} className="text-slate-600" aria-hidden="true" />
              </div>
              <p className="mt-2 text-xl font-bold text-slate-900">
                {loading || !summary ? "…" : formatGhs(summary.expenses)}
              </p>
              <p className="mt-2 text-xs text-slate-600">New credit extended: {loading || !summary ? "…" : formatGhs(summary.newCreditExtended)}</p>
            </article>
          </div>

          {summary && !loading && (
            <>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-4 py-3">
                <span className="text-sm font-medium text-slate-700">Accrued profit (includes new credit)</span>
                <strong className="text-lg text-slate-900">{formatGhs(summary.accruedProfit)}</strong>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-slate-700">
                You collected {formatGhs(summary.debtPaymentsCollected)} in debt payments this period. After {formatGhs(summary.expenses)} in expenses, your real cash profit is {formatGhs(summary.realCashProfit)}. Including {formatGhs(summary.newCreditExtended)} in new credit sales, accrued profit is {formatGhs(summary.accruedProfit)}.
              </p>
            </>
          )}
        </>
      )}
      </section>
    </div>
  );
}
