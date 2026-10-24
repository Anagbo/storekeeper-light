const SUBSCRIPTION_AMOUNT_PESEWAS = 1500;

function respond(res, status, body) {
  return res.status(status).setHeader("Content-Type", "application/json; charset=utf-8").json(body);
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required server environment variable: ${name}`);
  return value;
}

function getCallbackUrl() {
  const appUrl = new URL(requiredEnvironment("APP_URL"));
  if (
    (appUrl.protocol !== "https:" && !(appUrl.protocol === "http:" && appUrl.hostname === "localhost")) ||
    appUrl.username ||
    appUrl.password
  ) {
    throw new Error("APP_URL must use HTTPS.");
  }
  return `${appUrl.origin}/?subscription=verify`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return respond(res, 405, { error: "Method not allowed." });
  }

  const email = typeof req.body?.email === "string" && req.body.email.trim()
    ? req.body.email.trim()
    : "customer@storekeeper.app";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return respond(res, 400, { error: "Enter a valid email address for your payment receipt." });
  }

  try {
    const secretKey = requiredEnvironment("PAYSTACK_SECRET_KEY");
    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        amount: SUBSCRIPTION_AMOUNT_PESEWAS,
        currency: "GHS",
        channels: ["mobile_money"],
        callback_url: getCallbackUrl()
      }),
      signal: AbortSignal.timeout(15000)
    });
    const result = await response.json();
    const authorizationUrl = result?.data?.authorization_url;
    if (!response.ok || result?.status !== true || typeof authorizationUrl !== "string") {
      console.error("Paystack transaction initialization failed.", {
        status: response.status,
        message: result?.message ?? "Unexpected response"
      });
      return respond(res, 502, { error: "Paystack could not start checkout. Please try again." });
    }

    return respond(res, 200, { success: true, authorization_url: authorizationUrl });
  } catch (error) {
    console.error("Could not initialize Paystack checkout.", error);
    return respond(res, 500, { error: "Checkout is temporarily unavailable. Please try again." });
  }
}
