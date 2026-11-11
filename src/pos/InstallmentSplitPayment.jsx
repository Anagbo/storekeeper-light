import { toPesewas } from "../lib/money.js";
import { posText as t } from "./i18n.js";
import { getInitialPaymentParts } from "./paymentAmount.js";
import SplitPayment from "./SplitPayment.jsx";
import { describeSplitPart } from "./splitTender.js";

export default function InstallmentSplitPayment({ params = {}, onBack, onReturnTo, onNavigate, onUpdateParams }) {
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
      doneLabel={t("collect.received")}
      onPartsChange={(parts) => onUpdateParams?.({ splitParts: parts })}
      onBack={onBack}
      onDone={complete}
      onMoMo={(parts, pendingMomoAmountPesewas, extra = {}) => onNavigate("MoMoChoice", {
        ...params,
        splitParts: parts,
        pendingMomoAmountPesewas,
        ...extra,
        returnRoute: "SplitPayment",
        pickOnly: true,
        // MOMO16: Direct returns here not confirmed yet; Received returns the parts to 19, and Save
        // plan on 19 opens 62 before the commit.
        confirmAtDone: true
      })}
      initialParts={getInitialPaymentParts({ ...params, splitTotalPesewas: totalPesewas }, totalPesewas)}
      partDetail={(part) => describeSplitPart(part, params)}
    />
  );
}
