import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { CirclePlus, ShoppingCart } from "lucide-react";
import { db } from "../db/db.js";
import { loadHideAmounts, saveHideAmounts } from "../db/preferences.js";
import { latestReminderAt, loadReminderEvents } from "../db/reminders.js";
import { formatTime, formatWeekdayDate } from "../lib/formatDate.js";
import {
  getFinancialTransactions,
  getOutstandingDebtPesewas,
  isSaleRecord,
  summarizePosMoneySafely
} from "../lib/money.js";
import { openWhatsApp } from "../lib/openWhatsApp.js";
import { buildWhatsAppReminderText } from "../utils/whatsapp.js";
import { posText as t } from "./i18n.js";
import { HOME_TWO_COLUMN_MIN_PX, PHONE_LAYOUT } from "./layout.js";
import {
  getMoneyPeriodRange,
  getUrgentCustomerDebts,
  summarizeOwedPeople,
} from "./money.js";
import { Amount, HiddenAmount, HideAmountsButton } from "./HiddenAmount.jsx";
import { hasSavedPhone, PersonRow } from "./PartyCard.jsx";
import { PosCard, PosPage, PosSecondaryButton } from "./PosComponents.jsx";
import { useReminderCheck } from "./ReminderCheck.jsx";
import { SOFT_HERO, SOFT_HERO_EYE, SOFT_HERO_LABEL, WIDE_HERO } from "./softTile.js";
import { createPosTransactionRows } from "./transactionFeed.js";
import { compactLine, describeWideRow, TransactionTable, WhatText } from "./TransactionTable.jsx";

// The quiet "not counted" line counts only the skipped records that fall in the period Home shows
// (today); a reversal from another day that the totals query also reads is not counted here.
// A skipped entry names the record by id; its date is read from the record itself.
export function countUncountedInPeriod(skipped = [], range, transactions = []) {
  const byId = new Map(transactions.map((record) => [record.id, record]));
  const inPeriod = skipped.map((entry) => byId.get(entry?.id) ?? entry).filter((record) => {
    const when = record?.createdAt ?? record?.timestamp;
    return typeof when === "number" && when >= range.start && when < range.end;
  });
  return { sales: inPeriod.filter((record) => isSaleRecord(record)).length, other: inPeriod.filter((record) => !isSaleRecord(record)).length };
}

// Collect first: the phone shows the first person, wide Home (D1) up to two
// (wide_layout.approved_additions 3): the same list in the same order (getUrgentCustomerDebts).
export const COLLECT_FIRST_PHONE = 1;
export const COLLECT_FIRST_WIDE = 2;
// The small table on wide Home: the latest rows of 24, See all opens the rest.
export const HOME_TABLE_ROWS = 5;
// The narrow card fits what the height allows, so it is given every row of today (Today’s transactions shows 24).
const HOME_TABLE_LOADED_ROWS = 24;

// Wide Home's small table (D1): read-only, from the same rows as Today's transactions (24). A row that
// cannot be read must not stop Home loading: the card then says so and See all still opens 24.
async function loadHomeTable(transactions) {
  try {
    const suppliers = await db.suppliers.toArray();
    const rows = createPosTransactionRows(transactions, new Map(suppliers.map((supplier) => [supplier.id, supplier.name])));
    return rows.slice(0, HOME_TABLE_LOADED_ROWS);
  } catch (error) {
    console.error("Could not show today’s transactions on Home.", error);
    return null;
  }
}

const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

// ---- the pieces, shared by the phone and the wide layouts (same labels, same accessible names) ----------

