import { Banknote, Phone } from "lucide-react";
import { displayName } from "../lib/displayName.js";
import { formatGhs } from "../lib/money.js";
import { localDateString } from "../utils/installments.js";
import { hasUsablePhone } from "../lib/phoneNumber.js";
import { posText as t } from "./i18n.js";
import { AddButton, PosStatusTag } from "./PosComponents.jsx";

// The one card for a person or supplier with money to settle: 22 (Collect first) and 32 (Owed list)
// through PersonRow below (rules_global.person_row), 46 (You owe suppliers) directly.

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Due tag wording and colour, shared by 22, 32 and 46: grey when more than 3 days away, amber when
// 3 days or less or due today, red when late, nothing without a date. People read "In 5 days"
// (the Owed list wording); suppliers read "Due in 5 days" (46). `today` is a local yyyy-mm-dd.
export function dueTag(dueDate, { today = localDateString(), wording = "person" } = {}) {
  if (!DATE.test(dueDate ?? "") || !DATE.test(today ?? "")) return null;
  const days = Math.round((Date.parse(`${dueDate}T00:00:00.000Z`) - Date.parse(`${today}T00:00:00.000Z`)) / 86_400_000);
  if (!Number.isFinite(days)) return null;
  const plural = (n) => (n === 1 ? "" : "s");
  const keys = wording === "supplier"
    ? { late: "supplier.late", today: "supplier.dueToday", soon: "supplier.dueInDays" }
    : { late: "debt.lateDays", today: "debt.dueToday", soon: "debt.inDays" };
  if (days < 0) return { tone: "red", days, label: t(keys.late, { days: -days, plural: plural(-days) }) };
  if (days === 0) return { tone: "amber", days, label: t(keys.today) };
  return { tone: days <= 3 ? "amber" : "neutral", days, label: t(keys.soon, { days, plural: plural(days) }) };
}

export function DueTag({ dueDate, today, wording = "person", large = false }) {
  const tag = dueTag(dueDate, { today, wording });
  if (!tag) return null;
  return <PosStatusTag tone={tag.tone} large={large}>{tag.label}</PosStatusTag>;
}

// A Call link only for a valid phone number; never a greyed, disabled Call button (46 suppliers).
export function callHrefFor(phone) {
  if (!hasUsablePhone(phone)) return "";
  return `tel:${String(phone).replace(/[^\d+]/g, "")}`;
}

// rules_global.person_row (decided 21 Nov 2026): on 22 and 32 any saved number counts, even one that
// fails the WhatsApp check. "" when no number is saved (nothing with a digit in it).
export function hasSavedPhone(phone) {
  return typeof phone === "string" && /\d/.test(phone);
}

export function telHrefFor(phone) {
  return hasSavedPhone(phone) ? `tel:${phone.replace(/[^\d+]/g, "")}` : "";
}

export function WhatsAppIcon({ size = 27 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z" fill="#25D366" />
      <path d="M8.5 7.2c.3-.5.8-.5 1.1-.3l1 2c.1.3 0 .6-.2.8l-.6.7c.7 1.3 1.7 2.3 3 3l.8-.6c.2-.2.5-.2.8-.1l1.9 1c.3.2.4.6.2 1-.4 1-1.4 1.6-2.4 1.4-3.2-.7-6-3.4-6.8-6.5-.1-.6.1-1.1.3-1.6z" fill="#fff" />
    </svg>
  );
}

const AMOUNT_SIZES = { 22: "text-[22px]", 24: "text-[24px]", 26: "text-[26px]", 28: "text-[28px]" };
const SQUARE = "grid h-[52px] w-[52px] shrink-0 place-items-center rounded-[14px] border-2 bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800";

