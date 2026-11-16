import { formatGhs } from "../lib/money.js";
import { correctionReason, rowWhen } from "./historyRows.js";
import { posText as t } from "./i18n.js";

// Wiring 29/43 and 73 (16 Nov 2026): a Balance corrected row or card. "Balance corrected" on its own
// line, never wrapped; "GH₵old → GH₵new" on the next line, each amount never broken; then the date and
// the reason entered on 54. `size` "row" is the 29/43 history list, "card" the 73 card.
const SIZES = {
  row: { title: "text-lg", change: "text-lg text-slate-800", when: "text-sm text-slate-800" },
  card: { title: "text-[20px]", change: "text-lg", when: "text-lg text-slate-800" }
};

export default function CorrectionLines({ event, size = "row" }) {
  const style = SIZES[size] ?? SIZES.row;
  return (
    <>
      <strong data-correction-title="" className={`block whitespace-nowrap leading-tight ${style.title}`}>{t("record.corrected")}</strong>
      <span data-correction-change="" className={`flex min-w-0 flex-wrap gap-x-1.5 font-extrabold leading-tight ${style.change}`}>
        <span className="whitespace-nowrap">{formatGhs(event.previousBalancePesewas ?? 0)} →</span>{" "}
        <span className="whitespace-nowrap">{formatGhs(event.newBalancePesewas ?? 0)}</span>
      </span>
      <span data-correction-when="" className={`block break-words ${style.when}`}>{rowWhen(event)} · {t("record.reason", { reason: correctionReason(event) })}</span>
    </>
  );
}
