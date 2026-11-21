import { formatDate } from "../lib/formatDate.js";
import { formatGhs } from "../lib/formatGhs.js";
import { getPlanPeriodFigures, isValidDateString } from "../utils/installments.js";

// Wiring 28/30/31 "Collection receipt: next payment and due date" (decided 21 Nov 2026). The one line
// under the balance on every receipt that names a balance (collection 28 and 29/43, flag on and off;
// credit sale 31; customer balance):
//   - a payment plan: "Next payment: GH₵x on dd/mm/yyyy", x = Still needed from getPlanPeriodFigures
//     (the plan card and Due now on 25), never more than the balance. GH₵16.00 paid of GH₵20.00 weekly
//     gives GH₵4.00; a fully paid period has moved the date on and shows the full installment.
//   - a one-time debt with a due date and no plan: "Due on dd/mm/yyyy".
//   - nothing owed, no plan and no date, or a date or amount that cannot be read: no line (a receipt
//     is never broken by it).
// `debt` is the debt as it stands now ({ isInstallmentPlan, installmentAmount, nextDueDate,
// installmentPaymentCarryPesewas, dueDate }).
export function receiptDueLines(debt, balancePesewas) {
  if (!debt || !Number.isSafeInteger(balancePesewas) || balancePesewas <= 0) return [];
  if (debt.isInstallmentPlan) {
    const figures = getPlanPeriodFigures(debt);
    if (!figures || !isValidDateString(debt.nextDueDate)) return [];
    const next = Math.min(balancePesewas, figures.stillNeededPesewas);
    return [`Next payment: ${formatGhs(next)} on ${formatDate(debt.nextDueDate)}`];
  }
  if (isValidDateString(debt.dueDate)) return [`Due on ${formatDate(debt.dueDate)}`];
  return [];
}
