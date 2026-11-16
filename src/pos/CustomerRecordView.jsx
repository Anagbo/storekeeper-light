import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db.js";
import { displayName } from "../lib/displayName.js";
import { formatGhs, getOutstandingDebtPesewas } from "../lib/money.js";
import { loadCustomerHistory } from "../utils/loadCustomerDebtHistory.js";
import { CREDIT_ROW_TYPES, groupCollectionHistory, paidParts, rowReason, rowWhen } from "./historyRows.js";
import CorrectionLines from "./CorrectionLines.jsx";
import { posText as t } from "./i18n.js";
import { PosBackButton, PosPage } from "./PosComponents.jsx";
import SignedTag from "./SignedTag.jsx";

// Wiring 73 "Show {Name} the record" (rules_global.customer_proof, 16 Nov 2026). Read only, for the
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

function Card({ dashed = false, kind, children }) {
  return (
    <li data-record-row={kind} className={`flex min-w-0 flex-col gap-1 rounded-[18px] border-2 px-3.5 py-2.5 ${dashed ? "border-dashed border-slate-400" : "border-slate-300"}`}>
      {children}
    </li>
  );
}

function Row({ title, amount, amountClass }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2">
      <strong className="min-w-0 truncate text-[20px] leading-tight">{title}</strong>
      <strong className={`shrink-0 whitespace-nowrap text-[22px] leading-tight ${amountClass}`}>{amount}</strong>
    </div>
  );
}

function RecordRow({ event }) {
  if (event.type === "payment") {
    return (
      <Card kind="paid">
        <Row title={t("collect.paid")} amount={formatGhs(event.amountPesewas)} amountClass="text-emerald-900" />
        <p className="break-words text-lg text-slate-800">{rowWhen(event)} · {paidParts(event)}</p>
      </Card>
    );
  }
  if (event.type === "adjustment") {
    return (
      <Card kind="corrected" dashed>
        <CorrectionLines event={event} size="card" />
      </Card>
    );
  }
  if (CREDIT_ROW_TYPES.has(event.type)) {
    return (
      <Card kind="credit">
        <Row title={t("record.tookOnCredit")} amount={formatGhs(event.amountPesewas)} amountClass="text-rose-950" />
        {/* Polish 16 Nov 2026: the date and the reason on their own lines, the same size, in 29's order. */}
        <p data-when="" className="text-lg text-slate-800">{rowWhen(event)}</p>
        <p data-reason="" className="break-words text-lg text-slate-800">{rowReason(event)}</p>
        <SignedTag signed={event.signed} />
      </Card>
    );
  }
  return null;
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
          <section className="amount-fit-container rounded-[20px] bg-[#FFE4E9] px-4 py-3">
            <p className="text-[22px] font-bold">{t("record.youOwe")}</p>
            <p className="amount-fit font-extrabold leading-tight text-rose-950">{formatGhs(data.balancePesewas)}</p>
          </section>
          <h2 className="text-2xl font-extrabold">{t("collect.onTimeHistory")}</h2>
          {data.rows.length ? (
            <ul className="flex flex-col gap-2.5">
              {data.rows.map((event) => <RecordRow key={event.id} event={event} />)}
            </ul>
          ) : <p className="text-lg text-slate-800">{t("record.nothingYet")}</p>}
        </>
      )}
      <p className="text-lg text-slate-600">{t("record.caption")}</p>
      <button type="button" onClick={onBack} className="h-[60px] w-full rounded-2xl border-[3px] border-emerald-900 bg-emerald-900 px-3 text-xl font-extrabold text-white">
        {t("record.backToShop")}
      </button>
    </PosPage>
  );
}
