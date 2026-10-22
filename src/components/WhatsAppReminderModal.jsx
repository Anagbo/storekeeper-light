import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { normalizeWhatsAppPhone } from "../utils/whatsapp.js";

export default function WhatsAppReminderModal({
  debt,
  onClose,
  onPhoneSaved
}) {
  const [phone, setPhone] = useState(debt.phone || debt.customer_phone || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const formattedPhone = normalizeWhatsAppPhone(phone);
  const phoneAlreadySaved = Boolean(formattedPhone) &&
    formattedPhone === normalizeWhatsAppPhone(debt.phone ?? debt.customer_phone);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose]);

  async function savePhone(event) {
    event.preventDefault();
    if (!formattedPhone) {
      setError("Enter a valid Ghana WhatsApp number, such as 024 123 4567.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      if (!phoneAlreadySaved) {
        await onPhoneSaved(debt, formattedPhone);
      }
      onClose();
    } catch (saveError) {
      console.error("Could not save the WhatsApp number.", saveError);
      setError("The number could not be saved. Please check your storage and try again.");
    } finally {
      setBusy(false);
    }
  }

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

        <form onSubmit={(event) => void savePhone(event)} className="mt-4 space-y-4">
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
              onChange={(event) => { setPhone(event.target.value); setError(""); }}
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

          {error && <p role="alert" className="text-sm text-amber-800">{error}</p>}
          {formattedPhone && (
            <button
              type="submit"
              disabled={busy}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Saving number…" : "Save number"}
            </button>
          )}
        </form>
      </section>
    </div>
  );
}
