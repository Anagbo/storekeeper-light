import { useRef, useState } from "react";
import { posText as t } from "./i18n.js";
import { isSaveOutcomeUnknown } from "../lib/saveAttempt.js";
import { useLargeAmountConfirm } from "./LargeAmountConfirm.jsx";
import SaveAttemptNotice from "./SaveAttemptNotice.jsx";
import { useSaveAttempt } from "./useSaveAttempt.js";
import { getInitialPaymentParts, getPaidPaymentPesewas } from "./paymentAmount.js";
import SplitPayment from "./SplitPayment.jsx";
import { describeSplitPart } from "./splitTender.js";

export default function SaleSplitPayment({ params = {}, onBack, onNavigate, onUpdateParams, onSaveSale }) {
  const totalPesewas = Number.isSafeInteger(params.amountPesewas) ? params.amountPesewas : 0;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // E8: a ref, not the state, so a second tap in the same frame sees the first one.
  const savingRef = useRef(false);
  const saveAttempt = useSaveAttempt();
  const lastPartsRef = useRef(null);
  const largeAmount = useLargeAmountConfirm();

  async function saveSale(parts, confirmed = false) {
    if (savingRef.current) return;
    // Brief 3.12: a large sale asks first, before the save starts and before the attempt key is used.
    // A split with an Owe part reaches here from 18/19 too, so it asks once, here.
    if (!confirmed && largeAmount.guard(totalPesewas, () => void saveSale(parts, true))) return;
    savingRef.current = true;
    const amountOf = (method) => parts.filter((part) => part.paymentMethod === method).reduce((sum, part) => sum + part.amountPesewas, 0);
    setSaving(true);
    setError("");
    lastPartsRef.current = parts;
    try {
      // E9: the route params come first, so they cannot override the tender computed below.
      const content = {
        ...params,
        amountPesewas: totalPesewas,
        cashReceivedPesewas: amountOf("cash"),
        momoReceivedPesewas: amountOf("momo"),
        saleItems: params.saleItems ?? [],
        parts
      };
      await saveAttempt.run(content, (attemptId) => onSaveSale({ ...content, attemptId }));
    } catch (saveError) {
      console.error("Could not save the split-payment sale.", saveError);
      setError(isSaveOutcomeUnknown(saveError) ? "" : saveError?.name === "QuotaExceededError" ? t("sell.storageFull") : t("split.saveFailed"));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function continueAsCredit(parts) {
    onNavigate("WhoOwesYou", {
      ...params,
      initialPaymentPesewas: getPaidPaymentPesewas(parts),
      initialPaymentParts: parts
    });
  }

  return (
    <>
    <SplitPayment
      totalPesewas={totalPesewas}
      totalLabel={t("split.saleTotal")}
      allowOwe
      doneLabel={t("split.done")}
      busy={saving}
      error={error}
      onPartsChange={(parts) => onUpdateParams?.({ splitParts: parts })}
      notice={<SaveAttemptNotice saveAttempt={saveAttempt} busy={saving} onTryAgain={() => lastPartsRef.current && void saveSale(lastPartsRef.current, true)} />}
      onBack={onBack}
      onDone={(parts) => void saveSale(parts)}
      onOwe={(parts) => onNavigate("WhoOwesYou", {
        ...params,
        flow: "split",
        paymentAlreadyMadeToday: getPaidPaymentPesewas(parts) > 0,
        initialPaymentPesewas: getPaidPaymentPesewas(parts),
        initialPaymentParts: parts
      })}
      onMoMo={(parts, pendingMomoAmountPesewas, extra = {}) => onNavigate("MoMoChoice", {
        ...params,
        splitParts: parts,
        pendingMomoAmountPesewas,
        ...extra,
        returnRoute: "SplitPayment",
        pickOnly: true
      })}
      initialParts={getInitialPaymentParts({ ...params, amountPesewas: totalPesewas }, totalPesewas)}
      partDetail={(part) => describeSplitPart(part, params)}
    />
    {largeAmount.dialog}
    </>
  );
}
