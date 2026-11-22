import { Fragment } from "react";
import { UserRound } from "lucide-react";
import { displayName } from "../lib/displayName.js";
import { formatGhs } from "../lib/money.js";
import { formatTime } from "../lib/formatDate.js";
import { posText as t } from "./i18n.js";
import { PHONE_LAYOUT } from "./layout.js";
import { describeHomeTableRow, describeTransactionRow } from "./transactionFeed.js";

// The one transactions table of wiring 24 wide (D4) and 22 wide Home (D1): Time, What, Money in, Spent,
// On credit. The full page passes totals (a Total today row); Home passes compact (title only in What, a
// grey line for a Balance corrected and a Stock on credit row) and no totals.

// Calmer colours (20 Nov 2026): a person chip is pink only when it says someone owes money; a person who
// only paid (or a chip with only the name) gets a neutral white chip with a 2px grey outline (py-0 keeps
// it the same height as the filled chips). Payment chips are unchanged.
const CHIP_STYLES = {
  payment: "py-0.5 bg-[#CBD5E1] text-[#0F172A]",
  person: "py-0.5 bg-[#FECDD3] text-[#0F172A]",
  personNeutral: "border-2 border-slate-500 bg-white py-0 text-[#0F172A]",
  category: "py-0.5 bg-[#FDE68A] text-[#0F172A]",
  reason: "py-0.5 bg-[#CBD5E1] text-[#0F172A]",
  credit: "py-0.5 bg-rose-100 text-rose-950"
};
const chipStyle = (chip) => (chip.kind === "person" && !chip.owes ? CHIP_STYLES.personNeutral : CHIP_STYLES[chip.kind] ?? CHIP_STYLES.payment);

export function Chip({ chip, nowrap = false }) {
  return (
    <span data-chip={chip.kind} data-owes={chip.kind === "person" ? String(Boolean(chip.owes)) : undefined} className={`inline-flex max-w-full items-center gap-1 rounded-[10px] px-2 text-base font-bold ${nowrap ? "whitespace-nowrap" : "[overflow-wrap:anywhere]"} ${chipStyle(chip)}`}>
      {chip.kind === "person" && <UserRound size={16} aria-hidden="true" className="shrink-0" />}
      {chip.label}
    </span>
  );
}


// The What text wraps between words (never cut with an ellipsis); an amount inside it ("Sale of
// GH₵12,348.00") is one unbreakable piece, so money is never split or cut (audit FAIL 2, 21 Nov 2026).
const AMOUNT_IN_TEXT = /(GH₵[\d,]+\.\d{2})/;
export function WhatText({ text, masked = null }) {
  return String(text).split(AMOUNT_IN_TEXT).map((part, index) => (
    index % 2 === 1 ? <span key={index} data-what-amount="" className="whitespace-nowrap">{masked ?? part}</span> : part
  ));
}


// An empty cell shows a dash (as on 24 wide, D4).
export const DASH = <span className="font-normal text-slate-500">—</span>;

// 24's amount colours and signs (TodaysTransactions AMOUNT_TONES): money in green with +, spent
// amber-brown with −, credit dark red with no sign, a correction plain dark with no sign.
const CELL_TONES = {
  in: { className: "text-[#03543F]", sign: "+" },
  spent: { className: "text-[#92400E]", sign: "−" },
  credit: { className: "text-[#7F1D1D]", sign: "" },
  neutral: { className: "text-slate-800", sign: "" }
};

export function AmountCell({ name, pesewas, tone, amount }) {
  const look = CELL_TONES[tone] ?? CELL_TONES.neutral;
  return (
    <td data-cell={name} data-tone={pesewas > 0 ? tone : undefined} className={`whitespace-nowrap p-2 text-right font-extrabold ${look.className}`}>
      {pesewas > 0 ? <>{look.sign}{amount(pesewas)}</> : DASH}
    </td>
  );
}


// What each wide row shows: Home's cut of the row (Money in, On credit, Spent, same tones) plus the
// Details (payment chips, the spent category, the correction's reason, and for stock bought from a supplier
// the pink "You owe {Supplier} GH₵x" chip) and the Person. Decided 22 Nov 2026: stock bought on credit shows
// its amount only in that chip, so its Spent and On credit cells are dashes (nothing was paid out, nothing was
// given on credit) and every Total today cell equals the sum of the amounts shown above it.
export function describeWideRow(row) {
  const cut = describeHomeTableRow(row);
  const view = describeTransactionRow(row);
  const stockOnCredit = row.kind === "credit";
  const supplierOwed = (row.kind === "credit" || row.kind === "spent") && row.owedPesewas > 0;
  const correction = row.kind === "adjustment";
  const details = view.chips.filter((chip) => chip.kind === "payment" || chip.kind === "category" || chip.kind === "reason" || (supplierOwed && chip.kind === "person" && chip.owes));
  // A balance correction moves no money and gives no credit: the amount it lowered the debt by is a plain grey
  // chip next to the reason chip, and its three amount cells are dashes (22 Nov 2026).
  if (correction) details.push({ kind: "reason", label: t("transactions.row.loweredByChip", { amount: formatGhs(view.amountPesewas) }) });
  return {
    ...cut,
    spentPesewas: stockOnCredit ? 0 : cut.spentPesewas,
    owedPesewas: correction ? 0 : cut.owedPesewas,
    details,
    person: displayName(row.customerName) || displayName(row.supplierName)
  };
}

