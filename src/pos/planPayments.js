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
