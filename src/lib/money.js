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

const ghanaCedis = new Intl.NumberFormat("en-GH", {
  style: "currency",
  currency: "GHS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
const ghanaCediAmount = new Intl.NumberFormat("en-GH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
const ghanaCediCompactAmount = new Intl.NumberFormat("en-GH", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
});

export function formatGhs(pesewas = 0) {
  return ghanaCedis.format((Number(pesewas) || 0) / 100);
}

export function formatGhsAmount(pesewas = 0) {
  return ghanaCediAmount.format((Number(pesewas) || 0) / 100);
}

export function formatGhsCompactAmount(pesewas = 0) {
  return ghanaCediCompactAmount.format((Number(pesewas) || 0) / 100);
}

export function toPesewas(value) {
  const amount = Number(String(value).trim().replace(",", "."));
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}
