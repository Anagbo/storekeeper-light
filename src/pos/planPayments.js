import { db } from "../db/db.js";
import { getPreference } from "../db/preferences.js";
import { createId } from "../lib/ids.js";

const CLIENT_ENV = import.meta.env ?? {};

export const PLAN_CONFIG = Object.freeze({
  id: "monthly",
  months: 1,
  amountPesewas: Number(CLIENT_ENV.VITE_SUBSCRIPTION_MONTHLY_AMOUNT_PESEWAS ?? 1500),
  receivingNumber: CLIENT_ENV.VITE_STOREKEEPER_RECEIVING_NUMBER ?? "",
  receivingName: CLIENT_ENV.VITE_STOREKEEPER_RECEIVING_NAME ?? "StoreKeeper"
});

export async function listPlanPayments(planId = PLAN_CONFIG.id) {
  return db.planPayments.where("planId").equals(planId).sortBy("createdAt");
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
  return payment;
}

export async function getPlanPaymentConfiguration() {
  const [shopPhone, receivingNumber, receivingNetwork] = await Promise.all([
    getPreference("shopPhone", ""),
    getPreference("storekeeperReceivingNumber", PLAN_CONFIG.receivingNumber),
    getPreference("storekeeperReceivingNetwork", "")
  ]);
  return { shopPhone, receivingNumber, receivingNetwork };
}
