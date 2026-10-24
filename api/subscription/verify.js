const SUBSCRIPTION_AMOUNT_PESEWAS = 1500;
const SUBSCRIPTION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

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
      payment.amount !== SUBSCRIPTION_AMOUNT_PESEWAS ||
      payment.currency !== "GHS" ||
      payment.channel !== "mobile_money"
    ) {
      return respond(res, 402, { error: "Payment is not yet confirmed as a GHS 15.00 Mobile Money subscription." });
    }

    const paidAt = Date.parse(payment.paid_at);
    if (!Number.isFinite(paidAt)) {
      return respond(res, 502, { error: "Paystack returned an invalid payment date. Please contact support." });
    }

    return respond(res, 200, {
      success: true,
      reference,
      expiresAt: new Date(paidAt + SUBSCRIPTION_DURATION_MS).toISOString()
    });
  } catch (error) {
    console.error("Could not verify Paystack payment.", error);
    return respond(res, 500, { error: "Payment verification is temporarily unavailable. Please try again." });
  }
}
