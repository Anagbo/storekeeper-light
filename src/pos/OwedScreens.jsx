import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Banknote, Phone, Plus, UserRound, UserRoundPen } from "lucide-react";
import { db } from "../db/db.js";
import { formatGhs } from "../lib/money.js";
import { hasSearchText, squashSearchText } from "../lib/searchMatch.js";
import { posText } from "./i18n.js";
import { displayName } from "../lib/displayName.js";
import { getDebtDueDate, groupUnpaidDebts, isDebtDueSoon, isDebtLate, loadAllUnpaidDebts, loadUnpaidDebtPage, matchesOwedSearch, OWED_PAGE_SIZE } from "./owed.js";
import SearchField from "./SearchField.jsx";
import { DueTag } from "./PartyCard.jsx";
import { PosPage, PosPrimaryButton, PosSecondaryButton } from "./PosComponents.jsx";
import { generateWhatsAppLink } from "../utils/whatsapp.js";

function WhatsAppIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z" fill="#25D366" />
      <path d="M8.5 7.2c.3-.5.8-.5 1.1-.3l1 2c.1.3 0 .6-.2.8l-.6.7c.7 1.3 1.7 2.3 3 3l.8-.6c.2-.2.5-.2.8-.1l1.9 1c.3.2.4.6.2 1-.4 1-1.4 1.6-2.4 1.4-3.2-.7-6-3.4-6.8-6.5-.1-.6.1-1.1.3-1.6z" fill="#fff" />
    </svg>
  );
}