// The table totals: each column adds the amounts shown in it.
export function sumWideRows(rows) {
  const totals = { moneyIn: 0, spent: 0, onCredit: 0 };
  for (const row of rows) {
    const cut = describeWideRow(row);
    totals.moneyIn += cut.moneyInPesewas;
    totals.spent += cut.spentPesewas;
    totals.onCredit += cut.owedPesewas;
  }
  return totals;
}


// The grey line a compact (Home) row gets: only a Balance corrected row ("Lowered by GH₵x") and a Stock on
// credit row ("You owe {Supplier} GH₵x"). `amount` renders a figure (Home passes its Hide amounts rendering).
function compactLine(row, amount) {
  const withAmount = (text, pesewas) => text.split("{amount}").flatMap((part, index) => (index === 0 ? [part] : [<Fragment key={index}>{amount(pesewas)}</Fragment>, part]));
  if (row.kind === "adjustment") return withAmount(t("transactions.row.loweredByChip", { amount: "{amount}" }), Math.abs(row.adjustmentDeltaPesewas ?? 0));
  if (row.kind === "credit") return withAmount(t("transactions.row.youOweAmount", { name: displayName(row.supplierName) || t("expense.supplier"), amount: "{amount}" }), row.owedPesewas);
  return null;
}

// One structure at every wide width: five fixed columns (Time 72px, three money columns 140px, What takes
// the rest). What holds the title, the person's name (grey) and the chips; chips wrap between chips, never
// inside one. Cell padding is the normal 8px.
export function TransactionTable({ rows, totals = null, amount = formatGhs, compact = false, layout = PHONE_LAYOUT, maskedAmount = null }) {
  // Sidebar layout (1280px and up): a Person column. Rail: the person is a grey line under the title.
  const personColumn = layout.mode === "sidebar";
  const head = "p-2 font-bold";
  return (
    <div className={compact ? "min-w-0" : "min-w-0 rounded-[18px] border-2 border-slate-300 bg-white px-0 py-3"}>
      <table data-wide-table="" data-columns={personColumn ? 6 : 5} className="w-full table-fixed border-collapse text-[17px] tabular-nums [&_td:not(:first-child)]:font-bold">
        <colgroup>
          <col style={{ width: 72 }} />
          <col />
          {personColumn && <col style={{ width: 160 }} />}
          <col style={{ width: 140 }} />
          <col style={{ width: 140 }} />
          <col style={{ width: 140 }} />
        </colgroup>
        <thead>
          <tr className="border-b-2 border-slate-300 text-[17px] text-slate-600">
            <th scope="col" className={`${head} whitespace-nowrap text-left`}>{t("home.tableTime")}</th>
            <th scope="col" className={`${head} text-left`}>{t("home.tableWhat")}</th>
            {personColumn && <th scope="col" className={`${head} text-left`}>{t("transactions.tablePerson")}</th>}
            <th scope="col" className={`${head} whitespace-nowrap text-right`}>{t("home.tableMoneyIn")}</th>
            <th scope="col" className={`${head} whitespace-nowrap text-right`}>{t("home.tableSpent")}</th>
            <th scope="col" className={`${head} whitespace-nowrap text-right`}>{t("transactions.tableOnCredit")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const view = describeWideRow(row);
            return (
              <tr key={row.id} data-wide-row="" {...(compact ? { "data-home-row": "" } : {})} data-row-kind={row.kind} data-row-id={row.id} className="border-b border-slate-200 align-top">
                <td className="whitespace-nowrap p-2 font-normal text-slate-600"><time dateTime={new Date(row.timestamp).toISOString()}>{formatTime(row.timestamp)}</time></td>
                <td data-cell="what" className="min-w-0 p-2 leading-snug">
                  <WhatText text={view.title} masked={maskedAmount} />
                  {compact && compactLine(row, amount) && <span data-cell="what-line2" className="block font-normal text-slate-600">{compactLine(row, amount)}</span>}
                  {!personColumn && !compact && view.person && <span data-cell="person" className="block font-normal text-slate-600 [overflow-wrap:anywhere]">{view.person}</span>}
                  {!compact && view.details.length > 0 && (
                    <span data-cell="chips" className="mt-1 flex flex-wrap gap-1.5">
                      {view.details.map((chip) => <Chip key={`${chip.kind}:${chip.label}`} chip={chip} nowrap />)}
                    </span>
                  )}
                </td>
                {personColumn && <td data-cell="person" className="min-w-0 p-2 font-normal leading-snug text-slate-600">{view.person ? <span className="line-clamp-2 break-normal">{view.person}</span> : DASH}</td>}
                <AmountCell name="money-in" tone="in" pesewas={view.moneyInPesewas} amount={amount} />
                <AmountCell name="spent" tone={view.spentTone} pesewas={view.spentPesewas} amount={amount} />
                <AmountCell name="owed" tone={view.owedTone} pesewas={view.owedPesewas} amount={amount} />
              </tr>
            );
          })}
        </tbody>
        {totals && (
        <tfoot>
          <tr data-wide-total="" className="border-t-2 border-slate-400 font-bold text-[#0F172A]">
            <th scope="row" colSpan={personColumn ? 3 : 2} className="p-2 text-left">{t("transactions.totalToday")}</th>
            <td data-cell="total-money-in" className="whitespace-nowrap p-2 text-right">{formatGhs(totals.moneyIn)}</td>
            <td data-cell="total-spent" className="whitespace-nowrap p-2 text-right">{formatGhs(totals.spent)}</td>
            <td data-cell="total-owed" className="whitespace-nowrap p-2 text-right">{formatGhs(totals.onCredit)}</td>
          </tr>
        </tfoot>
        )}
      </table>
    </div>
  );
}

