import { formatGhs } from "../lib/money.js";
import { posText as t } from "./i18n.js";

// 45: the calm message Home shows after stock is saved (never the word "Expense").
// Nothing paid now, part paid now, or all paid now; the amounts come from the saved record.
export function stockSavedNotice({ amountPesewas, paidAmountPesewas = 0 }) {
  const total = formatGhs(amountPesewas);
  const owedPesewas = Math.max(0, amountPesewas - paidAmountPesewas);
  if (owedPesewas === 0) return t("expense.stockSavedPaid", { total });
  if (paidAmountPesewas <= 0) return t("expense.stockSavedOwed", { total, owed: formatGhs(owedPesewas) });
  return t("expense.stockSavedPart", { total, paid: formatGhs(paidAmountPesewas), owed: formatGhs(owedPesewas) });
}

// Spent money (other costs): "Spent GH₵x saved."
export function spentSavedNotice({ amountPesewas }) {
  return t("expense.savedNotice", { amount: formatGhs(amountPesewas) });
}