export default function PeopleWhoOweYou({ onBack, onNavigate, onCollect, shopName }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [additionalDebts, setAdditionalDebts] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const firstPage = useLiveQuery(async () => {
    try {
      return { status: "ready", ...(await loadUnpaidDebtPage()) };
    } catch (error) {
      console.error("Could not load outstanding debts.", error);
      return { status: "error", debts: [], nextCursor: null, hasMore: false };
    }
  }, [reloadKey], { status: "loading", debts: [], nextCursor: null, hasMore: false });
  const customerResult = useLiveQuery(async () => {
    try {
      return { status: "ready", customers: await db.customers.toArray() };
    } catch (error) {
      console.error("Could not load customer details for outstanding debts.", error);
      return { status: "error", customers: [] };
    }
  }, [reloadKey], { status: "loading", customers: [] });

  useEffect(() => {
    if (firstPage.status !== "ready") return;
    setAdditionalDebts([]);
    setNextCursor(firstPage.nextCursor);
    setHasMore(firstPage.hasMore);
  }, [firstPage]);

  const data = useMemo(() => {
    if (firstPage.status !== "ready" || customerResult.status !== "ready") return undefined;
    return groupUnpaidDebts([...firstPage.debts, ...additionalDebts], customerResult.customers);
  }, [additionalDebts, customerResult, firstPage]);
  const matchesFilter = (customer) => filter === "all" ||
    (filter === "late" ? isDebtLate(customer.debt) : isDebtDueSoon(customer.debt));
  // With text in the search field every open debt is searched (the phone's own database, no
  // network), not only the pages loaded so far. The filter and the search work together; the
  // results are paged like the list. Clearing the field returns to the normal list.
  const searching = hasSearchText(query);
  const searchSource = useLiveQuery(async () => {
    if (!searching) return null;
    try {
      return { status: "ready", debts: await loadAllUnpaidDebts() };
    } catch (error) {
      console.error("Could not search outstanding debts.", error);
      return { status: "error", debts: [] };
    }
  }, [searching, reloadKey], null);
  const searchKey = `${filter}|${squashSearchText(query)}`;
  const [searchPaging, setSearchPaging] = useState({ key: "", extra: 0 });
  const searchLimit = OWED_PAGE_SIZE + (searchPaging.key === searchKey ? searchPaging.extra : 0);
  const searchMatches = useMemo(() => {
    if (!searching || searchSource?.status !== "ready" || customerResult.status !== "ready") return [];
    return groupUnpaidDebts(searchSource.debts, customerResult.customers)
      .filter((customer) => matchesOwedSearch(customer, query) && matchesFilter(customer));
  }, [searching, searchSource, customerResult, filter, query]);
  const searchLoading = searching && (!searchSource || customerResult.status === "loading");
  const searchFailed = searching && (searchSource?.status === "error" || customerResult.status === "error");
  const visibleCustomers = useMemo(() => {
    if (searching) return searchMatches.slice(0, searchLimit);
    if (!data) return [];
    return data.filter(matchesFilter);
  }, [searching, searchMatches, searchLimit, data, filter]);
  const totalPesewas = (searching ? searchMatches : visibleCustomers).reduce((total, customer) => total + customer.balancePesewas, 0);
  const isLoading = searching ? searchLoading : firstPage.status === "loading" || customerResult.status === "loading";
  const hasFailed = searching ? searchFailed : firstPage.status === "error" || customerResult.status === "error";

  async function loadMore() {
    if (loadingMore || !hasMore || !nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await loadUnpaidDebtPage({ after: nextCursor });
      setAdditionalDebts((current) => [...current, ...page.debts]);
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setLoadError("");
    } catch (error) {
      console.error("Could not load more outstanding debts.", error);
      setLoadError("More outstanding debts could not be loaded. Try again.");
    } finally {
      setLoadingMore(false);
    }
  }

  const showMoreControl = searching ? searchMatches.length > searchLimit && (
    <div className="mt-3 flex w-full flex-col gap-2">
      <PosSecondaryButton type="button" onClick={() => setSearchPaging({ key: searchKey, extra: (searchPaging.key === searchKey ? searchPaging.extra : 0) + OWED_PAGE_SIZE })} className="w-full">
        Show more
      </PosSecondaryButton>
    </div>
  ) : hasMore && (
    <div className="mt-3 flex w-full flex-col gap-2">
      {loadError && <p role="alert" className="text-sm font-semibold text-rose-900">{loadError}</p>}
      <PosSecondaryButton type="button" onClick={loadMore} disabled={loadingMore} className="w-full">
        {loadingMore ? "Loading…" : loadError ? "Try again" : "Show more"}
      </PosSecondaryButton>
    </div>
  );

  function openDetails(customer, editContact = false) {
    onNavigate("DebtorDetail", {
      customerId: customer.customerId,
      customerName: customer.customerName,
      debtId: customer.representativeDebtId,
      ...(editContact ? { editContact: true, returnToOwed: true } : {})
    });
  }

  function openAddDebt() {
    onNavigate("WhoOwesYou", { manualDebt: true });
  }

  const addDebtButton = (
    <PosPrimaryButton type="button" onClick={openAddDebt} className="!border-[3px] !border-emerald-900 !bg-white !text-xl !text-emerald-900">
      <Plus size={27} aria-hidden="true" /> Add debt
    </PosPrimaryButton>
  );

  return (
    <PosPage className="mx-auto flex max-w-2xl flex-col gap-4">
      {addDebtButton}
      <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Debt filters">
        {[
          ["all", "All"],
          ["late", "Late"],
          ["soon", "Due soon"]
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={value === filter}
            onClick={() => setFilter(value)}
            className={`min-h-14 rounded-2xl border-2 px-2 text-base font-extrabold ${value === filter ? "border-slate-900 bg-slate-900 text-white" : "border-slate-500 bg-white text-slate-900"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <SearchField value={query} onChange={setQuery} />
      {isLoading ? (
        <section role="status" aria-label="Loading outstanding balances" className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3].map((filterButton) => <div key={filterButton} className="h-14 animate-pulse rounded-2xl bg-slate-200" />)}
          </div>
          <div className="rounded-3xl bg-rose-100 p-4">
            <div className="mb-3 h-7 w-48 animate-pulse rounded bg-rose-200" />
            <div className="mb-4 h-10 w-40 animate-pulse rounded bg-rose-200" />
            <div className="flex flex-col gap-3">
              {[1, 2].map((customer) => <div key={customer} className="h-24 animate-pulse rounded-3xl bg-white/80" />)}
            </div>
          </div>
        </section>
      ) : hasFailed ? (
        <section role="alert" className="flex flex-col items-center gap-3 rounded-2xl border-2 border-rose-300 bg-rose-50 p-5 text-center">
          <p className="font-bold text-rose-950">Outstanding balances could not be loaded. Try again.</p>
          <PosSecondaryButton type="button" onClick={() => {
            setLoadError("");
            setReloadKey((key) => key + 1);
          }}>
            Retry
          </PosSecondaryButton>
        </section>
      ) : visibleCustomers.length === 0 ? (
        <section className="rounded-2xl border-2 border-slate-300 p-6 text-center">
          <UserRound className="mx-auto text-slate-400" size={34} aria-hidden="true" />
          {searching ? <p className="mt-3 font-bold">{posText("owed.noSearchMatches")}</p> : (
            <>
              <p className="mt-3 font-bold">No one owes you right now.</p>
              <p className="mt-1 text-sm text-slate-700">{filter === "all" ? "Record a credit sale to see an outstanding balance here." : `No ${filter === "late" ? "late" : "due soon"} debts right now.`}</p>
            </>
          )}
          {showMoreControl}
        </section>
      ) : (
        <section className="box-border min-w-0 w-full rounded-3xl bg-rose-200 px-4 pb-5 pt-4" aria-label="People who owe you">
          <div className="mb-3 flex items-center gap-2 text-rose-900">
            <UserRound size={27} aria-hidden="true" />
            <h1 className="text-xl font-extrabold">People who owe you</h1>
          </div>
          <p className="mb-4 text-4xl font-extrabold text-rose-900">
            {formatGhs(totalPesewas)}
          </p>
          <div className="flex flex-col gap-3" role="list">
          {visibleCustomers.map((customer) => {
            const dueDate = getDebtDueDate(customer.debt);
            const whatsappUrl = generateWhatsAppLink(
              customer.phone,
              customer.customerName,
              customer.balancePesewas,
              shopName
            );
            return (
              <article key={customer.id} role="listitem" className="flex min-w-0 items-center gap-2 rounded-3xl bg-white p-3">
                <button type="button" onClick={() => openDetails(customer)} className="min-w-0 flex-1 text-left">
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-xl">{displayName(customer.customerName)}</strong>
                    <span className="block text-base text-slate-900">{formatGhs(customer.balancePesewas)}</span>
                    {dueDate && <DueTag dueDate={dueDate} />}
                  </span>
                </button>
                <div className={`grid shrink-0 gap-2 ${whatsappUrl ? "grid-cols-3" : "grid-cols-2"}`}>
                  <PosPrimaryButton type="button" onClick={() => customer.debtIds.length === 1
                    ? onCollect({ id: customer.representativeDebtId, customerId: customer.customerId, customerName: customer.customerName, amountPesewas: customer.balancePesewas, phone: customer.phone })
                    : openDetails(customer)} aria-label={`Collect from ${displayName(customer.customerName)}`} className="!h-14 !min-h-0 !w-14 !p-0 max-[380px]:!h-12 max-[380px]:!w-12">
                    <Banknote size={22} aria-hidden="true" />
                  </PosPrimaryButton>
                  {whatsappUrl ? (
                    <>
                      <a href={whatsappUrl} aria-label={`WhatsApp ${displayName(customer.customerName)}`} className="grid h-14 w-14 place-items-center rounded-2xl border-2 border-emerald-900 bg-white text-emerald-900 max-[380px]:h-12 max-[380px]:w-12">
                        <WhatsAppIcon />
                      </a>
                      <a href={`tel:${customer.phone}`} aria-label={`Call ${displayName(customer.customerName)}`} className="grid h-14 w-14 place-items-center rounded-2xl border-2 border-slate-300 bg-slate-300 text-slate-900 max-[380px]:h-12 max-[380px]:w-12">
                        <Phone size={25} aria-hidden="true" />
                      </a>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openDetails(customer, true)}
                      aria-label={`Add phone for ${displayName(customer.customerName)}`}
                      className="grid h-14 w-14 place-items-center rounded-2xl border-2 border-emerald-900 bg-white text-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 max-[380px]:h-12 max-[380px]:w-12"
                    >
                      <UserRoundPen size={24} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </article>
            );
          })}
          </div>
          {showMoreControl}
        </section>
      )}
    </PosPage>
  );
}
