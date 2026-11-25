import { useState } from "react";
import CustomerContactEditor from "./CustomerContactEditor.jsx";
import { AddButton } from "./PosComponents.jsx";
import { posText as t } from "./i18n.js";

// rules_global.saved_credit_layout (25 Nov 2026): a person with no valid phone never gets a
// working-looking WhatsApp button. In its place the dashed "+ Add phone number to send WhatsApp" opens
// the same contact editor as Payment received; once a number is saved the screen shows WhatsApp again.
export default function AddPhoneForWhatsApp({ customer, onSaveCustomerContact, onSaved, label = t("contact.addPhoneForWhatsApp") }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <AddButton data-add-phone-whatsapp="" onClick={() => setOpen(true)}>{label}</AddButton>
      {open && (
        <CustomerContactEditor
          customer={customer}
          onClose={() => setOpen(false)}
          onSave={async (details) => { onSaved?.(await onSaveCustomerContact(details)); }}
        />
      )}
    </>
  );
}
