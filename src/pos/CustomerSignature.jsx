import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db.js";
import { signCreditEvent } from "../db/signatures.js";
import { getCreditEventAmountPesewas, getCreditReason } from "../lib/creditReason.js";
import { displayName } from "../lib/displayName.js";
import { formatDate } from "../lib/formatDate.js";
import { formatGhs } from "../lib/money.js";
import { isValidDateString } from "../utils/installments.js";
import { useBackBlock } from "./browserBack.js";
import { posText as t } from "./i18n.js";
import { PosBackButton, PosPage } from "./PosComponents.jsx";
import SignatureBox from "./SignatureBox.jsx";

// Wiring 72 "Customer signs" (rules_global.customer_proof, 16 Nov 2026). The credit is ALREADY saved
// when this opens; nothing here can block or undo it. Done saves the signature on that credit event,
// Skip for now leaves it Not signed; both (and Back, and the phone back) continue through SIGNED
// (PosApp finishSignature). The phone is in the customer's hand: text 18px or more, buttons 52px or more.
function takenDate(event) {
  if (event?.type === "manual_debt" && isValidDateString(event.takenOn ?? "")) return formatDate(event.takenOn);
  return formatDate(event?.createdAt ?? event?.timestamp);
}

function payByDate(event, debt) {
  const due = event?.dueDate || (debt && !debt.isInstallmentPlan ? debt.dueDate : "");
  return due ? formatDate(due) : "";
}

export default function CustomerSignature({ params = {}, onFinish, shopName }) {
  const data = useLiveQuery(async () => {
    const event = params.transactionId ? await db.transactions.get(params.transactionId) : null;
    const debt = event?.debtId ? await db.debts.get(event.debtId) : null;
    return { event: event ?? null, debt: debt ?? null };
  }, [params.transactionId], undefined);
  const [strokes, setStrokes] = useState([]);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState("");
  useBackBlock(saving);
  const hasInk = strokes.some((stroke) => stroke.length > 0);
  const event = data?.event;
  const reason = event ? getCreditReason(event) : "";
  const payBy = payByDate(event, data?.debt);

  async function done() {
    if (!hasInk || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await signCreditEvent({ transactionId: params.transactionId, strokes });
      onFinish();
    } catch (signError) {
      console.error("Could not save the signature.", signError);
      setError(/already signed/.test(signError?.message ?? "") ? t("signature.alreadySigned") : t("signature.saveFailed"));
      savingRef.current = false;
      setSaving(false);
    }
  }

  function skip() {
    if (savingRef.current) return;
    onFinish();
  }

  return (
    <PosPage className="flex flex-col gap-3 text-lg">
      <div className="flex items-center gap-3">
        <PosBackButton onClick={skip} disabled={saving} />
        <h1 className="min-w-0 text-[26px] font-extrabold leading-tight">{t("signature.title")}</h1>
      </div>
      {data === undefined ? (
        <p role="status" className="text-lg">{t("app.loadingScreen")}</p>
      ) : event ? (
        <section data-sign-card="" className="min-w-0 rounded-[18px] bg-[#FFE4E9] px-3.5 py-3">
          <p className="break-words text-[19px] font-bold">{t("signature.owes", { name: displayName(event.customer_name ?? event.customerName ?? ""), shop: shopName })}</p>
          <p data-sign-amount="" className="text-[40px] font-extrabold leading-tight text-rose-950">{formatGhs(getCreditEventAmountPesewas(event))}</p>
          <p className="mt-1.5 break-words text-lg">{t("signature.for", { reason: reason || t("creditRow.noReason") })}</p>
          <p className="text-lg">{t("signature.taken", { date: takenDate(event) })}</p>
          {payBy && <p className="text-lg">{t("signature.payBy", { date: payBy })}</p>}
        </section>
      ) : (
        <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 text-lg font-semibold text-rose-950">{t("signature.notFound")}</p>
      )}
      <SignatureBox strokes={strokes} onChange={setStrokes} disabled={saving || !event} />
      {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 text-lg font-semibold text-rose-950">{error}</p>}
      <button type="button" onClick={() => { setStrokes([]); setError(""); }} disabled={saving} className="h-[52px] self-end rounded-2xl border-[3px] border-slate-500 bg-white px-5 text-xl font-extrabold text-slate-900 disabled:opacity-50">
        {t("signature.clear")}
      </button>
      {/* Wiring 72: Done full width, disabled until there is ink. */}
      <button type="button" onClick={() => void done()} disabled={!hasInk || saving || !event} className="h-[60px] w-full rounded-2xl border-[3px] border-emerald-900 bg-emerald-900 px-2 text-xl font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-45">
        {saving ? t("signature.saving") : t("signature.done")}
      </button>
      <button type="button" onClick={skip} disabled={saving} className="min-h-[52px] self-center px-3 text-[19px] font-bold text-slate-800 underline underline-offset-4">
        {t("signature.skip")}
      </button>
    </PosPage>
  );
}
