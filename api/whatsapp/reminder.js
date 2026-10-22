function respond(res, status, body) {
  return res.status(status).setHeader("Content-Type", "application/json; charset=utf-8").json(body);
}

function normalizeGhanaPhone(value) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `233${digits.slice(1)}`;
  if (digits.length === 9) digits = `233${digits}`;
  return /^233\d{9}$/.test(digits) ? digits : null;
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

  try {
    const authorization = req.headers.authorization ?? "";
    const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!accessToken) return respond(res, 401, { error: "Sign in before sending a reminder." });

    const supabaseUrl = requiredEnvironment("SUPABASE_URL");
    const supabaseAnonKey = requiredEnvironment("SUPABASE_ANON_KEY");
    const authResponse = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`
      }
    });
    if (!authResponse.ok) return respond(res, 401, { error: "Your sign-in has expired. Sign in again." });

    const user = await authResponse.json();
    const allowedUserIds = requiredEnvironment("WHATSAPP_ALLOWED_USER_IDS")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    if (!user.id || !allowedUserIds.includes(user.id)) {
      return respond(res, 403, { error: "This account is not allowed to send WhatsApp reminders." });
    }

    const { phone, customerName, shopName, amountPesewas } = req.body ?? {};
    if (
      typeof phone !== "string" ||
      typeof customerName !== "string" ||
      typeof shopName !== "string" ||
      !Number.isSafeInteger(amountPesewas) ||
      amountPesewas <= 0
    ) {
      return respond(res, 400, { error: "A valid phone number, names, and amount are required." });
    }

    const recipient = normalizeGhanaPhone(phone);
    if (!recipient) return respond(res, 400, { error: "Enter a valid Ghana WhatsApp number." });
    if (!customerName.trim() || !shopName.trim() || customerName.length > 100 || shopName.length > 100) {
      return respond(res, 400, { error: "Customer and shop names must contain 1 to 100 characters." });
    }

    const whatsappAccessToken = requiredEnvironment("WHATSAPP_ACCESS_TOKEN");
    const phoneNumberId = requiredEnvironment("WHATSAPP_PHONE_NUMBER_ID");
    const apiVersion = requiredEnvironment("WHATSAPP_GRAPH_API_VERSION");
    if (!/^v\d+\.\d+$/.test(apiVersion)) {
      return respond(res, 500, { error: "WHATSAPP_GRAPH_API_VERSION must use the format vXX.X." });
    }
    const templateName = process.env.WHATSAPP_DEBT_TEMPLATE?.trim() || "debt_reminder";
    const languageCode = process.env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || "en";
    const amount = `GHS ${(amountPesewas / 100).toFixed(2)}`;
    const graphResponse = await fetch(
      `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(phoneNumberId)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${whatsappAccessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: recipient,
          type: "template",
          template: {
            name: templateName,
            language: { code: languageCode },
            components: [{
              type: "body",
              parameters: [
                { type: "text", text: customerName.trim() },
                { type: "text", text: amount },
                { type: "text", text: shopName.trim() }
              ]
            }]
          }
        })
      }
    );
    const graphBody = await graphResponse.json();
    if (!graphResponse.ok) {
      console.error("WhatsApp Cloud API rejected a reminder.", {
        status: graphResponse.status,
        error: graphBody.error?.code ?? graphBody.error?.type ?? "unknown"
      });
      return respond(res, 502, { error: "WhatsApp could not send the reminder. Check the business template and number." });
    }

    return respond(res, 200, { messageId: graphBody.messages?.[0]?.id ?? null });
  } catch (error) {
    console.error("WhatsApp reminder request failed.", error);
    return respond(res, 500, { error: "The reminder could not be sent. Check the server configuration." });
  }
}
