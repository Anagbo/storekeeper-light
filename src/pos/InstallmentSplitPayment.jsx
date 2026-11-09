import { toPesewas } from "../lib/money.js";
import { posText as t } from "./i18n.js";
import { getInitialPaymentParts } from "./paymentAmount.js";
import SplitPayment from "./SplitPayment.jsx";

export default function InstallmentSplitPayment({ params = {}, onBack, onReturnTo, onNavigate }) {
  const totalPesewas = Number.isSafeInteger(params.splitTotalPesewas)
    ? params.splitTotalPesewas
    : toPesewas(params.todayPaymentAmount ?? "");

  // Back to the existing 19, not a second copy on top of it (E3).
  function complete(parts) {
    onReturnTo("ALittleAtATime", {
      ...params,
      paymentMethod: "split",
      firstPaymentParts: parts
    });
  }

  if (!Number.isSafeInteger(totalPesewas) || totalPesewas <= 0) {
    return null;
  }

  return (
    <SplitPayment
      totalPesewas={totalPesewas}
      totalLabel={t("credit.amountPaidToday")}
      doneLabel={t("split.done")}
      onBack={onBack}
      onDone={complete}
      onMoMo={(parts, pendingMomoAmountPesewas) => onNavigate("MoMoChoice", {
        ...params,
        splitParts: parts,
        pendingMomoAmountPesewas,
        returnRoute: "SplitPayment",
        pickOnly: true
      })}
      initialParts={getInitialPaymentParts({ ...params, splitTotalPesewas: totalPesewas }, totalPesewas)}
    />
  );
}
