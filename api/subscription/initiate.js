const SUBSCRIPTION_AMOUNT_PESEWAS = 1500;

function respond(res, status, body) {
  return res.status(status).setHeader("Content-Type", "application/json; charset=utf-8").json(body);
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required server environment variable: ${name}`);
  return value;
}

function getHeader(req, name) {
  if (typeof req.headers?.get === "function") return req.headers.get(name);
  return req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
}

function getTrustedOrigins() {
  const configuredOrigins = [
    process.env.APP_URL?.trim(),
    process.env.VERCEL_URL?.trim() && `https://${process.env.VERCEL_URL.trim()}`,
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() &&
      `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.trim()}`,
    "https://storekeeper-lite.vercel.app",
    ...(process.env.NODE_ENV !== "production" ? ["http://localhost:5173", "http://127.0.0.1:5173"] : [])
  ].filter(Boolean);

  return new Set(configuredOrigins.map((value) => {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) ||
      url.username ||
      url.password
    ) {
      throw new Error("Subscription callback origins must use HTTPS.");
    }
    return url.origin;
  }));
}

function getCallbackUrl(req) {
  const trustedOrigins = getTrustedOrigins();
  const requestOrigin = getHeader(req, "origin");
  if (requestOrigin) {
    try {
      const origin = new URL(requestOrigin);
      if (origin.origin === requestOrigin && trustedOrigins.has(origin.origin)) {
        return `${origin.origin}/?subscription=verify`;
      }
    } catch {
      // An invalid Origin is ignored; use the configured canonical app origin.
    }
  }

  const fallbackOrigin = new URL(
    process.env.APP_URL?.trim() || "https://storekeeper-lite.vercel.app"
  ).origin;
  if (!trustedOrigins.has(fallbackOrigin)) {
    throw new Error("No trusted subscription callback origin is configured.");
  }
  return `${fallbackOrigin}/?subscription=verify`;
}

async function getPaystackResponse(response) {
  const responseText = await response.text();
  if (!responseText) {
    return { message: `Paystack returned an empty response (HTTP ${response.status}).` };
  }
  try {
    return JSON.parse(responseText);
  } catch {
    return { message: `Paystack returned a non-JSON response (HTTP ${response.status}).` };
  }
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
    let response;
    let result;
    try {
      response = await fetch("https://api.paystack.co/transaction/initialize", {
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
          callback_url: getCallbackUrl(req)
        }),
        signal: AbortSignal.timeout(15000)
      });
      result = await getPaystackResponse(response);
    } catch (error) {
      console.error("Paystack transaction initialization request failed.", error);
      return respond(res, 502, {
        error: error.name === "TimeoutError"
          ? "Paystack request timed out. Please try again."
          : `Paystack request failed: ${error.message || "Unknown network error."}`
      });
    }

    const authorizationUrl = result?.data?.authorization_url;
    if (!response.ok || result?.status !== true || typeof authorizationUrl !== "string") {
      console.error("Paystack transaction initialization failed.", {
        status: response.status,
        message: result?.message ?? "Unexpected response"
      });
      return respond(res, 502, {
        error: result?.message || `Paystack transaction initialization failed (HTTP ${response.status}).`
      });
    }

    return respond(res, 200, { success: true, authorization_url: authorizationUrl });
  } catch (error) {
    console.error("Could not initialize Paystack checkout.", error);
    return respond(res, 500, { error: "Checkout is temporarily unavailable. Please try again." });
  }
}
