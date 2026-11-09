import { getPreference } from "../db/preferences.js";
import { FEATURE_FLAGS } from "../config/features.js";
export { MOMO_METHODS, MOMO_VERIFICATION } from "./momoMapping.js";

export const PHONE_REQUEST_ENABLED = FEATURE_FLAGS.ENABLE_MOMO_PHONE_REQUEST;

export const MOMO_CONFIG = Object.freeze({
  phoneRequestFeePesewas: Number(import.meta.env?.VITE_MOMO_PHONE_REQUEST_FEE_PESEWAS ?? 0),
  defaultNetwork: "MTN"
});

export async function getMerchantMomoSettings() {
  const [number, network, defaultMethod] = await Promise.all([
    getPreference("momoReceivingNumber", ""),
    getPreference("momoReceivingNetwork", MOMO_CONFIG.defaultNetwork),
    getPreference("momoDefault", "ask")
  ]);
  return {
    number: typeof number === "string" ? number : "",
    network: typeof network === "string" ? network : MOMO_CONFIG.defaultNetwork,
    defaultMethod: ["ask", "direct", "phone"].includes(defaultMethod) && (defaultMethod !== "phone" || PHONE_REQUEST_ENABLED)
      ? defaultMethod
      : "ask"
  };
}
