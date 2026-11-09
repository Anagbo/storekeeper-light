import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db.js";
import { FEATURE_FLAGS, FEATURE_SUBSCRIPTION_LOCKOUT } from "../config/features.js";
import {
  applyVerifiedSubscriptionPayment,
  clearPendingSubscriptionPayment,
  isFinalPaymentFailure,
  isNetworkError,
  parsePendingSubscriptionPayment,
  PAYMENT_NOT_COMPLETED_MESSAGE,
  readVerifyResponse,
  VERIFY_UNAVAILABLE_MESSAGE
} from "../db/subscriptionPayments.js";
import { getEffectiveTrialNow, getTrialExpiry, isSubscriptionActive, normalizeTrialDays } from "../lib/subscriptionTrial.js";

export function useSubscription() {
  const [subscriptionNotice, setSubscriptionNotice] = useState(null);
  const trialDays = normalizeTrialDays(import.meta.env?.VITE_SUBSCRIPTION_TRIAL_DAYS || 0);
  const settings = useLiveQuery(
    () => FEATURE_FLAGS.SHOW_SUBSCRIPTION_FEATURE ? db.settings.toArray() : Promise.resolve([]),
    [FEATURE_FLAGS.SHOW_SUBSCRIPTION_FEATURE],
    undefined
  );
  const processedPaymentReference = useRef("");
  // The automatic verify on open runs once per reference; later tries come only
  // from reconnecting or the retry button (D2).
  const attemptedPaymentReference = useRef("");
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
  // D12: checked against the last observed time too, so a clock set back does not extend it.
  const hasActiveSubscription = isSubscriptionActive(subscriptionExpiry, Date.now(), trialLastObservedAt);
  const settingsReady = Array.isArray(settings);
  const pendingRaw = (settings ?? []).find((setting) => setting.key === "pendingSubscriptionPayment")?.value ?? "";
  // Same object between renders unless the stored text changes, so the effects below
  // do not re-run on every render (D2).
  const pendingPayment = useMemo(() => parsePendingSubscriptionPayment(pendingRaw), [pendingRaw]);
  const subscriptionRequired = settingsReady && FEATURE_FLAGS.SHOW_SUBSCRIPTION_FEATURE
    && FEATURE_SUBSCRIPTION_LOCKOUT
    && !hasActiveSubscription
    && trialInitialized
    && !trialActive;

  useEffect(() => {
    if (!FEATURE_FLAGS.SHOW_SUBSCRIPTION_FEATURE) return undefined;
    db.transaction("rw", db.settings, async () => {
      const now = Date.now();
      // The trial starts only when there is one; the last observed time is kept either way (D12).
      if (trialDays > 0) {
        const existing = await db.settings.get("subscriptionTrialStartedAt");
        if (!existing?.value) {
          await db.settings.put({ key: "subscriptionTrialStartedAt", value: new Date(now).toISOString() });
        }
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
    function removeCallbackParams() {
      const callbackUrl = new URL(window.location.href);
      callbackUrl.searchParams.delete("reference");
      callbackUrl.searchParams.delete("trxref");
      callbackUrl.searchParams.delete("status");
      callbackUrl.searchParams.delete("plan");
      window.history.replaceState({}, "", `${callbackUrl.pathname}${callbackUrl.search}${callbackUrl.hash}`);
    }
    try {
      const response = await fetch("/api/subscription/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference, planId }),
        signal: AbortSignal.timeout(20000)
      });
      const result = await readVerifyResponse(response);
      // L2: Paystack says it failed, was abandoned or reversed: stop retrying it for good.
      if (!response.ok && isFinalPaymentFailure(result)) {
        await clearPendingSubscriptionPayment(reference);
        if (cleanCallback) removeCallbackParams();
        processedPaymentReference.current = reference;
        setSubscriptionNotice({ type: "error", text: PAYMENT_NOT_COMPLETED_MESSAGE });
        return;
      }
      if (!response.ok || result.success !== true || result.reference !== reference) {
        throw new Error(result.error || "Payment could not be verified.");
      }
      const expiresAt = new Date(result.expiresAt);
      if (!Number.isFinite(expiresAt.getTime())) throw new Error("The payment verification response had an invalid expiry date.");
      const paidAt = new Date(result.paidAt);
      if (!Number.isFinite(paidAt.getTime()) || !Number.isInteger(result.durationMonths) || result.durationMonths <= 0) {
        throw new Error("The payment verification response had invalid billing dates.");
      }

      // Client cache only; the server must enforce used references and entitlement.
      const applied = await applyVerifiedSubscriptionPayment({
        reference,
        paidAt,
        durationMonths: result.durationMonths
      });
      if (cleanCallback) removeCallbackParams();
      const activeUntil = new Date(applied.expiresAt).toLocaleDateString("en-GH");
      setSubscriptionNotice({
        type: "success",
        text: applied.applied
          ? `Payment verified. This subscription is active until ${activeUntil}.`
          : `This payment was already added. This subscription is active until ${activeUntil}.`
      });
      processedPaymentReference.current = reference;
    } catch (verificationError) {
      console.error("Could not verify the Paystack subscription payment.", verificationError);
      setSubscriptionNotice({
        type: "error",
        text: isNetworkError(verificationError)
          ? VERIFY_UNAVAILABLE_MESSAGE
          : verificationError.message || "Payment verification failed. Please try again when you have a connection."
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
    if (!reference || processedPaymentReference.current === reference || attemptedPaymentReference.current === reference) return undefined;
    attemptedPaymentReference.current = reference;
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
