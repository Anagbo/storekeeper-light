import { useState } from "react";
import { posText as t } from "./i18n.js";
import { getInitialPaymentParts, getPaidPaymentPesewas } from "./paymentAmount.js";
import SplitPayment from "./SplitPayment.jsx";
import { describeSplitPart } from "./splitTender.js";

export default function SaleSplitPayment({ params = {}, onBack, onNavigate, onSaveSale }) {
  const totalPesewas = Number.isSafeInteger(params.amountPesewas) ? params.amountPesewas : 0;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function saveSale(parts) {
    if (saving) return;
    const amountOf = (method) => parts.filter((part) => part.paymentMethod === method).reduce((sum, part) => sum + part.amountPesewas, 0);
    setSaving(true);
    setError("");
    try {
      await onSaveSale({
        amountPesewas: totalPesewas,
        cashReceivedPesewas: amountOf("cash"),
        momoReceivedPesewas: amountOf("momo"),
        saleItems: params.saleItems ?? [],
        parts,
        ...params
      });
    } catch (saveError) {
      console.error("Could not save the split-payment sale.", saveError);
      setError(saveError?.name === "QuotaExceededError" ? t("sell.storageFull") : t("split.saveFailed"));
    } finally {
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
    <SplitPayment
      totalPesewas={totalPesewas}
      totalLabel={t("split.saleTotal")}
      allowOwe
      doneLabel={t("split.done")}
      busy={saving}
      error={error}
      onBack={onBack}
      onDone={(parts) => void saveSale(parts)}
      onOwe={(parts) => onNavigate("WhoOwesYou", {
        ...params,
        flow: "split",
        paymentAlreadyMadeToday: getPaidPaymentPesewas(parts) > 0,
        initialPaymentPesewas: getPaidPaymentPesewas(parts),
        initialPaymentParts: parts
      })}
      onMoMo={(parts, pendingMomoAmountPesewas) => onNavigate("MoMoChoice", {
        ...params,
        splitParts: parts,
        pendingMomoAmountPesewas,
        returnRoute: "SplitPayment",
        pickOnly: true
      })}
      initialParts={getInitialPaymentParts({ ...params, amountPesewas: totalPesewas }, totalPesewas)}
      partDetail={(part) => describeSplitPart(part, params)}
    />
  );
}
