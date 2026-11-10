import { db } from "../db/db.js";
import { getPreference } from "../db/preferences.js";
import { formatDate } from "../lib/formatDate.js";
import { createId } from "../lib/ids.js";
import { addSubscriptionMonths } from "../lib/subscriptionDates.js";
import { PLAN_PRICES_PESEWAS } from "../config/plans.js";

const CLIENT_ENV = import.meta.env ?? {};

export const PLAN_CONFIG = Object.freeze({
  id: "monthly",
  months: 1,
  // The one client price table (src/config/plans.js), in whole pesewas.
  amountPesewas: PLAN_PRICES_PESEWAS.monthly,
  receivingNumber: CLIENT_ENV.VITE_STOREKEEPER_RECEIVING_NUMBER ?? "",
  receivingName: CLIENT_ENV.VITE_STOREKEEPER_RECEIVING_NAME ?? "StoreKeeper"
});

export async function listPlanPayments(planId = PLAN_CONFIG.id) {
  return db.planPayments.where("planId").equals(planId).sortBy("createdAt");
}

// A confirmation is a new row that points at the original (the table is append-only), so
// the raw list holds a payment twice (F5). For display, a payment shows once: its own date
// and amount, with the status of the latest confirmation. A confirmation whose original is
// missing still shows.
export function groupPlanPayments(rows) {
  const latestConfirmation = new Map();
  for (const row of rows) {
    if (!row.originalPaymentId) continue;
    const current = latestConfirmation.get(row.originalPaymentId);
    if (!current || row.createdAt >= current.createdAt) latestConfirmation.set(row.originalPaymentId, row);
  }
  const originals = rows.filter((row) => !row.originalPaymentId);
  const originalIds = new Set(originals.map((row) => row.id));
  const shown = originals.map((row) => {
    const confirmation = latestConfirmation.get(row.id);
    return confirmation ? { ...row, status: confirmation.status, confirmedBy: confirmation.confirmedBy } : row;
  });
  const orphans = rows.filter((row) => row.originalPaymentId && !originalIds.has(row.originalPaymentId));
  return [...shown, ...orphans].sort((left, right) => left.createdAt - right.createdAt);
}

// Six random digits for screen 66. Client-generated, so it is not yet single-use,
// expiring or bound to the merchant: the server must issue and check it (B7).
export function createPlanCashCode() {
  const limit = 4_294_000_000; // largest multiple of 1,000,000 below 2^32, avoids modulo bias
  const buffer = new Uint32Array(1);
  do {
    globalThis.crypto.getRandomValues(buffer);
  } while (buffer[0] >= limit);
  return String(buffer[0] % 1_000_000).padStart(6, "0");
}

// Plan payments are always saved as waiting. Only the server may confirm one (agent or admin).
export async function appendPlanPayment({ method, amountPesewas = PLAN_CONFIG.amountPesewas, reference = "" }) {
  if (!["cash", "momo_direct", "momo_paystack"].includes(method)) throw new TypeError("Invalid plan payment method.");
  if (!Number.isSafeInteger(amountPesewas) || amountPesewas <= 0) throw new TypeError("Invalid plan payment amount.");
  const payment = {
    id: createId(),
    planId: PLAN_CONFIG.id,
    method,
    amountPesewas,
    reference: reference.trim(),
    status: "waiting",
    confirmedBy: "",
    createdAt: Date.now()
  };
  await db.planPayments.add(payment);
  // 65 tags the method used last (K15).
  await db.settings.put({ key: "planLastUsedMethod", value: method });
  return payment;
}

// Plain names for the stored method codes: the same three names as the tiles on 65.
const PLAN_METHOD_LABELS = Object.freeze({ cash: "Cash", momo_direct: "Mobile money", momo_paystack: "Phone request" });

// Plain words for a stored plan payment status, from the contract: "Waiting to confirm" is the
// title of screen 70, "Confirmed" is the word the prototype shows on My plan rows, and
// "Payment not completed" is the name of screen 59 (accepted by the owner for a failed plan
// payment). "Payment reversed" is the owner's wording: the contract has none for "reversed".
// A stored value outside the data model (PlanPaymentStatus) keeps its stored word.
const PLAN_STATUS_LABELS = Object.freeze({
  waiting: "Waiting to confirm",
  confirmed: "Confirmed",
  failed: "Payment not completed",
  reversed: "Payment reversed"
});

export function planStatusLabel(status) {
  if (Object.hasOwn(PLAN_STATUS_LABELS, status)) return PLAN_STATUS_LABELS[status];
  return typeof status === "string" ? status : "";
}

// What My plan (64) shows for a payment's method. A code that is not one of the three is shown
// as "Payment", never as the raw stored code.
export function planMethodLabel(method) {
  return Object.hasOwn(PLAN_METHOD_LABELS, method) ? PLAN_METHOD_LABELS[method] : "Payment";
}

export async function getPlanLastUsedMethod() {
  const value = (await db.settings.get("planLastUsedMethod"))?.value;
  return Object.hasOwn(PLAN_METHOD_LABELS, value) ? value : "";
}

// The 69 line, built from the stored plan payment (K15): "Plan runs to {end} · {method}
// · {verification}". Only a confirmed payment has a plan period. Only a Paystack phone
// request is verified; cash and direct MoMo are confirmed by a StoreKeeper agent, so they
// carry no MoMo verification label. The end date is the payment time plus the plan length.
export function describePlanPayment(payment) {
  if (!payment || payment.status !== "confirmed" || !Object.hasOwn(PLAN_METHOD_LABELS, payment.method)) return "";
  const paidAt = Number(payment.createdAt);
  if (!Number.isFinite(paidAt)) return "";
  const end = formatDate(addSubscriptionMonths(paidAt, PLAN_CONFIG.months));
  return [
    `Plan runs to ${end}`,
    PLAN_METHOD_LABELS[payment.method],
    payment.method === "momo_paystack" ? "MoMo · verified" : ""
  ].filter(Boolean).join(" · ");
}

export async function getPlanPaymentConfiguration() {
  const [shopPhone, receivingNumber, receivingNetwork] = await Promise.all([
    getPreference("shopPhone", ""),
    getPreference("storekeeperReceivingNumber", PLAN_CONFIG.receivingNumber),
    getPreference("storekeeperReceivingNetwork", "")
  ]);
  return { shopPhone, receivingNumber, receivingNetwork };
}
