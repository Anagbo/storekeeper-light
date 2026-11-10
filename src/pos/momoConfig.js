import { db } from "../db/db.js";
import { getPreference, setPreference } from "../db/preferences.js";
import { runTransactionWithTimeout } from "../db/runTransactionWithTimeout.js";
import { FEATURE_FLAGS } from "../config/features.js";
import { normalizeWhatsAppPhone } from "../utils/whatsapp.js";
export { MOMO_METHODS, MOMO_VERIFICATION } from "./momoMapping.js";

// The Phone request fee is configuration (who pays it is the owner's decision). It must be a
// whole number of pesewas: "25", not "0.25" or "abc". Missing means 0.
export function parseFeePesewas(raw) {
  if (raw === undefined || raw === null || raw === "") return 0;
  const text = String(raw);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text))) {
    throw new TypeError("The Phone request fee must be a whole number of pesewas.");
  }
  return Number(text);
}

// A bad setting must not show a wrong fee: it counts as 0, is marked invalid, and
// Phone request stays off until the setting is fixed.
export function readPhoneRequestFee(raw) {
  try {
    return { feePesewas: parseFeePesewas(raw), feeValid: true };
  } catch {
    return { feePesewas: 0, feeValid: false };
  }
}

const phoneRequestFee = readPhoneRequestFee(import.meta.env?.VITE_MOMO_PHONE_REQUEST_FEE_PESEWAS);
if (!phoneRequestFee.feeValid) {
  console.error("VITE_MOMO_PHONE_REQUEST_FEE_PESEWAS must be a whole number of pesewas. Phone request stays off.");
}

export const MOMO_CONFIG = Object.freeze({
  phoneRequestFeePesewas: phoneRequestFee.feePesewas,
  phoneRequestFeeValid: phoneRequestFee.feeValid,
  defaultNetwork: "MTN"
});

export const PHONE_REQUEST_ENABLED = FEATURE_FLAGS.ENABLE_MOMO_PHONE_REQUEST && MOMO_CONFIG.phoneRequestFeeValid;

// A MoMo method the merchant can use right now: phone only while Phone request is on.
function isAvailableMomoMethod(method) {
  return method === "direct" || (method === "phone" && PHONE_REQUEST_ENABLED);
}

// Phone request can be used right now: the flag is on AND a Paystack payout number is saved.
// The one place that decides this; 61, 63 and every sale screen use it.
// "Saved" is all it checks: nothing verifies the payout account yet. The phone-request flag must
// stay off in production until the server verification exists.
export function phoneRequestAvailable({ flagOn = PHONE_REQUEST_ENABLED, payoutNumber } = {}) {
  return Boolean(flagOn) && typeof payoutNumber === "string" && payoutNumber.trim() !== "";
}

export async function isPhoneRequestAvailable() {
  return phoneRequestAvailable({ payoutNumber: await getPreference("paystackPayoutNumber", "") });
}

export async function getMerchantMomoSettings() {
  const [number, network, defaultMethod, lastUsed, payoutNumber] = await Promise.all([
    getPreference("momoReceivingNumber", ""),
    getPreference("momoReceivingNetwork", MOMO_CONFIG.defaultNetwork),
    getPreference("momoDefault", "ask"),
    getPreference("momoLastUsed", ""),
    getPreference("paystackPayoutNumber", "")
  ]);
  const phoneAvailable = phoneRequestAvailable({ payoutNumber });
  return {
    number: typeof number === "string" ? number : "",
    network: typeof network === "string" ? network : MOMO_CONFIG.defaultNetwork,
    defaultMethod: ["ask", "direct", "phone"].includes(defaultMethod) && (defaultMethod !== "phone" || phoneAvailable)
      ? defaultMethod
      : "ask",
    // "Last used" on 61 is shown only for a method actually used before (A5).
    lastUsed: isAvailableMomoMethod(lastUsed) ? lastUsed : "",
    phoneRequestAvailable: phoneAvailable
  };
}

export async function recordMomoLastUsed(method) {
  if (method !== "direct" && method !== "phone") return;
  await setPreference("momoLastUsed", method);
}

export const RECEIVING_NETWORKS = Object.freeze(["MTN", "Telecel", "AirtelTigo"]);
const RECEIVING_LOG_KEY = "momoReceivingNumberLog";
const RECEIVING_LOG_LIMIT = 50;

// The number customers send to on 62, stored as 0XXXXXXXXX. Returns null when it is
// not a Ghana mobile number. Reuses the WhatsApp normalizer (+233, 0xx, spaces).
export function normalizeReceivingNumber(input) {
  const international = normalizeWhatsAppPhone(typeof input === "string" ? input : "");
  return international ? `0${international.slice(4)}` : null;
}

// For the confirmation on 63: 024 ••• 4567.
export function maskPhoneNumber(number) {
  const digits = typeof number === "string" ? number.replace(/\D/g, "") : "";
  if (digits.length < 7) return "•••";
  return `${digits.slice(0, 3)} ••• ${digits.slice(-4)}`;
}

// Saves the receiving number and network from 63 and keeps a local record of every
// change (old number, new number, time). Local only: the server must keep the real
// audit trail once there is one. Turning the option off saves an empty number.
export async function saveReceivingNumber({ enabled, number, network }) {
  const newNumber = enabled ? normalizeReceivingNumber(number) : "";
  if (newNumber === null) throw new TypeError("Enter a Ghana mobile number, like 024 123 4567.");
  if (!RECEIVING_NETWORKS.includes(network)) throw new TypeError("Choose the network of your MoMo number.");
  return runTransactionWithTimeout(db, [db.settings], async () => {
    const oldNumber = (await db.settings.get("momoReceivingNumber"))?.value ?? "";
    const oldNetwork = (await db.settings.get("momoReceivingNetwork"))?.value ?? "";
    await db.settings.put({ key: "momoReceivingNumber", value: newNumber });
    await db.settings.put({ key: "momoReceivingNetwork", value: network });
    const changed = oldNumber !== newNumber || oldNetwork !== network;
    if (changed) {
      let entries = [];
      try {
        const parsed = JSON.parse((await db.settings.get(RECEIVING_LOG_KEY))?.value ?? "[]");
        entries = Array.isArray(parsed) ? parsed : [];
      } catch {
        entries = [];
      }
      entries.push({ oldNumber, newNumber, oldNetwork, newNetwork: network, changedAt: new Date().toISOString() });
      await db.settings.put({ key: RECEIVING_LOG_KEY, value: JSON.stringify(entries.slice(-RECEIVING_LOG_LIMIT)) });
    }
    return { number: newNumber, network, changed };
  });
}
