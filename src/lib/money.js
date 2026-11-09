export {
  getDebtBalancePesewas,
  getFinancialDateRange,
  getFinancialSummary,
  getFinancialTransactions,
  getOutstandingDebtPesewas,
  getPreviousFinancialDateRange,
  summarizeFinancialTransactions,
  summarizePosMoney
} from "../utils/financials.js";

// The formatter itself is in formatGhs.js (no imports), so the server can use it too.
export { formatGhs, formatGhsAmount, formatGhsCompactAmount } from "./formatGhs.js";

export function toPesewas(value) {
  const amount = Number(String(value).trim().replace(",", "."));
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}
