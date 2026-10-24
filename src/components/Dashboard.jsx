import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import Dexie from "dexie";
import { ArrowDownLeft, ArrowUpRight, CirclePlus, MessageCircle, Phone, ReceiptText, UserRoundPlus, UsersRound } from "lucide-react";
import { db } from "../db/db.js";
import { upsertCustomer } from "../db/customers.js";
import { runTransactionWithTimeout } from "../db/runTransactionWithTimeout.js";
import FinancialSummaryModal from "./FinancialSummaryModal.jsx";
import SyncStatusBadge from "./SyncStatusBadge.jsx";
import InstallPromptBanner from "./InstallPromptBanner.jsx";
import { formatGhs } from "../lib/money.js";
import { getLargestUnpaidBalances } from "../utils/debtBalances.js";
import { requestBackgroundSync } from "../lib/syncRegistration.js";
import { generateWhatsAppLink, normalizeWhatsAppPhone } from "../utils/whatsapp.js";
import WhatsAppReminderModal from "./WhatsAppReminderModal.jsx";

const ROW_HEIGHT = 72;
const FEED_HEIGHT = 360;
const PAGE_SIZE = 50;
const OVERSCAN = 4;

function MetricCard({ title, value, icon: Icon, tone, onClick, hint }) {
  const tones = {
    green: {
      card: "bg-leaf",
      label: "text-white",
      icon: "text-white",
      value: "text-white",
      hint: "text-white/80"
    },
    expense: {
      card: "border border-slate-200 bg-slate-100",
      label: "text-slate-600",
      icon: "text-slate-600",
      value: "text-slate-900",
      hint: "text-slate-600"
    },
    debt: {
      card: "border border-rose-200/60 bg-rose-50/80",
      label: "text-rose-800",
      icon: "text-rose-800",
      value: "text-rose-900",
      hint: "text-rose-700/80"
    }
  };
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`min-h-32 w-full rounded-2xl p-4 text-left shadow-card ${tones[tone].card} focus:outline-none focus:ring-2 focus:ring-leaf focus:ring-offset-2`}
      >
        <span className="flex items-center justify-between">
          <span className={`text-sm font-medium ${tones[tone].label}`}>{title}</span>
          <span className="flex items-center gap-2">
            <Icon aria-hidden="true" size={19} className={tones[tone].icon} />
          </span>
        </span>
        <span className={`mt-5 block break-words text-2xl font-bold tracking-tight ${tones[tone].value}`}>{value}</span>
        <span className={`mt-1 block text-xs ${tones[tone].hint}`}>{hint}</span>
      </button>
    );
  }
  return (
    <article className={`min-h-32 rounded-2xl p-4 shadow-card ${tones[tone].card}`}>
      <div className="flex items-center justify-between">
        <p className={`text-sm font-medium ${tones[tone].label}`}>{title}</p>
        <Icon aria-hidden="true" size={19} className={tones[tone].icon} />
      </div>
      <p className={`mt-5 break-words text-2xl font-bold tracking-tight ${tones[tone].value}`}>{value}</p>
    </article>
  );
}

