import { useEffect, useState } from "react";
import { X } from "lucide-react";

const DEFAULT_EMAIL = "customer@storekeeper.app";

export default function SubscriptionModal({
  isOpen,
  onClose,
  expiresAt,
  notice,
  lockout = false,
  isActive = false
}) {
  const [email, setEmail] = useState(DEFAULT_EMAIL);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen || lockout) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape" && !isProcessing) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isProcessing, lockout, onClose]);

  if (!isOpen) return null;

  async function startCheckout(event) {
    event.preventDefault();
    if (isProcessing) return;
    setIsProcessing(true);
    setError("");
    try {
      const response = await fetch("/api/subscription/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
        signal: AbortSignal.timeout(20000)
      });

      if (!response.ok) {
        const responseBody = await response.text().catch(() => "");
        let serverMessage = "";
        try {
          serverMessage = JSON.parse(responseBody).error || "";
        } catch {
          serverMessage = "";
        }
        const statusMessage = `Checkout endpoint returned HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`;
        console.error("Paystack checkout endpoint returned a non-success status.", {
          status: response.status,
          statusText: response.statusText,
          responseBody: responseBody.slice(0, 500)
        });
        throw new Error(serverMessage ? `${statusMessage} ${serverMessage}` : statusMessage);
      }

      let result;
      try {
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.toLowerCase().includes("application/json")) {
          const responseBody = await response.text();
          console.error("Paystack checkout endpoint returned a non-JSON success response.", {
            status: response.status,
            contentType,
            responseBody: responseBody.slice(0, 500)
          });
          throw new Error(`Checkout endpoint returned HTTP ${response.status} with a non-JSON response. Confirm the local API route is running.`);
        }
        result = await response.json();
      } catch (responseError) {
        if (responseError instanceof Error && responseError.message.startsWith("Checkout endpoint returned ")) {
          throw responseError;
        }
        console.error("Paystack checkout endpoint returned an empty or invalid JSON response.", {
          status: response.status,
          statusText: response.statusText,
          error: responseError
        });
        throw new Error(`Checkout endpoint returned HTTP ${response.status} with an empty or invalid JSON response.`);
      }

      if (result.success !== true || typeof result.authorization_url !== "string") {
        throw new Error(result.error || "Unable to launch checkout. Please try again.");
      }

      const checkoutUrl = new URL(result.authorization_url);
      if (checkoutUrl.protocol !== "https:" || checkoutUrl.hostname !== "checkout.paystack.com") {
        throw new Error("Paystack returned an invalid checkout address.");
      }
      window.location.assign(checkoutUrl.href);
    } catch (checkoutError) {
      console.error("Unable to launch Paystack checkout.", checkoutError);
      setError(checkoutError.message || "Unable to launch checkout. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4"
      onMouseDown={(event) => event.target === event.currentTarget && !lockout && !isProcessing && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="subscription-title"
        className="safe-bottom max-h-[92dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-leaf">StoreKeeper Light</p>
            <h2 id="subscription-title" className="mt-1 text-xl font-bold">Monthly subscription</h2>
          </div>
          {!lockout && (
            <button
              type="button"
              onClick={onClose}
              disabled={isProcessing}
              aria-label="Close subscription"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-700 disabled:opacity-50"
            >
              <X size={19} aria-hidden="true" />
            </button>
          )}
        </div>

        {isActive ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <span className="inline-flex min-h-9 items-center rounded-full bg-emerald-100 px-3 text-sm font-bold text-emerald-800">
              ✓ Active Plan
            </span>
            {expiresAt && (
              <p className="mt-3 text-sm text-emerald-900">
                Active until {new Date(expiresAt).toLocaleDateString("en-GB")}
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-xl bg-emerald-50 p-4">
            <p className="text-2xl font-bold text-emerald-950">GHS 15.00 <span className="text-sm font-medium">/ month</span></p>
            <p className="mt-1 text-sm text-emerald-900">Pay securely with Mobile Money through Paystack.</p>
            <p className="mt-2 text-xs text-emerald-800">Choose your mobile network and approve the payment in Paystack checkout.</p>
          </div>
        )}
        {notice && (
          <p
            role={notice.type === "error" ? "alert" : "status"}
            className={`mt-3 rounded-lg px-3 py-2 text-sm ${notice.type === "error" ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-900"}`}
          >
            {notice.text}
          </p>
        )}

        {isActive ? (
          <button
            type="button"
            onClick={onClose}
            className="mt-4 flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-700 px-4 font-semibold text-white hover:bg-emerald-800"
          >
            Close
          </button>
        ) : (
          <form onSubmit={(event) => void startCheckout(event)} className="mt-4 space-y-3">
            <label htmlFor="subscription-email" className="block text-sm font-semibold">
              Email for payment receipt
              <input
                id="subscription-email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                onChange={(event) => { setEmail(event.target.value); setError(""); }}
                className="mt-1 min-h-12 w-full rounded-xl border border-slate-200 px-3 text-base font-normal outline-none focus:border-leaf focus:ring-2 focus:ring-leaf/20 sm:text-sm"
              />
            </label>
            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <button
              type="submit"
              disabled={isProcessing}
              className="flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-700 px-4 font-semibold text-white disabled:cursor-wait disabled:opacity-60"
            >
              {isProcessing ? "Launching checkout…" : "Pay GHS 15.00 / Month"}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