// Top row: the name (bold 19px, up to 2 lines, capital first letter) and the amount (bold, never
// shrunk or clipped) on the right; the due tag under the name. Bottom row: the green action (52px,
// takes the remaining width), then WhatsApp (when given) and Call (only with a valid number).
// `whatsapp.onClick` is the shared reminder check on 22 (rules_global.reminders).
// `dateText` (46): the due date under the tag; `cardWide` (46 on wide): the larger name and amount, 15px tags,
// the date beside the tag and the buttons at the bottom of an equal-height card.
// `action.outlined` (46): the outlined green Pay (2px #03543F, white, green text) for a supplier not urgent;
// `reserveCall` keeps the 52px Call slot (empty) when there is no number, so Pay is the same width on every card.
// `framed` draws the card border (46); on 22 the card sits inside the Owed card without one.
export function PartyCard({
  framed = true,
  name,
  onNameClick,
  nameLabel,
  amountPesewas,
  amountSize = 24,
  dueDate,
  today,
  wording = "person",
  action,
  whatsapp,
  phone,
  callLabel,
  callAnyNumber = false,
  extra = null,
  wide = false,
  maskedAmount = null,
  dateText = "",
  cardWide = false,
  reserveCall = false,
  ...rest
}) {
  const shown = displayName(name);
  const callHref = callAnyNumber ? telHrefFor(phone) : callHrefFor(phone);
  const ActionIcon = action.icon;
  // rules_global.person_row "Due tag on one line" (4k, 21 Nov 2026): the top row is a two-column grid.
  // The name (top left) gives way first; the amount (right) spans both rows; the due tag has its own
  // row across the full width, on one line, and may run on under the amount (one line, ending above
  // the tag). Rows without a tag, and tags that already fit, stay where they were: without a tag the
  // amount spans one row only (an empty spanned row made the row taller).
  // `wide` (22 Home wide, design_principles): one compact line, name with its tag below on the left,
  // the amount, then fixed-width buttons together at the right. The phone markup is not touched.
  const nameCell = `col-start-1 row-start-1 line-clamp-2 min-w-0 break-words ${cardWide ? "text-[21px]" : "text-[19px]"} leading-tight ${wide || cardWide ? "font-bold" : "font-extrabold"}`;
  const nameColumn = (
    <>
      {framed ? <h2 className={nameCell}>{shown}</h2> : <span data-party-name="" className={nameCell}>{shown}</span>}
      {dueDate && (
        <div data-party-tag="" className={`${wide ? "col-start-1" : "col-span-full"} row-start-2 mt-1.5 whitespace-nowrap ${dateText ? (cardWide ? "flex flex-wrap items-center gap-x-3 gap-y-1" : "flex flex-col items-start gap-1") : ""}`}>
          <DueTag dueDate={dueDate} today={today} wording={wording} large={wide || cardWide} />
          {dateText && <span data-party-date="" className="text-[15px] font-semibold text-slate-600">{dateText}</span>}
        </div>
      )}
    </>
  );
  const amount = <span data-party-amount="" className={`col-start-2 ${dueDate ? "row-span-2" : ""} row-start-1 whitespace-nowrap ${wide || cardWide ? "self-center font-bold" : "font-extrabold"} leading-tight ${AMOUNT_SIZES[amountSize] ?? AMOUNT_SIZES[24]}`}>{maskedAmount ?? formatGhs(amountPesewas)}</span>;
  const top = onNameClick ? (
    // rules_global.person_row: the whole top row (name, tag, amount and the space between) opens the
    // detail; a light grey tint while pressed, nothing at rest.
    <button type="button" data-person-open="" onClick={onNameClick} aria-label={nameLabel} className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 rounded-lg text-left active:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800">
      {nameColumn}{amount}
    </button>
  ) : (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3">{nameColumn}{amount}</div>
  );
  const Frame = framed ? "section" : "div";
  return (
    <Frame {...rest} className={`flex min-w-0 ${wide ? "flex-row items-center gap-4" : "flex-col gap-3"} ${framed ? (cardWide ? "rounded-[20px] border-2 border-slate-300 bg-white p-4" : "rounded-2xl border-2 border-slate-600 bg-white p-4") : ""}`}>
      {wide ? <div className="min-w-0 flex-1">{top}</div> : top}
      <div className={`flex min-w-0 ${wide ? "shrink-0 gap-3" : "gap-2"} ${cardWide ? "mt-auto justify-end" : ""}`}>
        <button type="button" aria-label={action.ariaLabel} onClick={action.onClick} className={`flex ${wide ? "h-12 w-40 shrink-0" : cardWide ? "h-[52px] w-48 shrink-0" : "h-[52px] min-w-0 flex-1"} items-center justify-center gap-2 rounded-[14px] border-2 px-4 text-lg ${wide || cardWide ? "font-bold" : "font-extrabold"} ${action.outlined ? "border-[#03543F] bg-white text-[#03543F]" : "border-emerald-950 bg-emerald-900 text-white"} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800`}>
          {ActionIcon && <ActionIcon size={22} aria-hidden="true" />}{action.label}
        </button>
        {/* rules_global.whatsapp_links: a button that calls the shared opener (src/lib/openWhatsApp.js). */}
        {whatsapp?.onClick && (
          <button type="button" onClick={whatsapp.onClick} aria-label={whatsapp.label} className={`${SQUARE}${wide ? " h-12! w-12!" : ""} border-emerald-900 text-emerald-900`}>
            {whatsapp.icon}
          </button>
        )}
        {callHref && (
          <a href={callHref} aria-label={callLabel} className={`${SQUARE}${wide ? " h-12! w-12!" : ""} border-[#0F172A] text-[#0F172A]`}>
            <Phone size={22} aria-hidden="true" />
          </a>
        )}
        {!callHref && reserveCall && <span data-call-slot="" aria-hidden="true" className="h-[52px] w-[52px] shrink-0" />}
        {extra}
      </div>
    </Frame>
  );
}

// rules_global.person_row: the person row of Home 22 (Collect first, the reference) and the Owed list 32.
// Name left and amount right on one line, the due tag, then Collect (main) with the icon-only WhatsApp
// and Call buttons when any number is saved, or "+ Add contact" when none is. The top row opens the
// detail (43 when late, 29 otherwise: one DebtorDetail route); the buttons never do.
// `onWhatsApp` gets the click event (the shared reminder check, rules_global.reminders).
export function PersonRow({ name, amountPesewas, dueDate, today, phone, onOpen, onCollect, collectLabel, onWhatsApp, onAddContact, wide = false, maskedAmount = null, ...rest }) {
  const shown = displayName(name);
  const saved = hasSavedPhone(phone);
  return (
    <PartyCard
      framed={false}
      {...rest}
      wide={wide}
      maskedAmount={maskedAmount}
      name={name}
      onNameClick={onOpen}
      nameLabel={t("person.openDetails", { name: shown })}
      amountPesewas={amountPesewas}
      amountSize={wide ? 28 : 22}
      dueDate={dueDate}
      today={today}
      action={{ label: t("home.collect"), ariaLabel: collectLabel ?? t("home.collectPayment", { name: shown }), icon: Banknote, onClick: onCollect }}
      whatsapp={saved ? { onClick: onWhatsApp, label: t("home.whatsappCustomer", { name: shown }), icon: <WhatsAppIcon size={24} /> } : null}
      phone={phone}
      callAnyNumber
      callLabel={t("home.callCustomer", { name: shown })}
      extra={saved ? null : (
        // open_text_sweep (17 Nov 2026): "+ Add contact" is the add look, beside Collect.
        <AddButton onClick={onAddContact} aria-label={t("contact.addFor", { name: shown })} className="w-auto! shrink-0 px-3!">
          {t("contact.add")}
        </AddButton>
      )}
    />
  );
}
