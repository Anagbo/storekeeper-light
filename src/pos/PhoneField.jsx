import { useState } from "react";
import { isValidPhone } from "../lib/phoneNumber.js";
import { posText as t } from "./i18n.js";
import { useLayoutContext } from "./layout.js";

// One behaviour for every phone field (New supplier, New person, the contact editor), phone and wide.
// The number is checked when the person leaves the field and on Save, never while the first digits are
// still being typed. A bad number blocks Save and shows "Enter a valid mobile number, like 024 123 4567"
// directly under the field (red border, red text), linked with aria-describedby and aria-invalid. The
// message goes as soon as the number is valid. What was typed stays as typed.
export function usePhoneCheck(phone) {
  const [checked, setChecked] = useState(false);
  const valid = isValidPhone(phone ?? "");
  // Valid again: forget the check, so a new mistake waits for the next leave or Save.
  if (checked && valid) setChecked(false);
  const showError = checked && !valid;
  return {
    valid,
    showError,
    error: showError ? t("contact.invalidPhone") : "",
    onBlur() { if (!valid) setChecked(true); },
    // Call on Save: shows the message and returns false for a bad number, true otherwise.
    check() {
      if (!valid) setChecked(true);
      return valid;
    }
  };
}

// Props for the <input>: the red border is the caller's (each form has its own border width).
// The message id is linked only while there is a line to read (the error, or a helper line).
export function phoneInputProps(check, messageId, { hint = false } = {}) {
  return { "aria-invalid": check.showError, "aria-describedby": check.showError || hint ? messageId : undefined, onBlur: check.onBlur };
}

// The line under the field: the error (15px, 17px on wide) when there is one, else the helper line.
export function PhoneFieldMessage({ id, check, hint = "" }) {
  const wide = useLayoutContext().mode !== "phone";
  if (check.showError) {
    return <span id={id} role="alert" data-phone-error="" className={`mt-1 block font-semibold text-rose-900 ${wide ? "text-[17px]" : "text-[15px]"}`}>{check.error}</span>;
  }
  if (!hint) return <span id={id} hidden />;
  return <span id={id} className="mt-1 block text-[15px] font-normal text-[#475569]">{hint}</span>;
}
