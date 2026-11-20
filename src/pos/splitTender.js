import { formatGhs } from "../lib/money.js";
import { formatDate } from "../lib/formatDate.js";
import { posText as t } from "./i18n.js";
import { displayName } from "../lib/displayName.js";
import { localDateString } from "../utils/installments.js";

// The one-line MoMo status on 19's "Paying today" panel: "Customer sends · not confirmed yet" before the
// money is confirmed, "Customer sent · received ✓" after. 16 and 27 use splitPartRows below instead.
export function describeSplitPart(part) {
  if (part?.paymentMethod !== "momo") return "";
  if (isLockedMomoRow(part)) return t("split.receivedRow");
  if (part.momoMethod === "direct") return t("split.directNotConfirmed");
  if (part.momoMethod === "paystack") return "Phone request";
  return "";
}

// Status rows on 16 and 27 (wiring "Row layout on 16 and 27", status rows decided 17 Nov 2026): label-value
// rows under the chip row, each { name, label, value }.
//   MoMo: Status / Not confirmed yet, or Status / Received ✓.
//   Owe with a plan: Person, Payment (GH₵x weekly | bi-weekly | monthly, the payment each time), First payment.
//   Owe with a due date after today: Person, Due. Owe due today or with no date: Person only.
//   Cash: no rows.
export function splitPartRows(part, params = {}) {
  if (part?.paymentMethod === "momo") {
    if (isLockedMomoRow(part)) return [{ name: "status", label: t("kv.status"), value: t("split.received"), received: true }];
    if (part.momoMethod === "direct" || part.momoMethod === "paystack") return [{ name: "status", label: t("kv.status"), value: t("split.notConfirmed") }];
    return [];
  }
  if (part?.paymentMethod !== "owe") return [];
  const name = typeof params.customer?.name === "string" ? displayName(params.customer.name) : "";
  if (!name) return [];
  const rows = [{ name: "person", label: t("kv.person"), value: name }];
  const plan = params.installmentPlan?.isInstallmentPlan ? params.installmentPlan : null;
  if (plan) {
    if (Number.isSafeInteger(plan.installmentAmount) && plan.installmentAmount > 0) {
      rows.push({ name: "payment", label: t("kv.payment"), value: t(`kv.paymentEvery.${plan.frequency}`, { amount: formatGhs(plan.installmentAmount) }) });
    }
    // A plan names its first payment day (today when it starts today; 19 passes the date it chose).
    const firstDate = params.firstPaymentDate || plan.nextDueDate;
    if (firstDate) rows.push({ name: "first-payment", label: t("kv.firstPayment"), value: formatDate(firstDate) });
    return rows;
  }
  // 18 stores the due date (yyyy-mm-dd); "Today" stores today's date and shows no Due row.
  if (typeof params.dueDate === "string" && params.dueDate > localDateString()) {
    rows.push({ name: "due", label: t("kv.due"), value: formatDate(params.dueDate) });
  }
  return rows;
}

function sumPartsPesewas(parts) {
  return parts.reduce((sum, part) => sum + part.amountPesewas, 0);
}

// One tap on a Cash or MoMo tile (K1, brief 3.8 rule 2): the whole Left to pay goes into that
// mode's row. One row per mode, so an existing row grows. Computed from the parts passed in,
// so a second quick tap, when nothing is left, changes nothing.
export function addRemainingToPart(parts, paymentMethod, totalPesewas) {
  const leftPesewas = totalPesewas - sumPartsPesewas(parts);
  if (!Number.isSafeInteger(leftPesewas) || leftPesewas <= 0) return parts;
  const existing = parts.find((part) => part.paymentMethod === paymentMethod);
  if (!existing) return [...parts, { paymentMethod, amountPesewas: leftPesewas }];
  if (isLockedMomoRow(existing)) return parts;
  return parts.map((part) => (part === existing ? { ...part, amountPesewas: part.amountPesewas + leftPesewas } : part));
}

// Wiring 16 (decided 11 Nov 2026): a MoMo row whose money has been received is locked: the
// phone request is verified, or the owner tapped "Money received" on 62 for a Direct MoMo
// (verification "merchant_confirmed", set by MoMoDirect and kept on the part in the 16 route
// params). It cannot be edited or removed, also after a later step fails and the draft returns
// to 16. Cash and Owe are never MoMo-locked.
export function isLockedMomoRow(part) {
  return part?.paymentMethod === "momo" && (part.verification === "verified" || part.verification === "merchant_confirmed");
}

// Wiring 16 (MOMO16, 11 Nov 2026): a Direct MoMo part picked on 61 is not confirmed yet. Done on
// 16 opens 62 for it before the sale is committed.
export function isUnconfirmedDirectMomo(part) {
  return part?.paymentMethod === "momo" && part.momoMethod === "direct" && !isLockedMomoRow(part);
}

// "Money received" on 62 after Done: the Direct part becomes received (locked) for the amount on it.
export function confirmDirectMomoParts(parts = []) {
  return parts.map((part) => (isUnconfirmedDirectMomo(part)
    ? { ...part, verification: "merchant_confirmed", confirmedPesewas: part.amountPesewas }
    : part));
}

// The x on a row. Null for a locked MoMo row (the button is also hidden), so no caller can
// remove money that was received.
export function removePart(parts, target) {
  if (!parts.includes(target) || isLockedMomoRow(target)) return null;
  return parts.filter((part) => part !== target);
}

// Tapping a row's amount edits it. The new amount replaces the old one and keeps the row's
// other fields (the MoMo method). It may use what is left plus the row's own amount.
// Returns null when the amount is not allowed. Owe is never typed; a locked MoMo row is never edited.
export function setPartAmount(parts, paymentMethod, amountPesewas, totalPesewas) {
  const existing = parts.find((part) => part.paymentMethod === paymentMethod);
  if (!existing || paymentMethod === "owe" || isLockedMomoRow(existing)) return null;
  const limitPesewas = totalPesewas - sumPartsPesewas(parts) + existing.amountPesewas;
  if (!Number.isSafeInteger(amountPesewas) || amountPesewas <= 0 || amountPesewas > limitPesewas) return null;
  return parts.map((part) => (part === existing ? { ...part, amountPesewas } : part));
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