// Home hero B (wiring 22, rules_global.soft_tiles, 24 Nov 2026): a soft grey tile with dark text, white
// Money in and Spent chips and a white eye button; Sell is the only saturated block on Home.
function MoneyLeftBlock({ data, hidden, onToggleHidden, wide }) {
  return (
    <section data-block="money-left" aria-label={t("home.cashLeftToday")} className={`amount-fit-container min-w-0 ${wide ? WIDE_HERO : `${SOFT_HERO} amount-fit-hero p-[18px]`}`}>
      <div className="-my-1.5 flex items-center justify-between gap-2">
        <p className={`min-w-0 text-lg font-bold ${SOFT_HERO_LABEL}`}>{t("home.cashLeftToday")}</p>
        <HideAmountsButton hidden={hidden} onToggle={onToggleHidden} className={SOFT_HERO_EYE} />
      </div>
      <p className={wide ? "mt-0.5 block whitespace-nowrap text-[56px] font-bold leading-none tracking-tight" : "amount-fit mt-0.5 font-extrabold tracking-tight"}><Amount hidden={hidden} pesewas={data.totals.cashLeft} /></p>
      <div className={`flex ${wide ? "mt-auto gap-4 pt-3" : "mt-2.5 gap-2"}`}>
        <div className={`amount-fit-container min-w-0 flex-1 rounded-[14px] ${wide ? "bg-[#F1F5F9] px-4 py-2" : "bg-white px-3 py-2"}`}>
          <p className={`font-bold ${wide ? "text-[17px] leading-tight" : "text-base"}`}>{t("home.moneyIn")}</p>
          <p className={wide ? "block whitespace-nowrap text-[28px] font-bold leading-tight" : "amount-fit font-extrabold"}><Amount hidden={hidden} pesewas={data.totals.moneyIn} /></p>
        </div>
        <div className={`amount-fit-container min-w-0 flex-1 rounded-[14px] ${wide ? "bg-[#F1F5F9] px-4 py-2" : "bg-white px-3 py-2"}`}>
          <p className={`font-bold ${wide ? "text-[17px] leading-tight" : "text-base"}`}>{t("home.moneySpent")}</p>
          <p className={wide ? "block whitespace-nowrap text-[28px] font-bold leading-tight" : "amount-fit font-extrabold"}><Amount hidden={hidden} pesewas={data.totals.moneySpent} /></p>
        </div>
      </div>
    </section>
  );
}

function SellButton({ onNavigate, className = "", wide = false }) {
  return (
    <button type="button" data-home-sell="" onClick={() => onNavigate("Sell")} className={`flex w-full items-center justify-center gap-3 ${wide ? "max-w-60 rounded-2xl text-[28px] font-bold" : "rounded-[20px] text-[30px] font-extrabold"} bg-emerald-900 px-4 text-white ${FOCUS} focus-visible:outline-emerald-800 ${className}`}>
      <ShoppingCart size={28} aria-hidden="true" /> {t("app.sell")}
    </button>
  );
}

function SpentButton({ onNavigate, className = "", wide = false }) {
  return (
    <PosSecondaryButton type="button" data-home-spent="" onClick={() => onNavigate("SpentMoney")} className={`flex w-full items-center justify-center gap-3 ${wide ? "max-w-60" : ""} ${className}`}>
      <CirclePlus size={wide ? 24 : 22} aria-hidden="true" /> {t("home.spentMoneyAction")}
    </PosSecondaryButton>
  );
}

function Uncounted({ data }) {
  const sales = data.uncounted?.sales ?? 0;
  const other = data.uncounted?.other ?? 0;
  if (sales <= 0 && other <= 0) return null;
  return (
    <div data-uncounted="">
      {sales > 0 && <p className="text-sm text-slate-700 sm:text-base">{sales === 1 ? t("money.uncountedSale") : t("money.uncountedSales", { n: sales })}</p>}
      {other > 0 && <p className="text-sm text-slate-700 sm:text-base">{other === 1 ? t("money.uncountedRecord") : t("money.uncountedRecords", { n: other })}</p>}
    </div>
  );
}

