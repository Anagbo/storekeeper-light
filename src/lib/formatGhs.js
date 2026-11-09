// The one money formatter: integer pesewas in, "GH₵268.20" out. It imports nothing, so the
// server (api/whatsapp/reminder.js) can use it without pulling in the client database.
// src/lib/money.js re-exports these; the letters GHS appear here only as the currency code.
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