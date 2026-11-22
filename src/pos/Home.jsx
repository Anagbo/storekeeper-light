import { Fragment, useMemo } from "react";
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
import { PHONE_LAYOUT } from "./layout.js";
import {
  getMoneyPeriodRange,
  getUrgentCustomerDebts,
  summarizeOwedPeople,
} from "./money.js";
import { Amount, HideAmountsButton } from "./HiddenAmount.jsx";
import { hasSavedPhone, PersonRow } from "./PartyCard.jsx";
import { PosCard, PosPage, PosSecondaryButton } from "./PosComponents.jsx";
import { useReminderCheck } from "./ReminderCheck.jsx";
import { createPosTransactionRows, describeHomeTableRow } from "./transactionFeed.js";

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

// Wide Home's small table (D1): read-only, from the same rows as Today's transactions (24). A row that
// cannot be read must not stop Home loading: the card then says so and See all still opens 24.
async function loadHomeTable(transactions) {
  try {
    const suppliers = await db.suppliers.toArray();
    const rows = createPosTransactionRows(transactions, new Map(suppliers.map((supplier) => [supplier.id, supplier.name])));
    return rows.slice(0, HOME_TABLE_ROWS).map((row) => ({ id: row.id, timestamp: row.timestamp, ...describeHomeTableRow(row) }));
  } catch (error) {
    console.error("Could not show today’s transactions on Home.", error);
    return null;
  }
}

const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

// ---- the pieces, shared by the phone and the wide layouts (same labels, same accessible names) ----------

