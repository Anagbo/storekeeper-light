import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db.js";
import { FEATURE_FLAGS, FEATURE_SUBSCRIPTION_LOCKOUT } from "../config/features.js";
import { addSubscriptionMonths } from "../lib/subscriptionDates.js";
import { getEffectiveTrialNow, getTrialExpiry, normalizeTrialDays } from "../lib/subscriptionTrial.js";

export function useSubscription() {
  const [subscriptionNotice, setSubscriptionNotice] = useState(null);
  const trialDays = normalizeTrialDays(import.meta.env?.VITE_SUBSCRIPTION_TRIAL_DAYS || 0);
  const settings = useLiveQuery(
    () => FEATURE_FLAGS.SHOW_SUBSCRIPTION_FEATURE ? db.settings.toArray() : Promise.resolve([]),
    [FEATURE_FLAGS.SHOW_SUBSCRIPTION_FEATURE],
    undefined
  );
  const processedPaymentReference = useRef("");
  const verifyingPayment = useRef(false);
  const subscriptionExpiry = (settings ?? []).find((setting) => setting.key === "subscriptionExpiry")?.value ?? "";
  const trialStartedAt = (settings ?? []).find((setting) => setting.key === "subscriptionTrialStartedAt")?.value ?? "";
  const trialLastObservedAt = (settings ?? []).find((setting) => setting.key === "subscriptionTrialLastObservedAt")?.value ?? "";
  const trialStartTimestamp = Date.parse(trialStartedAt);
  const trialExpiry = getTrialExpiry(trialStartedAt, trialDays);
  const trialExpiryTimestamp = Date.parse(trialExpiry);
  const effectiveTrialNow = getEffectiveTrialNow(Date.now(), trialLastObservedAt);
  const trialActive = Number.isFinite(trialExpiryTimestamp) && trialExpiryTimestamp > effectiveTrialNow;
  const trialInitialized = trialDays <= 0 || Boolean(trialStartedAt);
  const expiryTimestamp = Date.parse(subscriptionExpiry);
  const hasActiveSubscription = Number.isFinite(expiryTimestamp) && expiryTimestamp > Date.now();
  const settingsReady = Array.isArray(settings);
  const pendingPayment = (() => {
    const raw = (settings ?? []).find((setting) => setting.key === "pendingSubscriptionPayment")?.value;
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (
        typeof parsed?.reference !== "string" ||
        typeof parsed?.planId !== "string"
      ) return null;
      return parsed;
    } catch {
      return null;
    }
  })();
  const subscriptionRequired = settingsReady && FEATURE_FLAGS.SHOW_SUBSCRIPTION_FEATURE
    && FEATURE_SUBSCRIPTION_LOCKOUT
    && !hasActiveSubscription
    && trialInitialized
    && !trialActive;

  useEffect(() => {
    if (!FEATURE_FLAGS.SHOW_SUBSCRIPTION_FEATURE || trialDays <= 0) return undefined;
    db.transaction("rw", db.settings, async () => {
      const now = Date.now();
      const existing = await db.settings.get("subscriptionTrialStartedAt");
      if (!existing?.value) {
        await db.settings.put({ key: "subscriptionTrialStartedAt", value: new Date(now).toISOString() });
      }
      const lastObserved = await db.settings.get("subscriptionTrialLastObservedAt");
      const lastObservedTimestamp = Date.parse(lastObserved?.value ?? "");
      if (!Number.isFinite(lastObservedTimestamp) || now > lastObservedTimestamp) {
        await db.settings.put({ key: "subscriptionTrialLastObservedAt", value: new Date(now).toISOString() });
      }
    })
      .catch((error) => console.error("Could not initialize the subscription trial.", error));
    return undefined;
  }, [trialDays]);

  const verifyPayment = useCallback(async (reference, planId, cleanCallback = false) => {
    if (!reference || verifyingPayment.current) return;
    verifyingPayment.current = true;
    try {
      const response = await fetch("/api/subscription/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference, planId }),
        signal: AbortSignal.timeout(20000)
      });
      const result = await response.json();
      if (!response.ok || result.success !== true || result.reference !== reference) {
        throw new Error(result.error || "Payment could not be verified.");
      }
      const expiresAt = new Date(result.expiresAt);
      if (!Number.isFinite(expiresAt.getTime())) throw new Error("The payment verification response had an invalid expiry date.");
      const paidAt = new Date(result.paidAt);
      if (!Number.isFinite(paidAt.getTime()) || !Number.isInteger(result.durationMonths) || result.durationMonths <= 0) {
        throw new Error("The payment verification response had invalid billing dates.");
      }

      await db.transaction("rw", db.settings, async () => {
        const current = await db.settings.get("subscriptionExpiry");
        const currentTime = Date.parse(current?.value ?? "");
        const renewalStart = Number.isFinite(currentTime) && currentTime > paidAt.getTime()
          ? currentTime
          : paidAt.getTime();
        const renewalExpiry = addSubscriptionMonths(renewalStart, result.durationMonths);
        if (!Number.isFinite(currentTime) || renewalExpiry.getTime() > currentTime) {
          await db.settings.put({ key: "subscriptionExpiry", value: renewalExpiry.toISOString() });
        }
        await db.settings.put({ key: "isSubscribed", value: true });
        await db.settings.put({ key: "lastSubscriptionReference", value: reference });
        const pending = await db.settings.get("pendingSubscriptionPayment");
        if (pending?.value) {
          try {
            if (JSON.parse(pending.value).reference === reference) {
              await db.settings.delete("pendingSubscriptionPayment");
            }
          } catch {
            await db.settings.delete("pendingSubscriptionPayment");
          }
        }
      });
      if (cleanCallback) {
        const callbackUrl = new URL(window.location.href);
        callbackUrl.searchParams.delete("reference");
        callbackUrl.searchParams.delete("trxref");
        callbackUrl.searchParams.delete("status");
        callbackUrl.searchParams.delete("plan");
        window.history.replaceState({}, "", `${callbackUrl.pathname}${callbackUrl.search}${callbackUrl.hash}`);
      }
      setSubscriptionNotice({
        type: "success",
        text: `Payment verified. This subscription is active until ${addSubscriptionMonths(
          Number.isFinite(Date.parse(subscriptionExpiry)) && Date.parse(subscriptionExpiry) > paidAt.getTime()
            ? Date.parse(subscriptionExpiry)
            : paidAt.getTime(),
          result.durationMonths
        ).toLocaleDateString("en-GH")}.`
      });
      processedPaymentReference.current = reference;
    } catch (verificationError) {
      console.error("Could not verify the Paystack subscription payment.", verificationError);
      setSubscriptionNotice({
        type: "error",
        text: verificationError.message || "Payment verification failed. Please try again when you have a connection."
      });
    } finally {
      verifyingPayment.current = false;
    }
  }, []);

  const retryPendingPayment = useCallback(() => {
    if (pendingPayment) void verifyPayment(pendingPayment.reference, pendingPayment.planId);
  }, [pendingPayment, verifyPayment]);

  useEffect(() => {
    if (!FEATURE_FLAGS.SHOW_SUBSCRIPTION_FEATURE || !settingsReady) return undefined;
    const callbackUrl = new URL(window.location.href);
    const callbackReference = callbackUrl.searchParams.get("reference") || callbackUrl.searchParams.get("trxref");
    const storedPayment = pendingPayment?.reference === callbackReference ? pendingPayment : null;
    const reference = callbackReference || pendingPayment?.reference;
    const planId = storedPayment?.planId || pendingPayment?.planId || callbackUrl.searchParams.get("plan") || "monthly";
    if (!reference || processedPaymentReference.current === reference) return undefined;
    let active = true;
    async function prepareVerification() {
      if (callbackReference && (!pendingPayment || pendingPayment.reference !== callbackReference)) {
        await db.settings.put({
          key: "pendingSubscriptionPayment",
          value: JSON.stringify({ reference: callbackReference, planId, startedAt: new Date().toISOString() })
        });
      }
      if (active) void verifyPayment(reference, planId, Boolean(callbackReference));
    }
    void prepareVerification();
    return () => { active = false; };
  }, [pendingPayment, settingsReady, verifyPayment]);

  useEffect(() => {
    if (!FEATURE_FLAGS.SHOW_SUBSCRIPTION_FEATURE) return undefined;
    const onOnline = () => retryPendingPayment();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [retryPendingPayment]);

  return {
    subscriptionExpiry,
    trialActive,
    trialExpiry,
    hasActiveSubscription,
    subscriptionRequired,
    subscriptionNotice,
    paymentPending: Boolean(pendingPayment),
    retryPendingPayment,
    setSubscriptionNotice
  };
}
