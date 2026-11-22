import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { UserRound } from "lucide-react";
import { db } from "../db/db.js";
import { formatGhs } from "../lib/money.js";
import { hasSearchText, squashSearchText } from "../lib/searchMatch.js";
import { posText } from "./i18n.js";
import { displayName } from "../lib/displayName.js";
import { getDebtDueDate, groupUnpaidDebts, isDebtDueSoon, isDebtLate, loadAllUnpaidDebts, loadUnpaidDebtPage, matchesOwedSearch, OWED_PAGE_SIZE } from "./owed.js";
import SearchField from "./SearchField.jsx";
import { DueTag, hasSavedPhone, PersonRow } from "./PartyCard.jsx";
import { AddButton, PosPage, PosSecondaryButton } from "./PosComponents.jsx";
import { openWhatsApp } from "../lib/openWhatsApp.js";
import { buildWhatsAppReminderText } from "../utils/whatsapp.js";
import { latestReminderAt, loadReminderEvents } from "../db/reminders.js";
import { useReminderCheck } from "./ReminderCheck.jsx";
import { PHONE_LAYOUT } from "./layout.js";

// wide_layout.screens "32, 29, 43 Owed" (D3, list_with_detail): on wide layouts (layout.js, the one
// decision) the list sits on the left and the selected person on the right. The selection lives in
// this screen's own route params (owedSelected), changed by replacing the current entry, so it
// survives a trip to 25, 73 or Add to debt and never touches another screen's draft.
// `renderDetail({ customerId, customerName, debtId })` is the 29/43 detail without Back and Done.
export default function PeopleWhoOweYou({ onBack, onNavigate, onCollect, shopName, layout = PHONE_LAYOUT, params = {}, onUpdateParams, renderDetail }) {
  const wide = layout.wide && typeof renderDetail === "function";
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
      const [customers, reminderEvents] = await Promise.all([db.customers.toArray(), loadReminderEvents()]);
      return { status: "ready", customers, reminderEvents };
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

  // rules_global.reminders: each row's WhatsApp button goes through the shared check and records the
  // reminder. No Last reminder text on this screen. rules_global.whatsapp_links: the button opens
  // WhatsApp through the shared opener (the person's chat in the installed app on a phone).
  const reminders = useReminderCheck();
  function onWhatsApp(event, customer, text) {
    const person = { customerId: customer.customerId ?? "", name: customer.customerName };
    return reminders.onReminder(event, {
      person,
      lastReminderAt: latestReminderAt(customerResult.reminderEvents ?? [], { customerId: person.customerId, customerName: person.name }),
      share: () => openWhatsApp({ text, phone: customer.phone, title: posText("collect.remindOnWhatsApp") })
    });
  }

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
    <AddButton onClick={openAddDebt}>Add debt</AddButton>
  );

  // D3: the person shown on the right. The chosen one while listed; otherwise the first listed person.
  const listed = !isLoading && !hasFailed ? visibleCustomers : [];
  const selected = wide ? (listed.find((customer) => customer.id === params.owedSelected) ?? listed[0] ?? null) : null;
  const selectedId = selected?.id ?? null;
  useEffect(() => {
    if (!wide || !selectedId || selectedId === params.owedSelected) return;
    onUpdateParams?.({ owedSelected: selectedId });
  }, [wide, selectedId, params.owedSelected]);

  if (wide) {
    return (
      <WideOwed
        layout={layout}
        addDebtButton={addDebtButton}
        filter={filter}
        setFilter={setFilter}
        query={query}
        setQuery={setQuery}
        isLoading={isLoading}
        hasFailed={hasFailed}
        onRetry={() => { setLoadError(""); setReloadKey((key) => key + 1); }}
        customers={visibleCustomers}
        searching={searching}
        totalPesewas={totalPesewas}
        showMoreControl={showMoreControl}
        selected={selected}
        onSelect={(customer) => onUpdateParams?.({ owedSelected: customer.id })}
        renderDetail={renderDetail}
      />
    );
  }

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
          <div className="flex flex-col gap-3">
            <div className="rounded-[20px] border-2 border-[#CBD5E1] bg-white px-4 py-3">
              <div className="mb-2 h-4 w-40 animate-pulse rounded bg-slate-200" />
              <div className="h-8 w-40 animate-pulse rounded bg-slate-200" />
            </div>
            {[1, 2].map((customer) => <div key={customer} className="h-24 animate-pulse rounded-3xl border-2 border-slate-200 bg-white" />)}
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
        <section className="box-border flex min-w-0 w-full flex-col gap-3" aria-label="Total owed to you">
          <div data-owed-summary className="box-border min-w-0 w-full rounded-[20px] border-2 border-[#CBD5E1] bg-white px-4 py-3">
            <h2 className="text-sm font-bold text-slate-600">Total owed to you</h2>
            <p data-owed-total className="break-words text-[30px] font-bold leading-tight text-[#0F172A]">
              {formatGhs(totalPesewas)}
            </p>
          </div>
          <div className="flex flex-col gap-3" role="list">
          {visibleCustomers.map((customer) => {
            const dueDate = getDebtDueDate(customer.debt);
            // rules_global.person_row: Home's row. WhatsApp and Call with any saved number; a number
            // that fails the WhatsApp check opens the share sheet through the opener.
            const reminderText = hasSavedPhone(customer.phone)
              ? buildWhatsAppReminderText(customer.customerName, customer.balancePesewas, shopName)
              : null;
            return (
              <article key={customer.id} role="listitem" className="min-w-0 w-full rounded-3xl border-2 border-slate-200 bg-white p-4">
                <PersonRow
                  name={customer.customerName}
                  amountPesewas={customer.balancePesewas}
                  dueDate={dueDate}
                  phone={customer.phone}
                  onOpen={() => openDetails(customer)}
                  collectLabel={`Collect from ${displayName(customer.customerName)}`}
                  onCollect={() => customer.debtIds.length === 1
                    ? onCollect({ id: customer.representativeDebtId, customerId: customer.customerId, customerName: customer.customerName, amountPesewas: customer.balancePesewas, phone: customer.phone })
                    : openDetails(customer)}
                  onWhatsApp={(event) => onWhatsApp(event, customer, reminderText)}
                  onAddContact={() => openDetails(customer, true)}
                />
              </article>
            );
          })}
          </div>
          {showMoreControl}
        </section>
      )}
      {reminders.sheet}
    </PosPage>
  );
}

