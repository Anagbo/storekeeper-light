// The one money formatter: integer pesewas in, "GH₵268.20" out. It imports nothing, so the
// server (api/) can use it without pulling in the client database.
// src/lib/money.js re-exports these.
//
// The string is built here by hand, never with Intl: Intl.NumberFormat("en-GH", { currency: "GHS" })
// gives "GH₵5.00" only where the browser's ICU data has the en-GH locale. Chrome on Android
// ships trimmed locale data, falls back to "en" and shows "GHS 5.00" (found on a real phone,
// 14 Nov 2026). So the symbol, the comma every three digits and the two decimals are written out.
const SYMBOL = "GH₵";

// Whole pesewas, sign apart. A non-number, NaN or infinity is 0 (as Number(x) || 0 was for NaN);
// a fraction of a pesewa rounds half away from zero, as Intl did; anything that rounds to zero
// has no minus sign.
function splitPesewas(pesewas) {
  const value = Number(pesewas);
  if (!Number.isFinite(value)) return { negative: false, whole: "0", fraction: 0 };
  const magnitude = Math.round(Math.abs(value));
  const cedis = Math.floor(magnitude / 100);
  return {
    negative: value < 0 && magnitude > 0,
    whole: String(cedis).replace(/\B(?=(\d{3})+(?!\d))/g, ","),
    fraction: magnitude % 100
  };
}

function twoDigits(fraction) {
  return String(fraction).padStart(2, "0");
}

// "GH₵1,234.50"; "-GH₵5.00" for a negative amount.
export function formatGhs(pesewas = 0) {
  const { negative, whole, fraction } = splitPesewas(pesewas);
  return `${negative ? "-" : ""}${SYMBOL}${whole}.${twoDigits(fraction)}`;
}

// The same figure without the symbol, for text that writes GH₵ itself: "1,234.50".
export function formatGhsAmount(pesewas = 0) {
  const { negative, whole, fraction } = splitPesewas(pesewas);
  return `${negative ? "-" : ""}${whole}.${twoDigits(fraction)}`;
}

// Without the symbol and without trailing zeros in the decimals: "5", "5.5", "5.05", "1,234".
export function formatGhsCompactAmount(pesewas = 0) {
  const { negative, whole, fraction } = splitPesewas(pesewas);
  const decimals = fraction === 0 ? "" : `.${twoDigits(fraction).replace(/0$/, "")}`;
  return `${negative ? "-" : ""}${whole}${decimals}`;
}