function MoneyLeftBlock({ data, hidden, onToggleHidden, wide }) {
  return (
    <section data-block="money-left" aria-label={t("home.cashLeftToday")} className={`amount-fit-container min-w-0 rounded-3xl bg-emerald-900 text-white ${wide ? "p-4" : "p-[18px]"}`}>
      <div className="-my-1.5 flex items-center justify-between gap-2">
        <p className="min-w-0 text-lg font-bold">{t("home.cashLeftToday")}</p>
        <HideAmountsButton hidden={hidden} onToggle={onToggleHidden} className="border-white/70 bg-white/10 text-white" />
      </div>
      <p className={wide ? "mt-0.5 block whitespace-nowrap text-[56px] font-bold leading-none tracking-tight" : "amount-fit mt-0.5 font-extrabold tracking-tight"}><Amount hidden={hidden} pesewas={data.totals.cashLeft} /></p>
      <div className={`flex ${wide ? "mt-3 gap-4" : "mt-2.5 gap-2"}`}>
        <div className={`amount-fit-container min-w-0 flex-1 rounded-[14px] bg-white/20 ${wide ? "px-4 py-2" : "px-3 py-2"}`}>
          <p className={`font-bold ${wide ? "text-[17px] leading-tight" : "text-base"}`}>{t("home.moneyIn")}</p>
          <p className={wide ? "block whitespace-nowrap text-[28px] font-bold leading-tight" : "amount-fit font-extrabold"}><Amount hidden={hidden} pesewas={data.totals.moneyIn} /></p>
        </div>
        <div className={`amount-fit-container min-w-0 flex-1 rounded-[14px] bg-white/20 ${wide ? "px-4 py-2" : "px-3 py-2"}`}>
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
    <button type="button" data-home-spent="" onClick={() => onNavigate("SpentMoney")} className={`flex w-full items-center justify-center gap-3 px-4 text-2xl ${wide ? "max-w-60 rounded-2xl border-2 border-[#0F172A] bg-white font-bold text-[#0F172A] focus-visible:outline-emerald-800" : "rounded-[20px] bg-amber-500 font-extrabold text-slate-950 focus-visible:outline-amber-800"} ${FOCUS} ${className}`}>
      <CirclePlus size={wide ? 24 : 22} aria-hidden="true" /> {t("home.spentMoneyAction")}
    </button>
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

// 22 Owed card (redesign 11 Nov 2026): white, 2px light grey border, thicker red left edge.
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
    <section data-owed-card="" aria-label={t("home.owedToYou")} className={`flex min-w-0 flex-col gap-2.5 rounded-[18px] border-2 border-l-8 border-slate-300 border-l-rose-700 bg-white ${wide ? "px-5 py-4" : "px-4 py-3.5"}`}>
      <button type="button" onClick={() => onNavigate("PeopleWhoOweYou")} aria-label={t("home.owedSeeAllAria")} className="flex w-full min-w-0 flex-wrap items-start justify-between gap-x-2 gap-y-1 text-left text-[#0F172A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800">
        <span className="min-w-0">
          <span className="block text-[17px] font-bold text-slate-600">{t("home.owedToYou")}</span>
          <b data-owed-total="" className={`block whitespace-nowrap leading-tight text-[#0F172A] ${wide ? "text-[40px] font-bold" : "text-[30px] font-extrabold"}`}><Amount hidden={hidden} pesewas={data.debtPesewas} /></b>
          {owedPeople > 0 && <span data-owed-count="" className={`mt-0.5 block text-slate-600 ${wide ? "text-[17px]" : "text-[15px]"}`}>{owedCountLine}</span>}
        </span>
        <span className={`shrink-0 whitespace-nowrap pt-0.5 text-[17px] text-emerald-900 ${wide ? "font-bold" : "font-extrabold"}`}>{t("home.seeAll")}</span>
      </button>
      <div className="h-px bg-slate-200" />
      <p className={`uppercase tracking-[0.06em] text-slate-600 ${wide ? "text-[15px] font-bold" : "text-[13px] font-extrabold"}`}>{t("home.collectFirst")}</p>
      {urgent.map((entry, index) => (
        <Fragment key={entry.debt.debtId}>
          {index > 0 && <div aria-hidden="true" className="h-px bg-slate-200" />}
          <PersonRow
            data-urgent-debtor=""
            wide={wide}
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

// The What text wraps between words (never cut with an ellipsis); an amount inside it ("Sale of
// GH₵12,348.00") is one unbreakable piece, so money is never split or cut (audit FAIL 2, 21 Nov 2026).
const AMOUNT_IN_TEXT = /(GH₵[\d,]+\.\d{2})/;
export function WhatText({ text }) {
  return String(text).split(AMOUNT_IN_TEXT).map((part, index) => (
    index % 2 === 1 ? <span key={index} data-what-amount="" className="whitespace-nowrap">{part}</span> : part
  ));
}

// An empty cell shows a dash (as on 24 wide, D4).
export const DASH = <span className="font-normal text-slate-500">—</span>;

// 24's amount colours and signs (TodaysTransactions AMOUNT_TONES): money in green with +, spent
// amber-brown with −, credit dark red with no sign, a correction plain dark with no sign.
const CELL_TONES = {
  in: { className: "text-[#03543F]", sign: "+" },
  spent: { className: "text-[#92400E]", sign: "−" },
  credit: { className: "text-[#7F1D1D]", sign: "" },
  neutral: { className: "text-slate-800", sign: "" }
};

export function AmountCell({ name, pesewas, tone, hidden }) {
  const look = CELL_TONES[tone] ?? CELL_TONES.neutral;
  return (
    <td data-cell={name} data-tone={pesewas > 0 ? tone : undefined} className={`whitespace-nowrap p-2 text-right font-extrabold ${look.className}`}>
      {pesewas > 0 ? <>{look.sign}<Amount hidden={hidden} pesewas={pesewas} /></> : DASH}
    </td>
  );
}

// Wide Home (wiring 22 Home row 3): Today's transactions as a small table (Time, What, Money in, Owed,
// Spent) with See all, full width below the Owed card. Every row shows its amount. The
// header button is the phone's "Today's transactions" control: same accessible name, same destination.
// rail: 12px side padding instead of 20px (with the page's 20px), so five-digit amounts in every column
// fit at 768px (decided 21 Nov 2026).
function TransactionsCard({ rows, hidden, onNavigate, rail = false }) {
  return (
    <section data-home-transactions="" aria-label={t("home.transactionsLink")} className={`flex min-w-0 flex-col rounded-[18px] border-2 border-slate-300 bg-white py-4 ${rail ? "px-3" : "px-5"}`}>
      <button type="button" onClick={() => onNavigate("TodaysTransactions")} aria-label={t("home.transactionsLink")} className={`flex min-h-12 w-full min-w-0 items-center justify-between gap-3 rounded-lg text-left ${FOCUS} focus-visible:outline-emerald-800`}>
        <span className="min-w-0 truncate text-[17px] font-bold text-slate-600">{t("home.transactionsLink")}</span>
        <span className="shrink-0 whitespace-nowrap text-[17px] font-extrabold text-emerald-900">{t("home.seeAll")}</span>
      </button>
      {rows === null ? (
        <p className="py-2 text-[17px] text-slate-700">{t("home.tableLoadFailed")}</p>
      ) : rows.length === 0 ? (
        <p data-home-table-empty="" className="py-2 text-[17px] text-slate-700">{t("home.noTransactions")}</p>
      ) : (
        <table className="w-full border-collapse text-[17px] tabular-nums">
          <thead>
            <tr className="border-b-2 border-slate-300 text-[15px] font-bold text-slate-600">
              <th scope="col" className="whitespace-nowrap p-2 text-left">{t("home.tableTime")}</th>
              <th scope="col" className="w-full p-2 text-left">{t("home.tableWhat")}</th>
              <th scope="col" className="whitespace-nowrap p-2 text-right">{t("home.tableMoneyIn")}</th>
              <th scope="col" className="whitespace-nowrap p-2 text-right">{t("home.tableOwed")}</th>
              <th scope="col" className="whitespace-nowrap p-2 text-right">{t("home.tableSpent")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} data-home-row="" className="border-b border-slate-200">
                <td className="whitespace-nowrap p-2"><time dateTime={new Date(row.timestamp).toISOString()}>{formatTime(row.timestamp)}</time></td>
                <td data-cell="what" className="p-2 leading-snug"><WhatText text={row.title} /></td>
                <AmountCell name="money-in" tone="in" pesewas={row.moneyInPesewas} hidden={hidden} />
                <AmountCell name="owed" tone={row.owedTone} pesewas={row.owedPesewas} hidden={hidden} />
                <AmountCell name="spent" tone={row.spentTone} pesewas={row.spentPesewas} hidden={hidden} />
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// layout comes from PosApp (layout.js, the one decision). Phone: the layout as built (unchanged).
// Wide (D1 on the sidebar, D6 on the rail): the same pieces in cards; only one strong green block
// (Money left; Sell is a button).
export default function Home({ onNavigate, notice = "", shopName, layout = PHONE_LAYOUT }) {
  const wide = layout.wide;
  const range = useMemo(() => getMoneyPeriodRange("day"), []);
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
            <div data-home-actions="" className={sidebar ? "flex flex-col gap-4" : "grid grid-cols-2 gap-5"}>
              <SellButton wide onNavigate={onNavigate} className={sidebar ? "min-h-24 max-h-40 flex-1 self-end" : "h-24"} />
              <SpentButton wide onNavigate={onNavigate} className={sidebar ? "min-h-16 self-end" : "h-24 justify-self-end"} />
            </div>
          </div>
          <Uncounted data={data} />
          {/* Row 2: Owed to you; row 3: Today's transactions full width (wiring 22 Home, 21 Nov 2026: five-digit
              amounts do not fit beside the Owed card at 17px). Nobody owes: the table is the only card. */}
          <div data-home-row-2="" className="flex flex-col gap-5">
            {urgent.length > 0 && <OwedCard data={data} hidden={hidden} urgent={urgent} onNavigate={onNavigate} onWhatsApp={onWhatsApp} wide />}
            <TransactionsCard rows={data.table ?? null} hidden={hidden} onNavigate={onNavigate} rail={!sidebar} />
          </div>
        </>
      )}
      {reminders.sheet}
    </PosPage>
  );
}