export default function Dashboard({ onQuickEntry, onViewDebts, refreshKey, shopName = "My shop" }) {
  const [transactions, setTransactions] = useState([]);
  const [scrollTop, setScrollTop] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [feedError, setFeedError] = useState("");
  const [debtBreakdown, setDebtBreakdown] = useState([]);
  const [debtBreakdownLoading, setDebtBreakdownLoading] = useState(true);
  const [debtBreakdownError, setDebtBreakdownError] = useState("");
  const [phoneEntryDebt, setPhoneEntryDebt] = useState(null);
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const feedElement = useRef(null);
  const cursor = useRef(null);
  const loadingLock = useRef(false);
  const today = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start: start.getTime(), end: end.getTime() };
  }, []);
  const totals = useLiveQuery(async () => {
    const result = { cashIn: 0, expenses: 0, totalDebt: 0 };
    await db.transactions
      .where("createdAt")
      .between(today.start, today.end, true, false)
      .each((transaction) => {
        if (transaction.type === "expense") result.expenses += transaction.amountPesewas;
        else if (transaction.type !== "sale" || transaction.paymentType !== "credit") {
          result.cashIn += transaction.amountPesewas;
        }
      });
    await db.debts.where("status").equals("unpaid").each((debt) => {
      result.totalDebt += debt.amountPesewas;
    });
    return result;
  }, [today.start, today.end], { cashIn: 0, expenses: 0, totalDebt: 0 });
  const netProfit = totals.cashIn - totals.expenses;

  async function saveDebtPhone(debt, phone) {
    const now = Date.now();
    const normalizedName = debt.customerName.trim().toLowerCase();
    await runTransactionWithTimeout(db, [db.debts, db.customers], async () => {
      const unpaidDebts = await db.debts.where("status").equals("unpaid").toArray();
      const matchingDebts = unpaidDebts.filter((item) => (
        (item.customer_name ?? item.customerName ?? "").trim().toLowerCase() === normalizedName
      ));
      if (matchingDebts.length === 0) {
        throw new Error(`No unpaid debt found for ${debt.customerName}.`);
      }

      await Promise.all(matchingDebts.map((item) => db.debts.update(item.id, {
        phone,
        customer_phone: phone,
        updatedAt: now,
        synced: false,
        syncStatus: "pending"
      })));
      await upsertCustomer({ name: debt.customerName, phone, now });
    });

    setDebtBreakdown((current) => current.map((item) => (
      item.id === debt.id ? { ...item, phone } : item
    )));
    void requestBackgroundSync();
  }

  useEffect(() => {
    let cancelled = false;
    setDebtBreakdownLoading(true);
    setDebtBreakdownError("");
    db.debts
      .where("status")
      .equals("unpaid")
      .toArray()
      .then((results) => {
        if (!cancelled) setDebtBreakdown(getLargestUnpaidBalances(results));
      })
      .catch((error) => {
        console.error("Could not load the debt breakdown.", error);
        if (!cancelled) setDebtBreakdownError("Debt details could not be loaded. Try again.");
      })
      .finally(() => {
        if (!cancelled) setDebtBreakdownLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  useEffect(() => {
    let cancelled = false;
    loadingLock.current = false;
    cursor.current = null;
    if (feedElement.current) feedElement.current.scrollTop = 0;
    setTransactions([]);
    setScrollTop(0);
    setHasMore(true);
    setLoadingMore(true);
    setFeedError("");

    db.transactions
      .where("[createdAt+id]")
      .between(
        [today.start, Dexie.minKey],
        [today.end, Dexie.minKey],
        true,
        false
      )
      .reverse()
      .limit(PAGE_SIZE)
      .toArray()
      .then((firstPage) => {
        if (cancelled) return;
        setTransactions(firstPage);
        cursor.current = firstPage.length ? firstPage[firstPage.length - 1] : null;
        setHasMore(firstPage.length === PAGE_SIZE);
      })
      .catch((error) => {
        console.error("Could not load recent transactions.", error);
        if (!cancelled) setFeedError("Recent activity could not be loaded. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setLoadingMore(false);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshKey, today.end, today.start]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingLock.current || !cursor.current) return;
    loadingLock.current = true;
    setLoadingMore(true);
    setFeedError("");
    try {
      const last = cursor.current;
      const nextPage = await db.transactions
        .where("[createdAt+id]")
        .between(
          [today.start, Dexie.minKey],
          [last.createdAt, last.id],
          true,
          false
        )
        .reverse()
        .limit(PAGE_SIZE)
        .toArray();
      if (nextPage.length) {
        cursor.current = nextPage[nextPage.length - 1];
        setTransactions((current) => [...current, ...nextPage]);
      }
      setHasMore(nextPage.length === PAGE_SIZE);
    } catch (error) {
      console.error("Could not load more transactions.", error);
      setFeedError("More activity could not be loaded. Check your storage and retry.");
    } finally {
      loadingLock.current = false;
      setLoadingMore(false);
    }
  }, [hasMore, today.start]);

  function handleFeedScroll(event) {
    const nextScrollTop = event.currentTarget.scrollTop;
    setScrollTop(nextScrollTop);
    if (
      hasMore &&
      nextScrollTop + event.currentTarget.clientHeight >=
        event.currentTarget.scrollHeight - ROW_HEIGHT * 3
    ) {
      void loadMore();
    }
  }

  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    transactions.length,
    Math.ceil((scrollTop + FEED_HEIGHT) / ROW_HEIGHT) + OVERSCAN
  );
  const visibleTransactions = transactions.slice(startIndex, endIndex);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-6 sm:px-6">
      <InstallPromptBanner />
      <div className="mb-5 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-leaf">Your shop at a glance</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Today</h1>
          <p className="mt-1 text-xs font-semibold text-slate-500">StoreKeeper Light</p>
        </div>
        <SyncStatusBadge />
      </div>

      <section aria-label="Today's totals" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard title="Today's cash in" value={formatGhs(totals.cashIn)} icon={ArrowDownLeft} tone="green" />
        <MetricCard title="Today's expenses" value={formatGhs(totals.expenses)} icon={ArrowUpRight} tone="expense" />
        <MetricCard
          title="Uncollected debt"
          value={formatGhs(totals.totalDebt)}
          icon={ReceiptText}
          tone="debt"
          onClick={onViewDebts}
          hint="Tap to view debts"
        />
      </section>

      <section aria-label="Uncollected debt details" className="mt-3 rounded-2xl bg-white p-4 shadow-card">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-bold">Largest unpaid balances</h2>
          <button type="button" onClick={onViewDebts} className="min-h-10 shrink-0 text-sm font-semibold text-leaf underline">View all debts</button>
        </div>
        {debtBreakdownLoading ? (
          <p className="text-sm text-slate-500">Loading debt details…</p>
        ) : debtBreakdownError ? (
          <p role="alert" className="text-sm text-red-700">{debtBreakdownError}</p>
        ) : debtBreakdown.length ? (
          <ul className="divide-y divide-slate-100">
            {debtBreakdown.map((debt) => {
              const phone = normalizeWhatsAppPhone(debt.phone);
              const whatsappLink = generateWhatsAppLink(
                phone,
                debt.customerName,
                debt.amountPesewas / 100,
                shopName
              );
              return (
                <li key={debt.id} className="flex items-center justify-between gap-3 border-b border-slate-100 py-2 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{debt.customerName}</p>
                    <p className="text-sm font-bold text-amber-800">{formatGhs(debt.amountPesewas)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {whatsappLink ? (
                      <a
                        href={whatsappLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Send WhatsApp debt reminder to ${debt.customerName}`}
                        title="WhatsApp reminder"
                        className="grid min-h-10 min-w-10 place-items-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                      >
                        <MessageCircle size={18} aria-hidden="true" />
                      </a>
                    ) : null}
                    {phone ? (
                      <a
                        href={`tel:${phone}`}
                        aria-label={`Call ${debt.customerName}`}
                        title="Call customer"
                        className="grid min-h-10 min-w-10 place-items-center rounded-xl border border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-500"
                      >
                        <Phone size={18} aria-hidden="true" />
                      </a>
                    ) : null}
                    {!phone && (
                      <button
                        type="button"
                        onClick={() => setPhoneEntryDebt(debt)}
                        aria-label={`Add phone number for ${debt.customerName}`}
                        title="Add phone number"
                        className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                      >
                        <UserRoundPlus size={16} aria-hidden="true" /> Add phone
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">There are no unpaid balances.</p>
        )}
      </section>

      <section aria-label="Today's net profit" className="relative mt-3 flex flex-col items-start justify-between gap-4 rounded-2xl bg-slate-900 p-5 text-white shadow-sm md:flex-row md:items-center">
        <div>
          <p className="block text-xs font-medium uppercase tracking-wider text-slate-400">Today's Net Profit</p>
          <p className="mt-1 block text-3xl font-extrabold tracking-tight">{formatGhs(netProfit)}</p>
        </div>
        <div className="flex w-full flex-col items-end gap-2.5 md:w-auto">
          <span className="rounded-md border border-slate-700/50 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-300">
            Cash in − expenses
          </span>
          <button
            type="button"
            onClick={() => setIsSummaryOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-700/60 bg-slate-800/90 px-3 py-2 text-xs font-medium text-slate-200 transition hover:bg-slate-700 active:scale-95 focus:outline-none focus:ring-2 focus:ring-slate-400 md:w-auto"
          >
            📊 View Weekly &amp; Monthly Reports
          </button>
        </div>
      </section>

      <section aria-label="Quick actions" className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => onQuickEntry("sale")}
          className="flex min-h-16 items-center justify-center gap-3 rounded-2xl bg-emerald-700 px-5 text-lg font-bold text-white shadow-card hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
        >
          <CirclePlus size={23} aria-hidden="true" /> + Record Sale
        </button>
        <button
          type="button"
          onClick={() => onQuickEntry("expense")}
          className="flex min-h-16 items-center justify-center gap-3 rounded-2xl bg-amber-500 px-5 text-lg font-bold text-white shadow-card hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-600 focus:ring-offset-2"
        >
          <CirclePlus size={23} aria-hidden="true" /> + Record Expense
        </button>
        <button
          type="button"
          onClick={onViewDebts}
          className="flex min-h-16 items-center justify-center gap-3 rounded-2xl bg-slate-900 px-5 text-lg font-bold text-white shadow-card hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-700 focus:ring-offset-2"
        >
          <UsersRound size={23} aria-hidden="true" /> View Debts
        </button>
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">Today’s transactions</h2>
          <span className="text-xs text-slate-500">{transactions.length}{hasMore ? "+" : ""} entries</span>
        </div>
        <div
          ref={feedElement}
          className="overflow-y-auto rounded-2xl bg-white shadow-card"
          style={{ height: FEED_HEIGHT }}
          onScroll={handleFeedScroll}
          aria-label="Today's transactions"
          role="list"
        >
          {transactions.length === 0 && !loadingMore && !feedError ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <ReceiptText className="text-slate-300" size={34} aria-hidden="true" />
              <p className="mt-3 font-semibold">No activity yet</p>
              <p className="mt-1 text-sm text-slate-500">Record a sale or expense to get started.</p>
            </div>
          ) : (
            <div style={{ height: Math.max(transactions.length * ROW_HEIGHT, FEED_HEIGHT), position: "relative" }}>
              {visibleTransactions.map((transaction, offset) => {
                const isCreditSale = transaction.type === "sale" && transaction.paymentType === "credit";
                const isCashIn = transaction.type !== "expense" && !isCreditSale;
                const transactionLabel = {
                  sale: "Sale",
                  expense: "Expense",
                  income: "Debt payment received",
                  debt_payment: "Debt payment"
                }[transaction.type] ?? "Transaction";
                const displayLabel = transaction.type === "sale" && transaction.paymentType === "credit"
                  ? "Credit sale"
                  : transactionLabel;
                const rowIndex = startIndex + offset;
                return (
                  <article
                    key={transaction.id}
                    role="listitem"
                    className="absolute left-0 right-0 flex items-center justify-between gap-3 border-b border-slate-100 px-4"
                    style={{ height: ROW_HEIGHT, top: rowIndex * ROW_HEIGHT }}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${isCashIn ? "bg-emerald-50 text-leaf" : "bg-amber-50 text-amber-700"}`}>
                        {isCashIn ? <ArrowDownLeft size={19} /> : <ArrowUpRight size={19} />}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{displayLabel}</p>
                        <p className="truncate text-xs text-slate-500">
                          {transaction.note || "No note"}
                          {" · "}
                          {new Date(transaction.createdAt).toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                    </div>
                    <p className={`shrink-0 font-bold ${isCreditSale ? "text-amber-800" : isCashIn ? "text-leaf" : "text-ink"}`}>
                      {isCreditSale ? formatGhs(transaction.amountPesewas) : `${isCashIn ? "+" : "−"}${formatGhs(transaction.amountPesewas)}`}
                    </p>
                  </article>
                );
              })}
            </div>
          )}
        </div>
        {feedError && (
          <div className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            <p role="alert">{feedError}</p>
            <button type="button" onClick={() => void loadMore()} className="shrink-0 font-semibold underline">Retry</button>
          </div>
        )}
        {loadingMore && <p className="py-3 text-center text-sm text-slate-500">Loading activity…</p>}
        {!loadingMore && hasMore && transactions.length > 0 && (
          <button type="button" onClick={() => void loadMore()} className="mt-3 min-h-12 w-full rounded-xl border border-slate-200 bg-white font-semibold text-leaf">
          Load earlier today
          </button>
        )}
        {!loadingMore && !hasMore && transactions.length > 0 && (
          <p className="py-3 text-center text-xs text-slate-500">You’re all caught up for today.</p>
        )}
      </section>
      <FinancialSummaryModal isOpen={isSummaryOpen} onClose={() => setIsSummaryOpen(false)} refreshKey={refreshKey} />
      {phoneEntryDebt && (
        <WhatsAppReminderModal
          key={phoneEntryDebt.id}
          debt={phoneEntryDebt}
          onClose={() => setPhoneEntryDebt(null)}
          onPhoneSaved={saveDebtPhone}
        />
      )}
    </main>
  );
}
