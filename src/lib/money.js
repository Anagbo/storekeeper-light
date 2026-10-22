const ghanaCedis = new Intl.NumberFormat("en-GH", {
  style: "currency",
  currency: "GHS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

export function formatGhs(pesewas = 0) {
  return ghanaCedis.format((Number(pesewas) || 0) / 100);
}

export function toPesewas(value) {
  const amount = Number(String(value).trim().replace(",", "."));
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}
