import { toPesewas } from "../lib/money.js";
import { posText as t } from "./i18n.js";
import { getInitialPaymentParts } from "./paymentAmount.js";
import SplitPayment from "./SplitPayment.jsx";

export default function InstallmentSplitPayment({ params = {}, onBack, onReplace, onNavigate }) {
  const totalPesewas = Number.isSafeInteger(params.splitTotalPesewas)
    ? params.splitTotalPesewas
    : toPesewas(params.todayPaymentAmount ?? "");

  function complete(parts) {
    onReplace("ALittleAtATime", {
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
