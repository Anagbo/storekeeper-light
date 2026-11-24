import { isSaleRecord } from "../utils/financials.js";

// Wiring 33 PROFIT VIEW: profit from the cost saved on each sale line (cost_at_sale_pesewas).
// It counts sale LINES, not quantities: a line with a known cost is counted (N); a line with no
// cost, an "Other amount" line and a keypad-only sale (no item line, counted as one) are not, and
// make up M - N. An unknown cost is never treated as zero. Reversed sales are left out, as in the
// money summary. All amounts are integer pesewas.
function saleLines(sale) {
  try {
    const lines = JSON.parse(sale.items_json || "[]");
    return Array.isArray(lines) ? lines : [];
  } catch {
    return [];
  }
}

function lineProfit(line) {
  const cost = line?.cost_at_sale_pesewas;
  const price = line?.unitPricePesewas;
  const quantity = line?.quantity;
  if (!Number.isSafeInteger(line?.productId) || line.productId <= 0) return null;
  if (!Number.isSafeInteger(cost) || cost < 0) return null;
  if (!Number.isSafeInteger(price) || !Number.isSafeInteger(quantity) || quantity <= 0) return null;
  return (price - cost) * quantity;
}

export function getItemProfit(transactions = []) {
  const reversed = new Set(transactions
    .filter((record) => record?.type === "income_reversal")
    .map((record) => record.reversalOfTransactionId)
    .filter(Boolean));
  let profitPesewas = 0;
  let countedLines = 0;
  let totalLines = 0;
  for (const sale of transactions) {
    if (!isSaleRecord(sale) || reversed.has(sale.id)) continue;
    const lines = saleLines(sale);
    if (!lines.length) {
      totalLines += 1;
      continue;
    }
    for (const line of lines) {
      totalLines += 1;
      const profit = lineProfit(line);
      if (profit === null) continue;
      profitPesewas += profit;
      countedLines += 1;
    }
  }
  if (!Number.isSafeInteger(profitPesewas)) throw new RangeError("The profit total is too large.");
  return { profitPesewas, countedLines, totalLines };
}
