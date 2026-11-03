import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft } from "lucide-react";
import { db } from "../db/db.js";
import { formatGhs } from "../lib/money.js";
import { getFinancialTransactions } from "../utils/financials.js";
import { posText as t } from "./i18n.js";
import { getMoneyPeriodRange, summarizeFinancialTransactions } from "./money.js";
import { PosPage, PosStatusTag } from "./PosComponents.jsx";
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
  if (row.kind === "spent") {
    const category = getCategoryLabel(row.category);
    return (
      <div className="mt-1 flex flex-wrap gap-1.5">
        <PosStatusTag tone="amber">{t("transactions.tag.spent")}</PosStatusTag>
        {category && <PosStatusTag>{category}</PosStatusTag>}
        {row.owedPesewas > 0 && <PosStatusTag tone="red">{t("transactions.tag.credit")} {formatGhs(row.owedPesewas)}</PosStatusTag>}
      </div>
    );
  }

  if (row.kind === "credit") {
    const category = getCategoryLabel(row.category);
    return (
      <div className="mt-1 flex flex-wrap gap-1.5">
        <PosStatusTag tone="red">{t("transactions.tag.credit")}</PosStatusTag>
        {category && <PosStatusTag>{category}</PosStatusTag>}
      </div>
    );
  }

  if (row.kind === "payment") {
    return (
      <div className="mt-1 flex flex-wrap gap-1.5">
        <PosStatusTag tone="green">{t("transactions.tag.owed")}</PosStatusTag>
        {row.cashPesewas > 0 && <PosStatusTag>{t("transactions.tag.cash")} {formatGhs(row.cashPesewas)}</PosStatusTag>}
        {row.momoPesewas > 0 && <PosStatusTag>{t("transactions.tag.momo")} {formatGhs(row.momoPesewas)}</PosStatusTag>}
      </div>
    );
  }

  if (row.kind === "sold") {
    const isCreditOnly = row.isCredit && row.cashReceivedPesewas === 0;
    return (
      <div className="mt-1 flex flex-wrap gap-1.5">
        {!isCreditOnly && <PosStatusTag tone="green">{t("transactions.tag.sold")}</PosStatusTag>}
        {row.cashPesewas > 0 && <PosStatusTag>{t("transactions.tag.cash")} {formatGhs(row.cashPesewas)}</PosStatusTag>}
        {row.momoPesewas > 0 && <PosStatusTag>{t("transactions.tag.momo")} {formatGhs(row.momoPesewas)}</PosStatusTag>}
        {row.owedPesewas > 0 && (
          <PosStatusTag tone="red">
            {isCreditOnly ? t("transactions.tag.credit") : `${t("transactions.tag.owed")} ${formatGhs(row.owedPesewas)}`}
          </PosStatusTag>
        )}
        {row.customerName && row.isCredit && <PosStatusTag>{row.customerName}</PosStatusTag>}
      </div>
    );
  }

  return null;
}

function TransactionRow({ row }) {
  const isSpent = row.kind === "spent";
  const isCreditOnly = row.isCredit && row.cashReceivedPesewas === 0;
  const amount = formatGhs(row.amountPesewas);
  const signedAmount = isSpent
    ? `−${amount}`
    : isCreditOnly
      ? amount
      : `+${amount}`;

  return (
    <article role="listitem" className="flex min-h-[76px] items-center gap-3 rounded-2xl border-2 border-slate-300 bg-white px-3 py-2 sm:px-4">
      <div className="amount-fit-container min-w-0 flex-1">
        <p className={`amount-fit font-extrabold ${isSpent ? "text-amber-900" : isCreditOnly ? "text-rose-900" : "text-emerald-900"}`}>
          {signedAmount}
        </p>
        <TransactionTags row={row} />
      </div>
      <time className="shrink-0 text-sm font-bold text-slate-700 sm:text-base" dateTime={new Date(row.timestamp).toISOString()}>
        {formatTransactionTime(row.timestamp)}
      </time>
    </article>
  );
}

export default function TodaysTransactions({ onBack }) {
  const [filter, setFilter] = useState("all");
  const range = useMemo(() => getMoneyPeriodRange("day"), []);
  const data = useLiveQuery(async () => {
    const transactions = await getFinancialTransactions(range);
    return {
      transactions: createPosTransactionRows(transactions),
      totals: summarizeFinancialTransactions(transactions)
    };
  }, [range.start, range.end], null);
  const visibleRows = data ? filterPosTransactionRows(data.transactions, filter) : [];

  return (
    <PosPage className="flex flex-col gap-3 px-4 sm:px-6 lg:gap-5">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} className="flex min-h-12 shrink-0 items-center gap-1 rounded-xl border-2 border-slate-900 px-3 text-base font-extrabold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800">
          <ArrowLeft size={20} aria-hidden="true" /> {t("transactions.back")}
        </button>
        <h1 className="min-w-0 text-xl font-extrabold sm:text-2xl">{t("transactions.title")}</h1>
      </div>

      {data ? (
        <>
          <section aria-label={t("transactions.summary")} className="grid grid-cols-3 gap-2 lg:gap-4">
            <div className="amount-fit-container min-w-0 rounded-2xl bg-emerald-900 p-3 text-white sm:px-4">
              <p className="text-sm font-bold sm:text-base">{t("transactions.moneyIn")}</p>
              <p className="amount-fit font-extrabold">{formatGhs(data.totals.cashInflow)}</p>
            </div>
            <div className="amount-fit-container min-w-0 rounded-2xl bg-amber-100 p-3 text-slate-950 sm:px-4">
              <p className="text-sm font-bold sm:text-base">{t("transactions.spent")}</p>
              <p className="amount-fit font-extrabold">{formatGhs(data.totals.expenses)}</p>
            </div>
            <div className="amount-fit-container min-w-0 rounded-2xl bg-rose-200 p-3 text-rose-950 sm:px-4">
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
      ) : (
        <p role="status" className="rounded-2xl border-2 border-slate-300 p-4 font-semibold">{t("transactions.loading")}</p>
      )}
    </PosPage>
  );
}
