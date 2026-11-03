import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Banknote, CirclePlus, MessageCircle, Phone, ShoppingCart, UserRoundPen, UsersRound } from "lucide-react";
import { db } from "../db/db.js";
import { formatGhs } from "../lib/money.js";
import { getFinancialTransactions } from "../utils/financials.js";
import { generateWhatsAppLink, normalizeWhatsAppPhone } from "../utils/whatsapp.js";
import { posText as t } from "./i18n.js";
import {
  getDebtDueLabel,
  getMoneyPeriodRange,
  getMostUrgentCustomerDebt,
  getOutstandingDebtPesewas,
  summarizeMoney
} from "./money.js";
import { PosCard, PosPage } from "./PosComponents.jsx";

export default function Home({ onNavigate, onLegacyEntry, notice = "" }) {
  const range = useMemo(() => getMoneyPeriodRange("day"), []);
  const data = useLiveQuery(async () => {
    const [transactions, debts] = await Promise.all([
      getFinancialTransactions(range),
      db.debts.where("status").equals("unpaid").toArray()
    ]);
    return {
      totals: summarizeMoney(transactions),
      debtPesewas: getOutstandingDebtPesewas(debts),
      urgentDebt: getMostUrgentCustomerDebt(debts)
    };
  }, [range.start, range.end], null);
  const urgentDebt = data?.urgentDebt;
  const normalizedPhone = normalizeWhatsAppPhone(urgentDebt?.phone);
  const whatsappLink = urgentDebt && generateWhatsAppLink(
    urgentDebt.phone,
    urgentDebt.customerName,
    urgentDebt.amountPesewas / 100
  );
  const dialablePhone = normalizedPhone?.replace(/[^\d+]/g, "");
  const dueLabel = urgentDebt ? getDebtDueLabel(urgentDebt.dueDate) : "";
  const isOverdue = dueLabel.startsWith("Late ");

  return (
    <PosPage style={{ paddingTop: 14 }} className="flex flex-col gap-3 px-4 sm:px-6 lg:min-h-0 lg:grid lg:grid-cols-2 lg:content-start lg:items-start lg:gap-5">
      {notice && <p role="status" className="rounded-xl border-2 border-emerald-900 bg-emerald-100 p-3 text-base font-bold text-emerald-950 lg:col-span-2">{notice}</p>}
      {!data ? (
        <PosCard className="lg:col-span-2"><p className="text-base font-semibold">{t("home.loading")}</p></PosCard>
      ) : (
        <>
          <section aria-label={t("home.todayMoney")} className="amount-fit-container rounded-3xl bg-emerald-900 p-[18px] text-white lg:col-span-2 lg:p-7">
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

          <div className="flex flex-col gap-3 lg:col-start-1 lg:row-start-2">
            <button type="button" onClick={() => onNavigate("Sell")} className="flex h-[76px] w-full items-center justify-center gap-3 rounded-[20px] bg-emerald-900 px-4 text-[30px] font-extrabold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800">
              <ShoppingCart size={28} aria-hidden="true" /> {t("app.sell")}
            </button>

            <button type="button" onClick={() => onNavigate("SpentMoney")} className="flex h-14 w-full items-center justify-center gap-3 rounded-[20px] bg-amber-500 px-4 text-2xl font-extrabold text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800 lg:h-16">
              <CirclePlus size={22} aria-hidden="true" /> {t("home.spentMoneyAction")}
            </button>
          </div>

          <section className="amount-fit-container rounded-[20px] bg-rose-200 p-4 lg:p-6">
            <div className="flex items-center gap-2.5 text-rose-900">
              <UsersRound size={28} aria-hidden="true" />
              <button type="button" onClick={() => onNavigate("PeopleWhoOweYou")} className="min-h-11 text-left text-lg font-bold underline decoration-2 underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-900">
                {t("home.peopleWhoOwe")}
              </button>
            </div>
            <p className="amount-fit mb-2.5 mt-1 font-extrabold text-rose-900">{formatGhs(data.debtPesewas)}</p>
            {urgentDebt ? (
              <div className="flex items-center gap-2.5 rounded-2xl bg-white px-3 py-2.5 lg:gap-3 lg:p-4">
                <button type="button" onClick={() => onNavigate("DebtorDetail", urgentDebt)} className="amount-fit-container min-w-0 flex-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800">
                  <span className="block truncate text-[19px] font-extrabold">{urgentDebt.customerName}</span>
                  <span className="amount-fit font-bold text-slate-800">{formatGhs(urgentDebt.amountPesewas)}</span>
                  <span className={`mt-0.5 inline-flex min-h-10 items-center rounded-[10px] border-2 px-3 text-base font-extrabold ${isOverdue ? "border-rose-900 bg-rose-200 text-rose-900" : urgentDebt.dueDate ? "border-amber-800 bg-amber-100 text-amber-950" : "border-slate-700 bg-slate-100 text-slate-950"}`}>{dueLabel}</span>
                </button>
                <button type="button" onClick={() => onNavigate("CollectPayment", urgentDebt)} aria-label={t("home.collectPayment", { name: urgentDebt.customerName })} className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-emerald-900 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 lg:h-16 lg:w-16">
                  <Banknote size={27} aria-hidden="true" />
                </button>
                {dialablePhone ? (
                  <>
                    <a href={whatsappLink || undefined} target={whatsappLink ? "_blank" : undefined} rel={whatsappLink ? "noopener noreferrer" : undefined} aria-label={t("home.whatsappCustomer", { name: urgentDebt.customerName })} aria-disabled={!whatsappLink} className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl border-2 border-emerald-900 bg-white text-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 lg:h-16 lg:w-16 ${whatsappLink ? "" : "pointer-events-none opacity-40"}`}>
                      <MessageCircle size={27} aria-hidden="true" />
                    </a>
                    <a href={`tel:${dialablePhone}`} aria-label={t("home.callCustomer", { name: urgentDebt.customerName })} className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-slate-300 text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 lg:h-16 lg:w-16">
                      <Phone size={26} aria-hidden="true" />
                    </a>
                  </>
                ) : (
                  <button type="button" onClick={() => onNavigate("DebtorDetail", { debtId: urgentDebt.debtId, customerName: urgentDebt.customerName, editContact: true })} aria-label={t("contact.addFor", { name: urgentDebt.customerName })} className="grid min-h-14 shrink-0 place-items-center rounded-2xl border-2 border-emerald-900 bg-white px-2 text-center text-xs font-extrabold text-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 lg:min-h-16 lg:text-sm">
                    <UserRoundPen size={24} aria-hidden="true" />{t("contact.add")}
                  </button>
                )}
              </div>
            ) : <p className="mt-2 text-base font-semibold text-slate-800">{t("home.noDebtors")}</p>}
          </section>

          <button type="button" onClick={() => onNavigate("TodaysTransactions")} className="min-h-11 py-1 text-center text-lg font-extrabold text-emerald-900 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 lg:col-start-1">
            {t("home.transactionsLink")}
          </button>
        </>
      )}
    </PosPage>
  );
}
