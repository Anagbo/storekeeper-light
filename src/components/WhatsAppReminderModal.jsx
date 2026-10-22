import { useEffect, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { generateWhatsAppLink, normalizeWhatsAppPhone } from "../utils/whatsapp.js";

export default function WhatsAppReminderModal({
  debt,
  shopName = "StoreKeeper Light",
  onClose,
  onPhoneSaved
}) {
  const [phone, setPhone] = useState(debt.phone || debt.customer_phone || "");
  const [savedPhone, setSavedPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const formattedPhone = normalizeWhatsAppPhone(phone);
  const phoneAlreadySaved = Boolean(formattedPhone) &&
    formattedPhone === normalizeWhatsAppPhone(debt.phone ?? debt.customer_phone);
  const link = generateWhatsAppLink(
    formattedPhone ?? phone,
    debt.customerName || debt.customer_name,
    debt.amountPesewas / 100,
    shopName
  );

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose]);

  async function openReminder(event) {
    event.preventDefault();
    if (!formattedPhone || !link) {
      setError("Enter a valid Ghana WhatsApp number, such as 024 123 4567.");
      return;
    }

    const popup = window.open("about:blank", "_blank");
    setBusy(true);
    setError("");
    try {
      if (!phoneAlreadySaved) {
        await onPhoneSaved(debt, formattedPhone);
      }

      if (popup) {
        popup.opener = null;
        popup.location.replace(link);
        onClose();
      } else {
        setSavedPhone(formattedPhone);
        setError(`${phoneAlreadySaved ? "Your number is already saved" : "Your number was saved"}, but the browser blocked the new tab. Use the button below to open WhatsApp.`);
      }
    } catch (saveError) {
      console.error("Could not save the WhatsApp number.", saveError);
      popup?.close();
      setError("The number could not be saved. Please check your storage and try again.");
    } finally {
      setBusy(false);
    }
  }

  const fallbackLink = savedPhone
    ? generateWhatsAppLink(
        savedPhone,
        debt.customerName || debt.customer_name,
        debt.amountPesewas / 100,
        shopName
      )
    : null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="whatsapp-reminder-title"
        className="safe-bottom max-h-[92dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-leaf">Customer balance</p>
            <h2 id="whatsapp-reminder-title" className="mt-1 text-xl font-bold">WhatsApp reminder</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close WhatsApp reminder"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-700 disabled:opacity-50"
          >
            <X size={19} aria-hidden="true" />
          </button>
        </div>

        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {debt.customerName ?? debt.customer_name} has an outstanding balance of{" "}
          <strong>{`GH₵ ${(debt.amountPesewas / 100).toFixed(2)}`}</strong>.
        </p>

        <form onSubmit={(event) => void openReminder(event)} className="mt-4 space-y-4">
          <label className="block text-sm font-semibold" htmlFor="whatsapp-customer-phone">
            WhatsApp number
            <input
              id="whatsapp-customer-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              maxLength="30"
              required
              autoFocus={!phone}
              value={phone}
              onChange={(event) => { setPhone(event.target.value); setSavedPhone(""); setError(""); }}
              placeholder="024 123 4567"
              aria-invalid={Boolean(phone && !formattedPhone)}
              aria-describedby="whatsapp-phone-help"
              className="mt-1 min-h-12 w-full rounded-xl border border-slate-200 px-3 text-base font-normal outline-none focus:border-leaf focus:ring-2 focus:ring-leaf/20 sm:text-sm"
            />
            <span id="whatsapp-phone-help" className={`mt-1 block text-xs font-normal ${phone && !formattedPhone ? "text-red-700" : "text-slate-500"}`}>
              {phone && !formattedPhone
                ? "Enter a valid Ghana mobile number: 10 digits starting 02 or 05, or +233 followed by 9 digits."
                : "Ghana numbers are opened with the +233 country code."}
            </span>
          </label>

          <div className="rounded-xl bg-slate-50 p-4 text-sm leading-relaxed text-slate-700">
            {link
              ? decodeURIComponent(link.split("?text=")[1])
              : "Enter a valid Ghana number to preview the reminder."}
          </div>

            {error && <p role="alert" className="text-sm text-amber-800">{error}</p>}
          {fallbackLink && (
            <a
              href={fallbackLink}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClose}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-100 px-4 font-semibold text-emerald-900"
            >
              <MessageCircle size={18} aria-hidden="true" /> Open WhatsApp
            </a>
          )}
          {!fallbackLink && formattedPhone && (
            <button
              type="submit"
              disabled={busy}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 font-semibold text-white disabled:opacity-50"
            >
              <MessageCircle size={18} aria-hidden="true" />
              {busy ? "Saving number…" : phoneAlreadySaved ? "Open WhatsApp" : "Save number & open WhatsApp"}
            </button>
          )}
        </form>
      </section>
    </div>
  );
}
