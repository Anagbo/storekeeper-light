import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db.js";
import {
  formatGhs,
  getFinancialTransactions,
  summarizeFinancialTransactionsSafely
} from "../lib/money.js";
import { posText as t } from "./i18n.js";
import { getMoneyPeriodRange } from "./money.js";
import { PosBackButton, PosPage, PosStatusTag } from "./PosComponents.jsx";
import { createPosTransactionRows, filterPosTransactionRows } from "./transactionFeed.js";

const FILTERS = ["all", "sold", "spent", "credit"];

function formatTransactionTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString("en-GH", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getCategoryLabel(category) {
  const normalized = category.trim().toLowerCase();
  const categoryKeys = {
    stock: "transactions.category.stock",
    transport: "transactions.category.transport",
    rent: "transactions.category.rent",
    utilities: "transactions.category.utilities",
    other: "transactions.category.other"
  };
  return categoryKeys[normalized] ? t(categoryKeys[normalized]) : category.trim();
}

function TransactionTags({ row }) {
  if (row.kind === "adjustment") {
    return (
      <div className="mt-2 flex flex-wrap gap-1.5">
        <PosStatusTag compact>{t("transactions.tag.adjustment")}</PosStatusTag>
        {row.customerName && <PosStatusTag compact>{row.customerName}</PosStatusTag>}
      </div>
    );
  }

  if (row.kind === "debt_added") {
    return (
      <div className="mt-2 flex flex-wrap gap-1.5">
        <PosStatusTag compact tone="red">{t("transactions.tag.debtAdded")}</PosStatusTag>
        {row.customerName && <PosStatusTag compact>{row.customerName}</PosStatusTag>}
      </div>
    );
  }

  if (row.kind === "spent") {
    const category = getCategoryLabel(row.category);
    return (
      <div className="mt-2 flex flex-wrap gap-1.5">
        <PosStatusTag compact tone="amber">{t("transactions.tag.spent")}</PosStatusTag>
        {category && <PosStatusTag compact>{category}</PosStatusTag>}
        {row.owedPesewas > 0 && <PosStatusTag compact tone="red">{t("transactions.tag.credit")} {formatGhs(row.owedPesewas)}</PosStatusTag>}
      </div>
    );
  }

  if (row.kind === "credit") {
    const category = getCategoryLabel(row.category);
    return (
      <div className="mt-2 flex flex-wrap gap-1.5">
        <PosStatusTag compact tone="red">{t("transactions.tag.credit")}</PosStatusTag>
        {category && <PosStatusTag compact>{category}</PosStatusTag>}
      </div>
    );
  }

  if (row.kind === "payment") {
    return (
      <div className="mt-2 flex flex-wrap gap-1.5">
        <PosStatusTag compact tone="green">{t("transactions.tag.collectedDebt")}</PosStatusTag>
        {row.cashPesewas > 0 && <PosStatusTag compact>{t("transactions.tag.cash")} {formatGhs(row.cashPesewas)}</PosStatusTag>}
        {row.momoPesewas > 0 && <PosStatusTag compact>{t("transactions.tag.momo")} {formatGhs(row.momoPesewas)}</PosStatusTag>}
      </div>
    );
  }

  if (row.kind === "sold") {
    const isCreditOnly = row.isSale && row.isCredit && row.cashReceivedPesewas === 0;
    return (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {!isCreditOnly && <PosStatusTag compact tone="green">{t("transactions.tag.sold")}</PosStatusTag>}
        {row.cashPesewas > 0 && <PosStatusTag compact>{t("transactions.tag.cash")} {formatGhs(row.cashPesewas)}</PosStatusTag>}
        {row.momoPesewas > 0 && <PosStatusTag compact>{t("transactions.tag.momo")} {formatGhs(row.momoPesewas)}</PosStatusTag>}
        {row.owedPesewas > 0 && (
          <PosStatusTag compact tone="red">
            {isCreditOnly ? t("transactions.tag.credit") : `${t("transactions.tag.owed")} ${formatGhs(row.owedPesewas)}`}
          </PosStatusTag>
        )}
        {row.customerName && row.isCredit && <PosStatusTag compact>{row.customerName}</PosStatusTag>}
      </div>
    );
  }

  return null;
}

function TransactionRow({ row }) {
  const isSpent = row.kind === "spent";
  const isAdjustment = row.kind === "adjustment";
  const isCreditOnly = row.isCredit && row.cashReceivedPesewas === 0;
  const amount = formatGhs(isAdjustment ? Math.abs(row.adjustmentDeltaPesewas) : row.amountPesewas);
  const signedAmount = isAdjustment
    ? amount
    : isSpent
    ? `−${amount}`
    : isCreditOnly
      ? amount
      : `+${amount}`;

  return (
    <article role="listitem" className="flex min-h-[76px] flex-col gap-1 rounded-2xl border-2 border-slate-300 bg-white px-3 py-2 sm:flex-row sm:items-center sm:gap-3 sm:px-4">
      <div className="amount-fit-container min-w-0 flex-1">
        <p className={`truncate text-lg font-bold leading-tight sm:text-xl ${isAdjustment ? "text-slate-800" : isSpent ? "text-amber-900" : isCreditOnly ? "text-rose-900" : "text-emerald-900"}`}>
          {signedAmount}
        </p>
        <TransactionTags row={row} />
      </div>
      <time className="self-end text-sm font-bold text-slate-700 sm:shrink-0 sm:self-auto sm:text-base" dateTime={new Date(row.timestamp).toISOString()}>
        {formatTransactionTime(row.timestamp)}
      </time>
    </article>
  );
}

export default function TodaysTransactions({ onBack }) {
  const [filter, setFilter] = useState("all");
  const [reloadKey, setReloadKey] = useState(0);
  const range = useMemo(() => getMoneyPeriodRange("day"), []);
  const data = useLiveQuery(async () => {
    try {
      const transactions = await getFinancialTransactions(range);
      return {
        status: "ready",
        transactions: createPosTransactionRows(transactions),
        totals: summarizeFinancialTransactionsSafely(transactions).totals
      };
    } catch (error) {
      console.error("Could not load today’s transactions.", error);
      return { status: "error", transactions: [], totals: null };
    }
  }, [range.start, range.end, reloadKey], { status: "loading", transactions: [], totals: null });
  const visibleRows = data.status === "ready" ? filterPosTransactionRows(data.transactions, filter) : [];

  return (
    <PosPage className="flex flex-col gap-3 px-4 sm:px-6 lg:gap-5">
      <div className="flex items-center gap-2">
        <PosBackButton onClick={onBack} />
        <h1 className="min-w-0 text-xl font-extrabold sm:text-2xl">{t("transactions.title")}</h1>
      </div>

      {data.status === "loading" ? (
        <section role="status" aria-label={t("transactions.loading")} className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2 lg:gap-4">
            {[1, 2, 3].map((card) => <div key={card} className="h-20 animate-pulse rounded-2xl bg-slate-200 sm:h-24" />)}
          </div>
          <div className="h-4 w-36 animate-pulse rounded bg-slate-200" />
          <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
            {[1, 2, 3, 4].map((filterButton) => <div key={filterButton} className="h-12 animate-pulse rounded-xl bg-slate-200" />)}
          </div>
          <div className="flex flex-col gap-2">
            {[1, 2, 3].map((row) => <div key={row} className="h-[76px] animate-pulse rounded-2xl bg-slate-200" />)}
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
          <section aria-label={t("transactions.summary")} className="grid grid-cols-3 gap-2 lg:gap-4">
            <div className="amount-fit-container amount-fit-tile min-w-0 rounded-2xl bg-emerald-900 p-3 text-white sm:px-4">
              <p className="text-sm font-bold sm:text-base">{t("transactions.moneyIn")}</p>
              <p className="amount-fit font-extrabold">{formatGhs(data.totals.cashInflow)}</p>
            </div>
            <div className="amount-fit-container amount-fit-tile min-w-0 rounded-2xl bg-amber-100 p-3 text-slate-950 sm:px-4">
              <p className="text-sm font-bold sm:text-base">{t("transactions.spent")}</p>
              <p className="amount-fit font-extrabold">{formatGhs(data.totals.expenses)}</p>
            </div>
            <div className="amount-fit-container amount-fit-tile min-w-0 rounded-2xl bg-rose-200 p-3 text-rose-950 sm:px-4">
              <p className="text-sm font-bold sm:text-base">{t("transactions.owed")}</p>
              <p className="amount-fit font-extrabold">{formatGhs(data.totals.newCreditExtended)}</p>
            </div>
          </section>
          <p className="-mt-1 text-sm font-semibold text-slate-700">{t("transactions.amountsInGhs")}</p>

          <div role="group" aria-label={t("transactions.filters")} className="grid grid-cols-4 gap-1.5 sm:gap-2">
            {FILTERS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={`min-h-12 rounded-xl border-2 px-1 text-sm font-extrabold sm:text-base ${filter === value ? "border-emerald-900 bg-emerald-900 text-white" : "border-slate-500 bg-white text-slate-950"}`}
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
            <section className="flex min-h-40 flex-col items-center justify-center rounded-2xl border-2 border-slate-300 bg-white p-5 text-center">
              <p className="font-bold">{data.transactions.length ? t("transactions.noMatches") : t("transactions.noActivity")}</p>
            </section>
          )}
        </>
      )}
    </PosPage>
  );
}