const FILTERS = [["all", "All"], ["late", "Late"], ["soon", "Due soon"]];
// The wide focus ring is one rule in styles.css (.pos-app:not([data-layout="phone"])).

// D3 on wide layouts. Left (about 400px): search, All / Late / Due soon, the plain summary card, the
// people rows (name, tag and amount only: Collect, WhatsApp and Call are in the detail, same_as_phone
// (c)) and Show more. Right: the selected person (29/43). Add debt at the top right of the page.
function WideOwed({ layout, addDebtButton, filter, setFilter, query, setQuery, isLoading, hasFailed, onRetry, customers, searching, totalPesewas, showMoreControl, selected, onSelect, renderDetail }) {
  return (
    <PosPage wide rail={layout.mode !== "sidebar"} className="flex flex-col gap-5 tabular-nums">
      <div data-owed-top="" className="flex min-w-0 items-center justify-between gap-4">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="text-[30px] font-bold leading-tight text-slate-900">Owed</h1>
          {!isLoading && !hasFailed && <p data-owed-count="" className="text-[17px] text-slate-600">{customers.length} {customers.length === 1 ? "person" : "people"} · {customers.filter((customer) => isDebtLate(customer.debt)).length} late</p>}
        </div>
        <div className="w-auto shrink-0">{addDebtButton}</div>
      </div>
      <div data-owed-columns="" className="grid min-w-0 items-start gap-5" style={{ gridTemplateColumns: "min(400px, 44%) minmax(0, 1fr)" }}>
        <section data-owed-list="" aria-label="Total owed to you" className="flex min-w-0 flex-col gap-4">
          <SearchField value={query} onChange={setQuery} wide />
          <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Debt filters">
            {FILTERS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={value === filter}
                onClick={() => setFilter(value)}
                className={`min-h-14 min-w-0 whitespace-nowrap rounded-2xl border-2 px-2 text-base font-extrabold ${value === filter ? "border-slate-900 bg-slate-900 text-white" : "border-slate-500 bg-white text-slate-900 hover:bg-slate-50"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {isLoading ? (
            <section role="status" aria-label="Loading outstanding balances" className="flex flex-col gap-3">
              <div className="rounded-[20px] border-2 border-[#CBD5E1] bg-white px-4 py-3">
                <div className="mb-2 h-4 w-40 animate-pulse rounded bg-slate-200" />
                <div className="h-8 w-40 animate-pulse rounded bg-slate-200" />
              </div>
              {[1, 2].map((row) => <div key={row} className="h-20 animate-pulse rounded-3xl border-2 border-slate-200 bg-white" />)}
            </section>
          ) : hasFailed ? (
            <section role="alert" className="flex flex-col items-center gap-3 rounded-2xl border-2 border-rose-300 bg-rose-50 p-5 text-center">
              <p className="font-bold text-rose-950">Outstanding balances could not be loaded. Try again.</p>
              <PosSecondaryButton type="button" onClick={onRetry}>Retry</PosSecondaryButton>
            </section>
          ) : customers.length === 0 ? (
            <section data-owed-empty="" className="rounded-2xl border-2 border-slate-300 bg-white p-6 text-center">
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
            <>
              <div data-owed-summary="" className="box-border min-w-0 w-full rounded-[20px] border-2 border-[#CBD5E1] bg-white px-4 py-3">
                <h1 className="text-[17px] font-bold text-slate-600">Total owed to you</h1>
                <p data-owed-total="" className="whitespace-nowrap text-[30px] font-bold leading-tight text-[#0F172A]">{formatGhs(totalPesewas)}</p>
              </div>
              <div className="flex flex-col gap-3" role="list">
                {customers.map((customer) => {
                  const current = customer.id === selected?.id;
                  const shown = displayName(customer.customerName);
                  const dueDate = getDebtDueDate(customer.debt);
                  return (
                    <article key={customer.id} role="listitem" className="min-w-0">
                      {/* rules_global.person_row: the same accessible name as the phone row's tap-through.
                          Selecting stays on this page; the chosen row has a light green fill AND a green
                          border (never colour alone) and aria-current. */}
                      <button
                        type="button"
                        data-owed-row={customer.id}
                        aria-label={posText("person.openDetails", { name: shown })}
                        aria-current={current ? "true" : undefined}
                        onClick={() => onSelect(customer)}
                        className={`grid min-h-[64px] w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 rounded-3xl border-2 p-4 text-left ${current ? "border-emerald-900 bg-green-50 shadow-[inset_0_0_0_2px_#064E3B]" : "border-slate-200 bg-white hover:border-slate-400"}`}
                      >
                        <span data-party-name="" className="col-start-1 row-start-1 line-clamp-2 min-w-0 break-words text-[19px] font-extrabold leading-tight">{shown}</span>
                        <span data-party-amount="" className={`col-start-2 row-start-1 ${dueDate ? "row-span-2" : ""} whitespace-nowrap text-[22px] font-extrabold leading-tight`}>{formatGhs(customer.balancePesewas)}</span>
                        {dueDate && <span data-party-tag="" className="col-span-full row-start-2 mt-1.5 whitespace-nowrap"><DueTag dueDate={dueDate} /></span>}
                      </button>
                    </article>
                  );
                })}
              </div>
              {showMoreControl}
            </>
          )}
        </section>
        <section data-owed-detail="" aria-label={selected ? displayName(selected.customerName) : "Selected person"} className="min-w-0 rounded-[20px] border-2 border-[#CBD5E1] bg-white p-5">
          {selected && renderDetail({ customerId: selected.customerId, customerName: selected.customerName, debtId: selected.representativeDebtId })}
        </section>
      </div>
    </PosPage>
  );
}
