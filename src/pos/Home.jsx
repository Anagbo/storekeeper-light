import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Banknote, CirclePlus, ShoppingCart, UserRoundPen } from "lucide-react";
import { db } from "../db/db.js";
import {
  formatGhs,
  getFinancialTransactions,
  getOutstandingDebtPesewas,
  isSaleRecord,
  summarizePosMoneySafely
} from "../lib/money.js";
import { displayName } from "../lib/displayName.js";
import { generateWhatsAppLink } from "../utils/whatsapp.js";
import { posText as t } from "./i18n.js";
import {
  getMoneyPeriodRange,
  getMostUrgentCustomerDebt,
  summarizeOwedPeople,
} from "./money.js";
import { callHrefFor, PartyCard } from "./PartyCard.jsx";
import { PosCard, PosPage } from "./PosComponents.jsx";

function WhatsAppIcon({ size = 27 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z" fill="#25D366" />
      <path d="M8.5 7.2c.3-.5.8-.5 1.1-.3l1 2c.1.3 0 .6-.2.8l-.6.7c.7 1.3 1.7 2.3 3 3l.8-.6c.2-.2.5-.2.8-.1l1.9 1c.3.2.4.6.2 1-.4 1-1.4 1.6-2.4 1.4-3.2-.7-6-3.4-6.8-6.5-.1-.6.1-1.1.3-1.6z" fill="#fff" />
    </svg>
  );
}

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

