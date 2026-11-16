import { formatGhs } from "../lib/money.js";
import { correctionReason, rowWhen } from "./historyRows.js";
import { posText as t } from "./i18n.js";

// Wiring 29/43 and 73 "Balance corrected row" (changed 16 Nov 2026, replaces the stacked old → new):
// line 1 the title alone, never wrapped; line 2 "Was GH₵old" on the left (grey, regular weight) and the
// NEW balance on the right (bold, 24px, neutral dark), ending on the same right edge as the amounts of
// the other rows; line 3 the date and the reason entered on 54. An amount never breaks: when both do not
// fit on one line, the new balance moves under "Was …" and stays on the right edge.
// `size` "row" is the 29/43 history list, "card" the 73 card.
const SIZES = {
  row: { title: "text-lg", was: "text-base", when: "text-base text-slate-800" },
  card: { title: "text-[20px]", was: "text-lg", when: "text-lg text-slate-800" }
};

export default function CorrectionLines({ event, size = "row" }) {
  const style = SIZES[size] ?? SIZES.row;
  return (
    <>
      <strong data-correction-title="" className={`block whitespace-nowrap leading-tight ${style.title}`}>{t("record.corrected")}</strong>
      <span data-correction-change="" className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
        <span data-correction-was="" className={`whitespace-nowrap font-normal text-slate-700 ${style.was}`}>{t("record.was", { amount: formatGhs(event.previousBalancePesewas ?? 0) })}</span>
        <strong data-correction-new="" className="ml-auto whitespace-nowrap text-[24px] font-bold leading-tight text-slate-900">{formatGhs(event.newBalancePesewas ?? 0)}</strong>
      </span>
      <span data-correction-when="" className={`block break-words ${style.when}`}>{rowWhen(event)} · {t("record.reason", { reason: correctionReason(event) })}</span>
    </>
  );
}
