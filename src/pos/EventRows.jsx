import { needsSignature } from "../config/features.js";
import { formatGhs } from "../lib/money.js";
import { CREDIT_ROW_TYPES, correctionReason, paidPartLines, rowReason, rowTime } from "./historyRows.js";
import { posText as t } from "./i18n.js";
import SignedTag from "./SignedTag.jsx";
import { SOFT_TILE, SOFT_TILE_DIVIDERS } from "./softTile.js";

// Wiring "What happened cards" (final, 16 Nov 2026) on 29, 43 and 73: one card per event. A title row
// (title left, amount right, never wrapped), then label-value rows like the card on 72: the label grey
// and regular on the left (never wraps), the value bold on the right, wrapping inside its own column;
// a thin line between rows. Balance corrected is a dashed card with the title alone on its first line.
//   Paid: Time, Paid with.
//   Took on credit (73) / Added to debt (29, 43): Time, Reason, Signature.
//   Balance corrected: Was, New balance, Time, Reason.

function Card({ kind, dashed = false, rowProps, children }) {
  return (
    <li
      data-record-row={kind}
      {...rowProps}
      className={`flex min-w-0 flex-col gap-1.5 ${SOFT_TILE} px-3.5 py-2.5 ${dashed ? "border-2 border-dashed border-[#CBD5E1]" : ""}`}
    >
      {children}
    </li>
  );
}

function TitleRow({ title, amount, amountClass }) {
  return (
    <div data-event-title-row="" className="flex min-w-0 items-baseline justify-between gap-2">
      <strong data-event-title="" className="min-w-0 break-words text-[20px] leading-tight">{title}</strong>
      <strong data-event-amount="" className={`shrink-0 whitespace-nowrap text-[22px] leading-tight ${amountClass}`}>{amount}</strong>
    </div>
  );
}

// The shared label-value row (wiring "Key-value rows", 16 Nov 2026): used by the What happened cards and by
// the summaries on 29, 43, 54, 56, 64, 68 and 69. Label grey and regular on the left (never wraps), value
// bold on the right (wraps inside its own column), a thin line above each row. `tone="onDark"` is the light-on-dark variant for
// the green card on 56: white text, the line in white at about 35% opacity.
const ROW_TONES = {
  light: { row: "border-slate-300", label: "text-slate-700" },
  onDark: { row: "border-white/35", label: "text-white" }
};

// `valueClass` colours the value (the 16/27 "Received ✓" is green); dark by default.
export function EventDetail({ label, name, valueProps, valueClass = "", tone = "light", children }) {
  const colours = ROW_TONES[tone] ?? ROW_TONES.light;
  return (
    <div data-event-detail={name} className={`grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 border-t ${colours.row} py-1.5 last:pb-0`}>
      <dt className={`whitespace-nowrap font-normal ${colours.label}`}>{label}</dt>
      <dd {...valueProps} className={["min-w-0 text-right font-bold [overflow-wrap:anywhere]", valueClass].filter(Boolean).join(" ")}>{children}</dd>
    </div>
  );
}

// The block that holds the rows (a description list). 18px like the card on 72; `size="base"` is the 16px
// status rows under the chips on 16 and 27.
const ROW_SIZES = { lg: "text-lg", base: "text-base" };
export function KeyValueRows({ name, size = "lg", className = "", children, ...rest }) {
  return <dl {...rest} data-kv-rows={name} className={["flex min-w-0 flex-col", ROW_SIZES[size] ?? ROW_SIZES.lg, className].filter(Boolean).join(" ")}>{children}</dl>;
}

function Details({ children }) {
  return <KeyValueRows data-event-details="" className={SOFT_TILE_DIVIDERS}>{children}</KeyValueRows>;
}

// `signatureAction`: 29/43 "Get signature" (wiring "Signature row and Get signature", 17 Nov 2026): on its
// own line below the last row of the card, never beside the tag; the Signature row shows only the
// status tag, which is never tappable. None on 73.
// The Paid amount has no "+" on any screen (decision (4), 16 Nov 2026: the title says Paid).
export default function EventRows({ event, creditTitle, signatureAction = null }) {
  if (event.type === "payment") {
    return (
      <Card kind="paid">
        <TitleRow title={t("collect.paid")} amount={formatGhs(event.amountPesewas)} amountClass="text-[#0F172A]" />
        <Details>
          <EventDetail label={t("event.time")} name="time" valueProps={{ "data-when": "" }}>{rowTime(event)}</EventDetail>
          {/* rules_global.customer_proof.paid_order: Cash first, then MoMo (paidParts). */}
          <EventDetail label={t("event.paidWith")} name="paid-with">{paidPartLines(event).map((line) => <span key={line} data-paid-line="" className="block whitespace-nowrap">{line}</span>)}</EventDetail>
        </Details>
      </Card>
    );
  }
  if (event.type === "adjustment") {
    const reason = correctionReason(event);
    return (
      <Card kind="corrected" dashed rowProps={{ "data-correction-row": "" }}>
        <strong data-correction-title="" className="block whitespace-nowrap text-[20px] leading-tight">{t("record.corrected")}</strong>
        <Details>
          <EventDetail label={t("event.was")} name="was" valueProps={{ "data-correction-was": "" }}>{formatGhs(event.previousBalancePesewas ?? 0)}</EventDetail>
          <EventDetail label={t("event.newBalance")} name="new-balance" valueProps={{ "data-correction-new": "" }}>{formatGhs(event.newBalancePesewas ?? 0)}</EventDetail>
          <EventDetail label={t("event.time")} name="time" valueProps={{ "data-when": "" }}>{rowTime(event)}</EventDetail>
          <EventDetail label={t("event.reason")} name="reason" valueProps={{ "data-correction-reason": "" }}>{reason || t("creditRow.noReason")}</EventDetail>
        </Details>
      </Card>
    );
  }
  if (CREDIT_ROW_TYPES.has(event.type)) {
    return (
      <Card kind="credit" rowProps={{ "data-credit-row": "" }}>
        <TitleRow title={creditTitle} amount={formatGhs(event.amountPesewas)} amountClass="text-[#0F172A]" />
        <Details>
          <EventDetail label={t("event.time")} name="time" valueProps={{ "data-when": "" }}>{rowTime(event)}</EventDetail>
          <EventDetail label={t("event.reason")} name="reason" valueProps={{ "data-reason": "" }}>{rowReason(event)}</EventDetail>
          {/* rules_global.customer_proof.threshold_scope (17 Nov 2026): the Signature row only when the event
              is signed or its own amount is at or above the threshold; a small unsigned credit has Time and
              Reason only, and no Get signature. */}
          {(event.signed || needsSignature(event.amountPesewas)) && (
            <EventDetail label={t("event.signature")} name="signature">
              <SignedTag signed={event.signed} />
            </EventDetail>
          )}
        </Details>
        {signatureAction && <div data-signature-action="" className="pt-1">{signatureAction}</div>}
      </Card>
    );
  }
  return null;
}
