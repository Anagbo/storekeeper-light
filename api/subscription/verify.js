import { addSubscriptionMonths, getSubscriptionPlan } from "./plans.js";

function respond(res, status, body) {
  return res.status(status).setHeader("Content-Type", "application/json; charset=utf-8").json(body);
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required server environment variable: ${name}`);
  return value;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return respond(res, 405, { error: "Method not allowed." });
  }

  const reference = req.body?.reference;
  if (typeof reference !== "string" || !/^[a-zA-Z0-9._=-]{1,100}$/.test(reference)) {
    return respond(res, 400, { error: "A valid Paystack reference is required." });
  }
  let plan;
  try {
    plan = getSubscriptionPlan(req.body?.planId);
  } catch (error) {
    // B9: a pricing configuration error names a server setting; log it, do not send it.
    console.error("Subscription plan prices are not configured correctly.", error);
    return respond(res, 500, { error: "Payment verification is temporarily unavailable. Please try again." });
  }
  if (!plan) return respond(res, 400, { error: "Choose a valid subscription plan." });

  try {
    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: { Authorization: `Bearer ${requiredEnvironment("PAYSTACK_SECRET_KEY")}` },
        signal: AbortSignal.timeout(15000)
      }
    );
    const result = await response.json();
    const payment = result?.data;
    if (!response.ok || result?.status !== true || !payment) {
      console.error("Paystack transaction verification failed.", {
        status: response.status,
        message: result?.message ?? "Unexpected response"
      });
      return respond(res, 502, { error: "The payment could not be verified. Please try again." });
    }

    if (
      payment.reference !== reference ||
      payment.status !== "success" ||
      payment.amount !== plan.amountPesewas ||
      payment.currency !== "GHS" ||
      payment.channel !== "mobile_money"
    ) {
      // L2: report Paystack's own status for this reference, so the app can stop retrying a
      // payment that failed or was abandoned. It never reports another reference's status.
      const paymentStatus = payment.reference === reference && typeof payment.status === "string" ? payment.status : "";
      return respond(res, 402, {
        error: "Payment is not yet confirmed for the selected Mobile Money subscription plan.",
        ...(paymentStatus && { paymentStatus })
      });
    }

    const paidAt = Date.parse(payment.paid_at);
    if (!Number.isFinite(paidAt)) {
      return respond(res, 502, { error: "Paystack returned an invalid payment date. Please contact support." });
    }

    return respond(res, 200, {
      success: true,
      reference,
      paidAt: new Date(paidAt).toISOString(),
      durationMonths: plan.months,
      expiresAt: addSubscriptionMonths(paidAt, plan.months).toISOString()
    });
  } catch (error) {
    console.error("Could not verify Paystack payment.", error);
    return respond(res, 500, { error: "Payment verification is temporarily unavailable. Please try again." });
  }
}
