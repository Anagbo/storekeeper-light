import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowDownLeft, ArrowUpRight, MessageCircle, X } from "lucide-react";
import { saveCustomerContact } from "../db/customerContact.js";
import { formatGhs } from "../lib/money.js";
import { requestBackgroundSync } from "../lib/syncRegistration.js";
import { formatHistoryTimestamp } from "../utils/customerDebtHistory.js";
import { loadCustomerHistory } from "../utils/loadCustomerDebtHistory.js";
import { normalizeWhatsAppPhone } from "../utils/whatsapp.js";
import CustomerContactEditor from "../pos/CustomerContactEditor.jsx";

export default function CustomerDebtHistoryModal({ customer, onClose }) {
  const [contactEditorOpen, setContactEditorOpen] = useState(false);
  const [contact, setContact] = useState(customer);
  const history = useLiveQuery(
    () => loadCustomerHistory(customer.id, customer.name).catch((error) => {
      console.error("Could not load customer debt history.", error);
      return {
        events: [],
        totalCreditPesewas: 0,
        totalPaidPesewas: 0,
        currentBalancePesewas: 0,
        error: "Customer activity could not be loaded. Please close and retry."
      };
    }),
    [customer.id, customer.name],
    null
  );
  const phone = normalizeWhatsAppPhone(contact.phone);
  const recentEvents = history?.events ?? [];
  const summaryMessage = [
    `Debt statement for ${contact.name}`,
    `Total recorded credit issued: ${formatGhs(history?.totalCreditPesewas ?? 0)}`,
    `Total paid: ${formatGhs(history?.totalPaidPesewas ?? 0)}`,
    `Remaining balance: ${formatGhs(history?.currentBalancePesewas ?? 0)}`,
    "",
    "Recent activity:",
    ...recentEvents.slice(0, 5).map((event) => {
      const dateAndTime = formatHistoryTimestamp(event.timestamp);
      return `${event.type === "payment" ? "Payment" : "Credit"} ${formatGhs(event.amountPesewas)} · ${dateAndTime.date} · ${dateAndTime.time}`;
    })
  ].join("\n");
  const shareUrl = phone ? `https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(summaryMessage)}` : null;

  async function saveContact(details) {
    const updatedContact = await saveCustomerContact(details);
    setContact((current) => ({ ...current, ...updatedContact }));
    void requestBackgroundSync();
    return updatedContact;
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section role="dialog" aria-modal="true" aria-labelledby="customer-debt-history-title" className="safe-bottom max-h-[92dvh] w-full max-w-xl overflow-y-auto overscroll-contain rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl">
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-leaf">Customer statement</p>
            <h2 id="customer-debt-history-title" className="text-xl font-bold">{contact.name}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close customer history" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100">
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-50 p-3 sm:grid-cols-4">
          <div>
            <p className="text-xs text-slate-500">Credit issued (recorded)</p>
            <p className="font-bold text-amber-800">{formatGhs(history?.totalCreditPesewas ?? 0)}</p>
          </div>
          <div><p className="text-xs text-slate-500">Amount paid</p><p className="font-bold text-emerald-700">{formatGhs(history?.totalPaidPesewas ?? 0)}</p></div>
          <div className="col-span-2"><p className="text-xs text-slate-500">Remaining balance</p><p className="font-bold text-slate-900">{formatGhs(history?.currentBalancePesewas ?? 0)}</p></div>
        </div>
        {history && !history.error && history.unaccountedCreditPesewas !== 0 && (
          <p role="status" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            Recorded activity does not reconcile with the current debt balance by {formatGhs(Math.abs(history.unaccountedCreditPesewas))}.
            {history.unaccountedCreditPesewas > 0
              ? " The stored records do not identify the missing event or events."
              : " The recorded credit exceeds the balance and payments; review the stored records for adjustments or duplicates."}
          </p>
        )}
        {shareUrl && (
          <a href={shareUrl} target="_blank" rel="noopener noreferrer" className="mt-3 flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700">
            <MessageCircle size={17} aria-hidden="true" /> Share Summary via WhatsApp
          </a>
        )}
        <button type="button" onClick={() => setContactEditorOpen(true)} className="mt-3 flex min-h-11 w-full items-center justify-center rounded-xl border-2 border-emerald-900 px-3 text-sm font-bold text-emerald-900">
          {phone ? "Edit contact details" : "Add phone number"}
        </button>

        <h3 className="mb-2 mt-5 font-bold">Payment & credit history</h3>
        {history === null ? (
          <p className="py-8 text-center text-sm text-slate-500">Loading customer activity…</p>
        ) : history.error ? (
          <p role="alert" className="py-8 text-center text-sm text-red-700">{history.error}</p>
        ) : recentEvents.length ? (
          <ul className="divide-y divide-slate-100">
            {recentEvents.map((event) => {
              const isPayment = event.type === "payment";
              const dateAndTime = formatHistoryTimestamp(event.timestamp);
              return (
                <li key={event.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${isPayment ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
                      {isPayment ? <ArrowDownLeft size={18} aria-hidden="true" /> : <ArrowUpRight size={18} aria-hidden="true" />}
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {isPayment
                          ? "Payment received"
                          : event.type === "addon" ? "Credit add-on" : "Credit purchase"}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {event.detail} · {dateAndTime.date} · {dateAndTime.time}
                      </p>
                    </div>
                  </div>
                  <p className={`shrink-0 font-bold ${isPayment ? "text-emerald-700" : "text-amber-800"}`}>
                    {isPayment ? "+" : "−"}{formatGhs(event.amountPesewas)}
                  </p>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="py-8 text-center text-sm text-slate-500">No payment or credit activity recorded yet.</p>
        )}
      </section>
      {contactEditorOpen && (
        <CustomerContactEditor
          customer={contact}
          onClose={() => setContactEditorOpen(false)}
          onSave={saveContact}
        />
      )}
    </div>
  );
}