export default function Home({ onNavigate, notice = "" }) {
  const range = useMemo(() => getMoneyPeriodRange("day"), []);
  const data = useLiveQuery(async () => {
    const [transactions, debts] = await Promise.all([
      getFinancialTransactions(range),
      db.debts.where("status").equals("unpaid").toArray()
    ]);
    // A record that cannot be counted is left out and logged; it must not stop Home loading.
    const { totals, skipped } = summarizePosMoneySafely(transactions);
    return {
      totals,
      debtPesewas: getOutstandingDebtPesewas(debts),
      urgentDebt: getMostUrgentCustomerDebt(debts),
      owed: summarizeOwedPeople(debts),
      uncounted: countUncountedInPeriod(skipped, range, transactions)
    };
  }, [range.start, range.end], null);
  const urgentDebt = data?.urgentDebt;
  const urgentName = urgentDebt ? displayName(urgentDebt.customerName) : "";
  // WhatsApp and Call only with a valid number (PartyCard); never a greyed, disabled button.
  const whatsappLink = urgentDebt && callHrefFor(urgentDebt.phone) ? generateWhatsAppLink(
    urgentDebt.phone,
    urgentDebt.customerName,
    urgentDebt.amountPesewas
  ) : null;
  const owedPeople = data?.owed?.people ?? 0;
  const owedLate = data?.owed?.late ?? 0;
  const owedCountLine = [
    owedPeople === 1 ? t("home.peopleOne") : t("home.peopleMany", { n: owedPeople }),
    owedLate > 0 ? t("home.lateCount", { n: owedLate }) : ""
  ].filter(Boolean).join(" · ");
  const uncountedSales = data?.uncounted?.sales ?? 0;
  const uncountedOther = data?.uncounted?.other ?? 0;

  return (
    <PosPage style={{ paddingTop: 14 }} className="flex flex-col gap-3 px-4 sm:px-6 lg:min-h-0 lg:grid lg:grid-cols-2 lg:content-start lg:items-start lg:gap-5">
      {notice && <p role="status" className="rounded-xl border-2 border-emerald-900 bg-emerald-100 p-3 text-base font-bold text-emerald-950 lg:col-span-2">{notice}</p>}
      {!data ? (
        <PosCard className="lg:col-span-2"><p className="text-base font-semibold">{t("home.loading")}</p></PosCard>
      ) : (
        <>
          <section aria-label={t("home.cashLeftToday")} className="amount-fit-container rounded-3xl bg-emerald-900 p-[18px] text-white lg:col-span-2 lg:p-7">
            <p className="text-lg font-bold">{t("home.cashLeftToday")}</p>
            <p className="amount-fit mt-0.5 font-extrabold tracking-tight">{formatGhs(data.totals.cashLeft)}</p>
            <div className="mt-2.5 flex gap-2 lg:mt-5 lg:max-w-2xl lg:gap-4">
              <div className="amount-fit-container min-w-0 flex-1 rounded-[14px] bg-white/20 px-3 py-2 lg:px-5 lg:py-4">
                <p className="text-base font-bold lg:text-lg">{t("home.moneyIn")}</p>
                <p className="amount-fit font-extrabold">{formatGhs(data.totals.moneyIn)}</p>
              </div>
              <div className="amount-fit-container min-w-0 flex-1 rounded-[14px] bg-white/20 px-3 py-2 lg:px-5 lg:py-4">
                <p className="text-base font-bold lg:text-lg">{t("home.moneySpent")}</p>
                <p className="amount-fit font-extrabold">{formatGhs(data.totals.moneySpent)}</p>
              </div>
            </div>
          </section>
          {(uncountedSales > 0 || uncountedOther > 0) && (
            <div data-uncounted="" className="lg:col-span-2">
              {uncountedSales > 0 && <p className="text-sm text-slate-700 sm:text-base">{uncountedSales === 1 ? t("money.uncountedSale") : t("money.uncountedSales", { n: uncountedSales })}</p>}
              {uncountedOther > 0 && <p className="text-sm text-slate-700 sm:text-base">{uncountedOther === 1 ? t("money.uncountedRecord") : t("money.uncountedRecords", { n: uncountedOther })}</p>}
            </div>
          )}

          <div className="flex flex-col gap-3 lg:col-start-1 lg:row-start-2">
            <button type="button" onClick={() => onNavigate("Sell")} className="flex h-[76px] w-full items-center justify-center gap-3 rounded-[20px] bg-emerald-900 px-4 text-[30px] font-extrabold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800">
              <ShoppingCart size={28} aria-hidden="true" /> {t("app.sell")}
            </button>

            <button type="button" onClick={() => onNavigate("SpentMoney")} className="flex h-14 w-full items-center justify-center gap-3 rounded-[20px] bg-amber-500 px-4 text-2xl font-extrabold text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800 lg:h-16">
              <CirclePlus size={22} aria-hidden="true" /> {t("home.spentMoneyAction")}
            </button>
          </div>

          {/* 22 Owed card (redesign 11 Nov 2026): white, 2px light grey border, thicker red left edge. */}
          <section data-owed-card="" aria-label={t("home.owedToYou")} className="flex min-w-0 flex-col gap-2.5 rounded-[18px] border-2 border-l-8 border-slate-300 border-l-rose-700 bg-white px-4 py-3.5 lg:p-6">
            <button type="button" onClick={() => onNavigate("PeopleWhoOweYou")} aria-label={t("home.owedSeeAllAria")} className="flex w-full min-w-0 flex-wrap items-start justify-between gap-x-2 gap-y-1 text-left text-[#0F172A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800">
              <span className="min-w-0">
                <span className="block text-[17px] font-bold text-slate-600">{t("home.owedToYou")}</span>
                <b data-owed-total="" className="block whitespace-nowrap text-[30px] font-extrabold leading-tight text-[#0F172A]">{formatGhs(data.debtPesewas)}</b>
                {owedPeople > 0 && <span data-owed-count="" className="mt-0.5 block text-[15px] text-slate-600">{owedCountLine}</span>}
              </span>
              <span className="shrink-0 whitespace-nowrap pt-0.5 text-[17px] font-extrabold text-emerald-900">{t("home.seeAll")}</span>
            </button>
            {urgentDebt ? (
              <>
                <div className="h-px bg-slate-200" />
                <p className="text-[13px] font-extrabold uppercase tracking-[0.06em] text-slate-600">{t("home.collectFirst")}</p>
                <PartyCard
                  framed={false}
                  data-urgent-debtor=""
                  name={urgentDebt.customerName}
                  onNameClick={() => onNavigate("DebtorDetail", urgentDebt)}
                  amountPesewas={urgentDebt.amountPesewas}
                  amountSize={22}
                  dueDate={urgentDebt.dueDate}
                  action={{ label: t("home.collect"), ariaLabel: t("home.collectPayment", { name: urgentName }), icon: Banknote, onClick: () => onNavigate("CollectPayment", urgentDebt) }}
                  whatsapp={whatsappLink ? { href: whatsappLink, label: t("home.whatsappCustomer", { name: urgentName }), icon: <WhatsAppIcon size={24} /> } : null}
                  phone={urgentDebt.phone}
                  callLabel={t("home.callCustomer", { name: urgentName })}
                  extra={callHrefFor(urgentDebt.phone) ? null : (
                    <button type="button" onClick={() => onNavigate("DebtorDetail", { debtId: urgentDebt.debtId, customerName: urgentDebt.customerName, editContact: true })} aria-label={t("contact.addFor", { name: urgentName })} className="flex h-[52px] shrink-0 items-center gap-1.5 rounded-[14px] border-2 border-emerald-900 bg-white px-3 text-sm font-extrabold text-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800">
                      <UserRoundPen size={22} aria-hidden="true" />{t("contact.add")}
                    </button>
                  )}
                />
              </>
            ) : <p className="text-base font-semibold text-slate-800">{t("home.noDebtors")}</p>}
          </section>

          <button type="button" onClick={() => onNavigate("TodaysTransactions")} className="min-h-11 py-1 text-center text-lg font-extrabold text-emerald-900 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 lg:col-start-1">
            {t("home.transactionsLink")}
          </button>
        </>
      )}
    </PosPage>
  );
}
