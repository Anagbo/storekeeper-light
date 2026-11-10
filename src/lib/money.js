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

import { parseAmountToPesewas } from "./parsePesewas.js";

// The one place a typed amount (or a price stored as cedis) becomes whole pesewas: integer math on
// the text, never floating point (wiring rules_global "amount_entry"). "1e2", "0x10", signs and
// inner spaces give null. Blank text is 0, as it always was; null and undefined are null.
export function toPesewas(value) {
  if (typeof value === "string" && value.trim() === "") return 0;
  return parseAmountToPesewas(value);
}
