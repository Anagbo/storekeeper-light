import { Phone } from "lucide-react";
import { displayName } from "../lib/displayName.js";
import { formatGhs } from "../lib/money.js";
import { localDateString } from "../utils/installments.js";
import { normalizeWhatsAppPhone } from "../utils/whatsapp.js";
import { posText as t } from "./i18n.js";
import { PosStatusTag } from "./PosComponents.jsx";

// The one card for a person or supplier with money to settle: 22 (Collect first), 46 (You owe
// suppliers). 32 keeps its own row layout (owner decision 11 Nov 2026) and uses DueTag from here.

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

export function DueTag({ dueDate, today, wording = "person" }) {
  const tag = dueTag(dueDate, { today, wording });
  if (!tag) return null;
  return <PosStatusTag tone={tag.tone}>{tag.label}</PosStatusTag>;
}

// A Call link only for a valid phone number; never a greyed, disabled Call button.
export function callHrefFor(phone) {
  if (!normalizeWhatsAppPhone(phone)) return "";
  return `tel:${String(phone).replace(/[^\d+]/g, "")}`;
}

const AMOUNT_SIZES = { 22: "text-[22px]", 24: "text-[24px]" };
const SQUARE = "grid h-[52px] w-[52px] shrink-0 place-items-center rounded-[14px] border-2 bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800";

// Top row: the name (bold 19px, up to 2 lines, capital first letter) and the amount (bold, never
// shrunk or clipped) on the right; the due tag under the name. Bottom row: the green action (52px,
// takes the remaining width), then WhatsApp (when given) and Call (only with a valid number).
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
  extra = null,
  ...rest
}) {
  const shown = displayName(name);
  const callHref = callHrefFor(phone);
  const ActionIcon = action.icon;
  const nameText = <span data-party-name="" className="line-clamp-2 block min-w-0 break-words text-[19px] font-extrabold leading-tight">{shown}</span>;
  const nameColumn = (
    <div className="min-w-0 flex-1">
      {framed ? <h2 className="line-clamp-2 min-w-0 break-words text-[19px] font-extrabold leading-tight">{shown}</h2> : nameText}
      {dueDate && <div className="mt-1.5"><DueTag dueDate={dueDate} today={today} wording={wording} /></div>}
    </div>
  );
  const amount = <span data-party-amount="" className={`shrink-0 whitespace-nowrap font-extrabold leading-tight ${AMOUNT_SIZES[amountSize] ?? AMOUNT_SIZES[24]}`}>{formatGhs(amountPesewas)}</span>;
  const top = onNameClick ? (
    <button type="button" onClick={onNameClick} aria-label={nameLabel} className="flex w-full min-w-0 items-start justify-between gap-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800">
      {nameColumn}{amount}
    </button>
  ) : (
    <div className="flex min-w-0 items-start justify-between gap-3">{nameColumn}{amount}</div>
  );
  const Frame = framed ? "section" : "div";
  return (
    <Frame {...rest} className={`flex min-w-0 flex-col gap-3 ${framed ? "rounded-2xl border-2 border-slate-600 bg-white p-4" : ""}`}>
      {top}
      <div className="flex min-w-0 gap-2">
        <button type="button" aria-label={action.ariaLabel} onClick={action.onClick} className="flex h-[52px] min-w-0 flex-1 items-center justify-center gap-2 rounded-[14px] border-2 border-emerald-950 bg-emerald-900 px-4 text-lg font-extrabold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800">
          {ActionIcon && <ActionIcon size={22} aria-hidden="true" />}{action.label}
        </button>
        {whatsapp?.href && (
          <a href={whatsapp.href} target="_blank" rel="noopener noreferrer" aria-label={whatsapp.label} className={`${SQUARE} border-emerald-900 text-emerald-900`}>
            {whatsapp.icon}
          </a>
        )}
        {callHref && (
          <a href={callHref} aria-label={callLabel} className={`${SQUARE} border-[#0F172A] text-[#0F172A]`}>
            <Phone size={22} aria-hidden="true" />
          </a>
        )}
        {extra}
      </div>
    </Frame>
  );
}