// 22 Owed card (redesign 11 Nov 2026): white, 2px light grey border; no coloured left edge (24 Nov 2026).
// See all has a 48px minimum touch target.
// "Nobody owes" (14 Nov 2026): the caller renders it only when someone has a balance above zero.
// Each Collect first person is the shared PersonRow (rules_global.person_row): the whole top row opens
// the person; Collect, WhatsApp and Call keep their own targets; WhatsApp goes through openWhatsApp.
function OwedCard({ data, hidden, urgent, onNavigate, onWhatsApp, wide }) {
  const owedPeople = data.owed?.people ?? 0;
  const owedLate = data.owed?.late ?? 0;
  const owedCountLine = [
    owedPeople === 1 ? t("home.peopleOne") : t("home.peopleMany", { n: owedPeople }),
    owedLate > 0 ? t("home.lateCount", { n: owedLate }) : ""
  ].filter(Boolean).join(" · ");
  return (
    <section data-owed-card="" aria-label={t("home.owedToYou")} className={`flex min-w-0 flex-col gap-2.5 rounded-[18px] border-2 border-slate-300 bg-white ${wide ? "px-5 py-4" : "px-4 py-3.5"}`}>
      <button type="button" onClick={() => onNavigate("PeopleWhoOweYou")} aria-label={t("home.owedSeeAllAria")} className="flex w-full min-w-0 flex-wrap items-start justify-between gap-x-2 gap-y-1 text-left text-[#0F172A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800">
        <span className="min-w-0">
          <span className="block text-[17px] font-bold text-slate-600">{t("home.owedToYou")}</span>
          <b data-owed-total="" className={`block whitespace-nowrap leading-tight text-[#0F172A] ${wide ? "text-[40px] font-bold" : "text-[30px] font-extrabold"}`}><Amount hidden={hidden} pesewas={data.debtPesewas} /></b>
          {owedPeople > 0 && <span data-owed-count="" className={`mt-0.5 block text-slate-600 ${wide ? "text-[17px]" : "text-[15px]"}`}>{owedCountLine}</span>}
        </span>
        <span data-owed-see-all="" className={`inline-flex min-h-12 shrink-0 items-center whitespace-nowrap text-[17px] text-emerald-900 ${wide ? "font-bold" : "font-extrabold"}`}>{t("home.seeAll")}</span>
      </button>
      <div className="h-px bg-slate-200" />
      <p className={`uppercase tracking-[0.06em] text-slate-600 ${wide ? "text-[17px] font-bold" : "text-[13px] font-extrabold"}`}>{t("home.collectFirst")}</p>
      {urgent.map((entry, index) => (
        <Fragment key={entry.debt.debtId}>
          {index > 0 && <div aria-hidden="true" className="h-px bg-slate-200" />}
          <PersonRow
            data-urgent-debtor=""
            wide={wide}
            maskedAmount={hidden ? <HiddenAmount /> : null}
            name={entry.debt.customerName}
            amountPesewas={entry.debt.amountPesewas}
            dueDate={entry.debt.dueDate}
            phone={entry.debt.phone}
            onOpen={() => onNavigate("DebtorDetail", entry.debt)}
            onCollect={() => onNavigate("CollectPayment", entry.debt)}
            onWhatsApp={onWhatsApp(entry)}
            onAddContact={() => onNavigate("DebtorDetail", { debtId: entry.debt.debtId, customerName: entry.debt.customerName, editContact: true })}
          />
        </Fragment>
      ))}
    </section>
  );
}

// Wide Home (wiring 22 Home row 3): Today's transactions as a small table (Time, What, Money in, Owed,
// Spent) with See all, full width below the Owed card. Every row shows its amount. The
// header button is the phone's "Today's transactions" control: same accessible name, same destination.
// rail: 12px side padding instead of 20px (with the page's 20px), so five-digit amounts in every column
// fit at 768px (decided 21 Nov 2026).
const MORE_LINE_PX = 48;

// The narrow card's body (wide_layout, Home two columns): the card is as tall as the Owed card and never
// taller (the wrapper sets the height, the card is absolutely positioned in it). Only the rows that fit
// completely are shown, newest first; a "+N more · See all" line says how many are left. Heights come from
// an invisible copy of all the rows, re-read when the body size or the rows change.
function FittedCompactRows({ rows, hidden, onNavigate }) {
  const [bodyNode, setBodyNode] = useState(null);
  const measureRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [fit, setFit] = useState(null);
  useEffect(() => {
    if (!bodyNode) return undefined;
    const read = () => setSize({ width: Math.round(bodyNode.clientWidth), height: Math.round(bodyNode.clientHeight) });
    read();
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(read);
    observer.observe(bodyNode);
    return () => observer.disconnect();
  }, [bodyNode]);
  useLayoutEffect(() => {
    const list = measureRef.current;
    if (!list || size.height <= 0) return;
    const heights = [...list.children].map((child) => child.getBoundingClientRect().height);
    const count = (limit) => { let sum = 0; let n = 0; for (const h of heights) { if (sum + h > limit + 0.5) break; sum += h; n += 1; } return n; };
    const all = count(size.height);
    setFit(all === heights.length ? heights.length : count(size.height - MORE_LINE_PX));
  }, [rows, hidden, size.width, size.height]);
  const shown = fit === null ? rows.length : Math.min(fit, rows.length);
  const more = rows.length - shown;
  return (
    <div ref={setBodyNode} data-home-compact-body="" className="relative min-h-0 flex-1 overflow-hidden">
      <ul ref={measureRef} aria-hidden="true" inert="" data-home-compact-measure="" className="pointer-events-none invisible absolute inset-x-0 top-0">{rows.map((row) => <CompactTransactionRow key={row.id} row={row} hidden={hidden} measure />)}</ul>
      <ul data-home-compact="" className="min-w-0">{rows.slice(0, shown).map((row) => <CompactTransactionRow key={row.id} row={row} hidden={hidden} />)}</ul>
      {more > 0 && (
        <button type="button" data-home-more="" onClick={() => onNavigate("TodaysTransactions")} className={`flex min-h-12 w-full items-center rounded-lg text-left text-[15px] font-bold text-[#03543F] ${FOCUS} focus-visible:outline-emerald-800`}>{t("home.moreSeeAll", { count: more })}</button>
      )}
    </div>
  );
}

