import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db.js";
import { displayName } from "../lib/displayName.js";
import { formatGhs, getOutstandingDebtPesewas } from "../lib/money.js";
import { loadCustomerHistory } from "../utils/loadCustomerDebtHistory.js";
import { groupCollectionHistory } from "./historyRows.js";
import EventRows from "./EventRows.jsx";
import { posText as t } from "./i18n.js";
import { PosBackButton, PosPage } from "./PosComponents.jsx";
import { SOFT_TILE } from "./softTile.js";

// Wiring 73 "Show {Name} the record" (rules_global.customer_proof, 16 Nov 2026). Look-only, for the
// customer to read: the balance as "You owe", then what happened, newest first. Paid rows, credit rows
// (what for, Signed ✓ or Not signed) and every balance correction from 54 as its own dashed card (old →
// new, reason). No edit, collect, correct, reminder or delete controls; no profit, cost, other
// customers, totals or phone numbers. Amounts are never hidden by Hide amounts (this is one person).
export async function loadCustomerRecord({ customerId, customerName }) {
  const name = customerName ?? "";
  const customer = customerId
    ? await db.customers.get(customerId)
    : name.trim() ? await db.customers.where("nameLower").equals(name.trim().toLowerCase()).first() : null;
  const shownName = customer?.name ?? name;
  if (!shownName.trim()) return null;
  const id = customer?.id ?? customerId ?? "";
  const normalizedName = shownName.trim().toLowerCase();
  const debts = (await db.debts.toArray()).filter((debt) => (
    (id && debt.customerId === id) ||
    (!debt.customerId && (debt.customer_name ?? debt.customerName ?? "").trim().toLowerCase() === normalizedName)
  ));
  const history = await loadCustomerHistory(id, shownName);
  return {
    name: shownName,
    balancePesewas: getOutstandingDebtPesewas(debts),
    rows: groupCollectionHistory(history.events)
  };
}

export default function CustomerRecordView({ params = {}, onBack }) {
  const data = useLiveQuery(
    () => loadCustomerRecord({ customerId: params.customerId, customerName: params.customerName }),
    [params.customerId, params.customerName],
    undefined
  );
  return (
    <PosPage className="flex flex-col gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <PosBackButton onClick={onBack} />
        <h1 className="min-w-0 truncate text-[28px] font-extrabold leading-tight">{data ? displayName(data.name) : ""}</h1>
      </div>
      {data === undefined ? (
        <p role="status" className="text-lg">{t("app.loadingScreen")}</p>
      ) : !data ? (
        <p role="alert" className="text-lg">{t("record.notFound")}</p>
      ) : (
        <>
          <section className={`amount-fit-container ${SOFT_TILE} px-4 py-3`}>
            <p className="text-[17px] font-bold text-slate-600">{t("record.youOwe")}</p>
            <p className="amount-fit font-bold leading-tight tabular-nums text-[#0F172A]" style={{ fontSize: "40px" }}>{formatGhs(data.balancePesewas)}</p>
          </section>
          {/* Wiring 73 notice (16 Nov 2026): one plain line right under You owe, so a long history never
              pushes it off screen. */}
          <p data-record-notice="" className="text-base text-slate-600">{t("record.notice")}</p>
          <h2 className="text-2xl font-extrabold">{t("collect.onTimeHistory")}</h2>
          {data.rows.length ? (
            <ul className="flex flex-col gap-2.5">
              {data.rows.map((event) => <EventRows key={event.id} event={event} creditTitle={t("record.tookOnCredit")} />)}
            </ul>
          ) : <p className="text-lg text-slate-800">{t("record.nothingYet")}</p>}
        </>
      )}
      <button type="button" onClick={onBack} className="h-[60px] w-full rounded-2xl border-[3px] border-emerald-900 bg-emerald-900 px-3 text-xl font-extrabold text-white">
        {t("record.backToShop")}
      </button>
    </PosPage>
  );
}
