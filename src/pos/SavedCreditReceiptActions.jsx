import { useState } from "react";
import { normalizeWhatsAppPhone } from "../utils/whatsapp.js";
import { posText as t } from "./i18n.js";
import AddPhoneForWhatsApp from "./AddPhoneForWhatsApp.jsx";
import { CopyReceiptButton, ReceiptFailedLine, ReceiptOfflineLine, ReceiptPair, SendReceiptButton, useReceiptActions } from "./ReceiptActions.jsx";

// rules_global.saved_credit_layout (25 Nov 2026): the one receipt block for "Saved as credit", shared by
// Sell → Owe (CreditSaved) and Add debt (ManualDebtSaved) so the two cannot drift. Send receipt is always
// there: with a valid phone it opens that person's chat, without one openWhatsApp opens the share sheet.
// Only without a phone the dashed "+ Add phone number" sits under it. Copy receipt is optional (showCopy).
export function useSavedCreditPhone(initialPhone) {
  const [addedContact, setAddedContact] = useState(null);
  const phone = addedContact?.phone || initialPhone || "";
  return { phone, hasPhone: Boolean(normalizeWhatsAppPhone(phone)), setAddedContact };
}

export default function SavedCreditReceiptActions({ text, phone, hasPhone, customer, onSaveCustomerContact, onSaved, wide = false, showCopy = true }) {
  const actions = useReceiptActions(text, normalizeWhatsAppPhone(phone) ?? "");
  const addPhone = (
    <AddPhoneForWhatsApp customer={customer} onSaveCustomerContact={onSaveCustomerContact} onSaved={onSaved} label={t("collect.addPhoneForReceipt")} />
  );
  return (
    <>
      {wide ? (
        showCopy ? (
          <ReceiptPair
            send={<SendReceiptButton onClick={() => void actions.send()} className="min-h-14 w-full" />}
            copy={<CopyReceiptButton onClick={() => void actions.copy()} copied={actions.copied} className="h-14!" />}
            online={actions.online}
            failed={actions.failed}
          />
        ) : (
          <>
            <SendReceiptButton onClick={() => void actions.send()} className="min-h-14 w-full" />
            <ReceiptOfflineLine online={actions.online} wide />
          </>
        )
      ) : (
        <div className="flex flex-col gap-2">
          <SendReceiptButton onClick={() => void actions.send()} className="min-h-14 w-full" />
          <ReceiptOfflineLine online={actions.online} />
        </div>
      )}
      {!hasPhone && addPhone}
      {!wide && showCopy && <CopyReceiptButton onClick={() => void actions.copy()} copied={actions.copied} />}
      {(!wide || !showCopy) && <ReceiptFailedLine failed={actions.failed} wide={wide} />}
    </>
  );
}