function TransactionsCard({ rows, hidden, onNavigate, layout, rail = false, narrow = false }) {
  return (
    <section data-home-transactions="" aria-label={t("home.transactionsLink")} className={`flex min-w-0 flex-col rounded-[18px] border-2 border-slate-300 bg-white ${narrow ? "absolute inset-0 overflow-hidden py-3" : "py-4"} ${rail ? "px-3" : "px-5"}`}>
      <button type="button" onClick={() => onNavigate("TodaysTransactions")} aria-label={t("home.transactionsLink")} className={`flex min-h-12 w-full min-w-0 items-center justify-between gap-3 rounded-lg text-left ${FOCUS} focus-visible:outline-emerald-800`}>
        <span className="min-w-0 truncate text-[17px] font-bold text-slate-600">{t("home.transactionsLink")}</span>
        <span className="shrink-0 whitespace-nowrap text-[17px] font-extrabold text-emerald-900">{t("home.seeAll")}</span>
      </button>
      {rows === null ? (
        <p className="py-2 text-[17px] text-slate-700">{t("home.tableLoadFailed")}</p>
      ) : rows.length === 0 ? (
        <p data-home-table-empty="" className="py-2 text-[17px] text-slate-700">{t("home.noTransactions")}</p>
      ) : narrow ? (
        <FittedCompactRows rows={rows} hidden={hidden} onNavigate={onNavigate} />
      ) : (
        <TransactionTable rows={rows.slice(0, HOME_TABLE_ROWS)} amount={(pesewas) => <Amount pesewas={pesewas} hidden={hidden} />} compact layout={layout} maskedAmount={hidden ? <HiddenAmount /> : null} />
      )}
    </section>
  );
}

