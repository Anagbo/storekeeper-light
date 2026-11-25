import { useState } from "react";
import { isValidGhanaCardNumber, normalizeGhanaCardNumber } from "../lib/ghanaCardNumber.js";
import { formatGhanaCard } from "../utils/formatters.js";
import { normalizeWhatsAppPhone } from "../utils/whatsapp.js";
import { PosPrimaryButton, PosSecondaryButton } from "./PosComponents.jsx";
import { posText as t } from "./i18n.js";
import { displayName } from "../lib/displayName.js";
import { useBackBlock, useBackHandler } from "./browserBack.js";
import { useFormErrors } from "./formErrors.js";

export default function CustomerContactEditor({ customer, onClose, onSave }) {
  const [phone, setPhone] = useState(customer.phone ?? "");
  const [ghanaCardNumber, setGhanaCardNumber] = useState(formatGhanaCard(customer.ghanaCardNumber ?? ""));
  const [busy, setBusy] = useState(false);
  useBackBlock(busy);
  useBackHandler(true, onClose);
  const [error, setError] = useState("");
  const phoneInvalid = Boolean(phone.trim() && !normalizeWhatsAppPhone(phone));
  // rules_global.form_errors: shown after Save with a problem, gone as soon as it is fixed.
  const formErrors = useFormErrors([
    ["phone", phoneInvalid ? t("contact.invalidPhone") : ""],
    ["ghanaCard", isValidGhanaCardNumber(ghanaCardNumber) ? "" : t("credit.invalidGhanaCard")]
  ]);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (!formErrors.check()) return;

    setBusy(true);
    setError("");
    try {
      await onSave({
        customerId: customer.customerId ?? customer.id,
        name: customer.name,
        phone: phone.trim(),
        ghanaCardNumber: normalizeGhanaCardNumber(ghanaCardNumber)
      });
      onClose();
    } catch (saveError) {
      console.error("Could not save customer contact details.", saveError);
      setError(t("contact.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/60 p-0 sm:items-center sm:p-4" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <section role="dialog" aria-modal="true" aria-labelledby="contact-editor-title" className="safe-bottom max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl">
        <h2 id="contact-editor-title" className="text-xl font-extrabold">{t("contact.title", { name: displayName(customer.name) })}</h2>
        <p className="mt-1 text-slate-700">{t("contact.explanation")}</p>
        <form onSubmit={(event) => void submit(event)} className="mt-4 flex flex-col gap-3">
          <label className="block font-bold">
            {t("credit.phone")}
            <input
              type="tel"
              inputMode="tel"
              autoComplete="off"
              maxLength="30"
              value={phone}
              onChange={(event) => { setPhone(event.target.value); setError(""); }}
              placeholder={t("credit.phonePlaceholder")}
              aria-invalid={phoneInvalid}
              aria-describedby="contact-phone-hint"
              className={`mt-1 h-14 w-full rounded-2xl border-[3px] px-3 text-lg font-normal ${phoneInvalid ? "border-rose-900" : "border-slate-500"}`}
            />
            <span id="contact-phone-hint" className={`text-sm font-normal ${phoneInvalid ? "text-rose-900" : "text-slate-700"}`}>{phoneInvalid ? t("contact.invalidPhone") : t("contact.phoneHint")}</span>
          </label>
          <label className="block font-bold">
            {t("credit.ghanaCard")}
            <input
              autoCapitalize="characters"
              maxLength="15"
              value={ghanaCardNumber}
              onChange={(event) => { setGhanaCardNumber(formatGhanaCard(event.target.value)); setError(""); }}
              placeholder={t("credit.ghanaCardPlaceholder")}
              className="mt-1 h-14 w-full rounded-2xl border-[3px] border-slate-500 px-3 text-lg font-normal"
            />
            <span className="text-sm font-normal text-slate-700">{t("credit.ghanaCardHint")}</span>
          </label>
          {(formErrors.message || error) && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{formErrors.message || error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <PosSecondaryButton type="button" disabled={busy} onClick={onClose}>{t("credit.cancel")}</PosSecondaryButton>
            <PosPrimaryButton type="submit" disabled={busy}>{busy ? t("contact.saving") : t("contact.save")}</PosPrimaryButton>
          </div>
        </form>
      </section>
    </div>
  );
}
