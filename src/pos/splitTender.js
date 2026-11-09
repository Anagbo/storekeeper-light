import { formatGhs } from "../lib/money.js";
import { posText as t } from "./i18n.js";

// Row status on 16 (contract state): the MoMo method, and the Owe person and terms.
// Uses existing wording only: the 61 tile titles and the 19 frequency labels.
export function describeSplitPart(part, params = {}) {
  if (part?.paymentMethod === "momo") {
    if (part.momoMethod === "direct") return "Customer sends to my number";
    if (part.momoMethod === "paystack") return "Phone request";
    return "";
  }
  if (part?.paymentMethod !== "owe") return "";
  const name = typeof params.customer?.name === "string" ? params.customer.name.trim() : "";
  if (!name) return "";
  const plan = params.installmentPlan?.isInstallmentPlan ? params.installmentPlan : null;
  return [
    name,
    plan && Number.isSafeInteger(plan.installmentAmount) ? formatGhs(plan.installmentAmount) : "",
    plan ? t(`credit.frequency.${plan.frequency}`) : "",
    typeof params.payBackLabel === "string" ? params.payBackLabel : ""
  ].filter(Boolean).join(" · ");
}

export function areSplitTenderAmountsValid(totalPesewas, cashPesewas, momoPesewas) {
  const paidPesewas = cashPesewas + momoPesewas;
  return Number.isSafeInteger(totalPesewas) && totalPesewas > 0 &&
    Number.isSafeInteger(cashPesewas) && cashPesewas >= 0 &&
    Number.isSafeInteger(momoPesewas) && momoPesewas >= 0 &&
    Number.isSafeInteger(paidPesewas) && paidPesewas <= totalPesewas;
}

export function areSplitTenderAmountsComplete(totalPesewas, cashPesewas, momoPesewas, requireBoth = false) {
  return areSplitTenderAmountsValid(totalPesewas, cashPesewas, momoPesewas) &&
    cashPesewas + momoPesewas === totalPesewas &&
    (!requireBoth || (cashPesewas > 0 && momoPesewas > 0));
}