// The width of one element, measured (not a window width): Home's lower row asks how much room it has.
// No ResizeObserver (tests, old browsers) reads as 0, which is the one-column layout.
function useMeasuredWidth() {
  const [node, setNode] = useState(null);
  const [width, setWidth] = useState(0);
  // Layout effect: the first read lands before the first paint, so Home never shows one column and then jumps to two.
  useLayoutEffect(() => {
    if (!node) return undefined;
    const read = () => setWidth(Math.round(node.getBoundingClientRect().width));
    read();
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, width];
}

// Today's transactions in the narrow (one third) column: one compact line per row, same rows and
// formatting as the table. Left: what it was (bold) with the time and the person in 15px grey; right: the
// money in (green, +) with what went on credit under it, or the money spent (neutral, −).
function CompactTransactionRow({ row, hidden, measure = false }) {
  const view = describeWideRow(row);
  const amount = (pesewas) => <Amount pesewas={pesewas} hidden={hidden} />;
  const moneyIn = view.moneyInPesewas > 0;
  const spent = !moneyIn && view.spentPesewas > 0;
  const credit = !moneyIn && !spent && view.owedPesewas > 0;
  const line = compactLine(row, amount);
  return (
    <li {...(measure ? {} : { "data-wide-row": "", "data-home-row": "", "data-home-compact-row": "", "data-row-kind": row.kind, "data-row-id": row.id })} className="flex items-start justify-between gap-3 border-b border-slate-200 py-2 last:border-b-0">
      <span className="min-w-0">
        <span data-cell="what" className="block text-[17px] font-bold leading-snug [overflow-wrap:break-word]"><WhatText text={view.title} masked={hidden ? <HiddenAmount /> : null} /></span>
        <span data-cell="when" className="block text-[15px] leading-snug text-slate-600"><time dateTime={new Date(row.timestamp).toISOString()}>{formatTime(row.timestamp)}</time>{view.person ? ` · ${view.person}` : ""}</span>
        {line && <span data-cell="what-line2" className="block text-[15px] leading-snug text-slate-600">{line}</span>}
      </span>
      <span className="shrink-0 text-right">
        {moneyIn && <span data-cell="money-in" className="block whitespace-nowrap text-[17px] font-bold text-[#03543F]">+{amount(view.moneyInPesewas)}</span>}
        {spent && <span data-cell="spent" className="block whitespace-nowrap text-[17px] font-bold text-[#0F172A]">−{amount(view.spentPesewas)}</span>}
        {credit && <span data-cell="owed" className="block whitespace-nowrap text-[17px] font-bold text-[#0F172A]">{amount(view.owedPesewas)}</span>}
        {moneyIn && view.owedPesewas > 0 && <span data-cell="on-credit" className="block whitespace-nowrap text-[15px] leading-snug text-slate-600">{t("home.onCreditLine", { amount: "{amount}" }).split("{amount}").flatMap((part, index) => (index === 0 ? [part] : [<Fragment key={index}>{amount(view.owedPesewas)}</Fragment>, part]))}</span>}
      </span>
    </li>
  );
}

// layout comes from PosApp (layout.js, the one decision). Phone: the layout as built (unchanged).
// Wide (D1 on the sidebar, D6 on the rail): the same pieces in cards; only one strong green block
// (Money left; Sell is a button).
export default function Home({ onNavigate, notice = "", shopName, layout = PHONE_LAYOUT }) {
  const wide = layout.wide;
  const range = useMemo(() => getMoneyPeriodRange("day"), []);
  const [lowerRef, lowerWidth] = useMeasuredWidth();
  const data = useLiveQuery(async () => {
    // rules_global.hide_amounts: the setting loads with the figures, so they never show before it is known.
    const [transactions, debts, reminderEvents, hideAmounts] = await Promise.all([
      getFinancialTransactions(range),
      db.debts.where("status").equals("unpaid").toArray(),
      loadReminderEvents(),
      loadHideAmounts()
    ]);
    // A record that cannot be counted is left out and logged; it must not stop Home loading.
    const { totals, skipped } = summarizePosMoneySafely(transactions);
    // The people behind Collect first, for the shared reminder check. The phone's one person is
    // urgentDebt (as before); wide Home adds the next one (urgentMore).
    const [urgentDebt = null, ...more] = getUrgentCustomerDebts(debts).slice(0, wide ? COLLECT_FIRST_WIDE : COLLECT_FIRST_PHONE);
    // The person key for the reminder log (stored values, as before; the sheet shows it through displayName).
    const personOf = (debt) => ({
      customerId: debts.find((row) => row.id === debt.debtId)?.customerId ?? "",
      name: debt.customerName
    });
    const lastReminder = (person) => latestReminderAt(reminderEvents, { customerId: person.customerId, customerName: person.name });
    const urgentPerson = urgentDebt ? personOf(urgentDebt) : null;
    return {
      hideAmounts,
      totals,
      debtPesewas: getOutstandingDebtPesewas(debts),
      urgentDebt,
      urgentPerson,
      urgentLastReminderAt: urgentPerson ? lastReminder(urgentPerson) : 0,
      urgentMore: more.map((debt) => { const person = personOf(debt); return { debt, person, lastReminderAt: lastReminder(person) }; }),
      owed: summarizeOwedPeople(debts),
      uncounted: countUncountedInPeriod(skipped, range, transactions),
      table: wide ? await loadHomeTable(transactions) : undefined
    };
  }, [range.start, range.end, wide], null);
  // rules_global.reminders: every WhatsApp button goes through the shared check and records the reminder;
  // rules_global.whatsapp_links: it opens WhatsApp through the shared opener. rules_global.person_row:
  // WhatsApp and Call with any saved number; the text names the real shop, as on 32, 29/43 and Debt saved.
  const reminders = useReminderCheck();
  const onWhatsApp = (entry) => (event) => reminders.onReminder(event, {
    person: entry.person,
    lastReminderAt: entry.lastReminderAt,
    share: () => openWhatsApp({
      text: hasSavedPhone(entry.debt.phone) ? buildWhatsAppReminderText(entry.debt.customerName, entry.debt.amountPesewas, shopName) : null,
      phone: entry.debt.phone,
      title: t("collect.remindOnWhatsApp")
    })
  });
  const urgentDebt = data?.urgentDebt;
  const urgent = urgentDebt ? [
    { debt: urgentDebt, person: data.urgentPerson ?? { customerId: "", name: urgentDebt.customerName ?? "" }, lastReminderAt: data.urgentLastReminderAt ?? 0 },
    ...(wide ? data.urgentMore ?? [] : [])
  ] : [];
  // Hidden until the setting is known to be false (wiring 22 Hide amounts): a real amount never flashes.
  const hidden = data?.hideAmounts !== false;
  const toggleHidden = () => saveHideAmounts(!hidden).catch(() => {});
  const noticeLine = notice && <p role="status" className="rounded-xl border-2 border-emerald-900 bg-emerald-100 p-3 text-base font-bold text-emerald-950">{notice}</p>;
  const loading = <PosCard><p className="text-base font-semibold">{t("home.loading")}</p></PosCard>;

  if (!wide) {
    return (
      <PosPage style={{ paddingTop: 14 }} className="flex flex-col gap-3 px-4 sm:px-6">
        {noticeLine}
        {!data ? loading : (
          <>
            <MoneyLeftBlock data={data} hidden={hidden} onToggleHidden={toggleHidden} />
            <Uncounted data={data} />
            <div className="flex flex-col gap-3">
              <SellButton onNavigate={onNavigate} className="h-[76px]" />
              <SpentButton onNavigate={onNavigate} className="h-14" />
            </div>
            {/* "Nobody owes" (14 Nov 2026): no Owed card; Spent money is followed by Today's transactions. */}
            {urgent.length > 0 && <OwedCard data={data} hidden={hidden} urgent={urgent} onNavigate={onNavigate} onWhatsApp={onWhatsApp} />}
            {/* rules_global.button_system.open_text_sweep: "Today’s transactions" is an other button (22 only). */}
            <PosSecondaryButton type="button" onClick={() => onNavigate("TodaysTransactions")} className="w-full">
              {t("home.transactionsLink")}
            </PosSecondaryButton>
          </>
        )}
        {reminders.sheet}
      </PosPage>
    );
  }

  const sidebar = layout.mode === "sidebar";
  // Two columns (Owed 2/3, transactions 1/3) only when the row has at least HOME_TWO_COLUMN_MIN_PX.
  const twoColumns = sidebar && urgent.length > 0 && lowerWidth >= HOME_TWO_COLUMN_MIN_PX;
  return (
    // Money on wide screens uses equal-width digits (wide_layout.sizes), so the whole page is tabular-nums.
    <PosPage wide rail={!sidebar} className="flex flex-col gap-5 tabular-nums">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-[30px] font-extrabold leading-tight text-[#0F172A]">{t("home.title")}</h1>
        {/* The rail has no room for the date under the shop name (D6): it sits beside the title. */}
        {!sidebar && <p data-home-date="" className="text-[17px] font-semibold text-slate-700">{formatWeekdayDate(range.start)}</p>}
      </div>
      {noticeLine}
      {!data ? loading : (
        <>
          <div data-home-row-1="" className={sidebar ? "grid grid-cols-[minmax(0,1fr)_240px] gap-4" : "flex flex-col gap-5"}>
            <MoneyLeftBlock data={data} hidden={hidden} onToggleHidden={toggleHidden} wide />
            {/* The rail: Sell and Spent money share the row equally, so "Spent money" never wraps (768px). */}
            <div data-home-actions="" className={sidebar ? "flex flex-col gap-4" : "grid grid-cols-2 gap-4"}>
              <SellButton wide onNavigate={onNavigate} className={sidebar ? "min-h-24 max-h-40 flex-1 self-end" : "h-24 max-w-none!"} />
              <SpentButton wide onNavigate={onNavigate} className={sidebar ? "min-h-16 self-end" : "h-24 max-w-none!"} />
            </div>
          </div>
          <Uncounted data={data} />
          {/* Row 2: Owed to you; row 3: Today's transactions full width (wiring 22 Home, 21 Nov 2026: five-digit
              amounts do not fit beside the Owed card at 17px). Nobody owes: the table is the only card. */}
          <div ref={lowerRef} data-home-row-2="" data-columns={twoColumns ? 2 : 1} className={twoColumns ? "grid min-h-[240px] grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-stretch gap-5" : "flex flex-col gap-5"}>
            {urgent.length > 0 && <OwedCard data={data} hidden={hidden} urgent={urgent} onNavigate={onNavigate} onWhatsApp={onWhatsApp} wide />}
            {twoColumns ? (
              <div data-home-transactions-slot="" className="relative min-w-0">
                <TransactionsCard rows={data.table ?? null} hidden={hidden} onNavigate={onNavigate} layout={layout} rail={!sidebar} narrow />
              </div>
            ) : (
              <TransactionsCard rows={data.table ?? null} hidden={hidden} onNavigate={onNavigate} layout={layout} rail={!sidebar} />
            )}
          </div>
        </>
      )}
      {reminders.sheet}
    </PosPage>
  );
}
