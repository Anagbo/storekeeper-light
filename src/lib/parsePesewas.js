// Typed amount text -> whole pesewas, by integer math on the text. No floating point, so
// 1.005 is not read as 100.49999999999999. No imports, like formatGhs.js.
//
// Accepted: digits with an optional "." or "," and more digits ("20", "20.5", "0.01", ".5", "5.").
// Refused (null): anything else, including "1e2", "0x10", signs, spaces inside, and an empty text.
// More than two decimals: the third digit decides. 5 or more rounds the pesewa up, the rest
// is dropped (the same result Math.round gave when floating point was exact).
// Too big to be a safe whole number of pesewas: null.
export function parseAmountToPesewas(value) {
  const text = String(value ?? "").trim().replace(",", ".");
  const match = /^(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match || (!match[1] && !match[2])) return null;
  const wholeText = match[1].replace(/^0+(?=\d)/, "");
  if (wholeText.length > 13) return null; // 13 digits of cedis are still far below 2^53 pesewas
  const decimals = (match[2] ?? "").padEnd(3, "0");
  const pesewas = Number(wholeText || "0") * 100 + Number(decimals.slice(0, 2)) + (decimals[2] >= "5" ? 1 : 0);
  return Number.isSafeInteger(pesewas) ? pesewas : null;
}

// Digits only (a number pad's text) -> a whole number, up to maxDigits digits. Anything else is 0.
export function digitsToWholeNumber(text, maxDigits = 9) {
  return typeof text === "string" && /^\d+$/.test(text) && text.length <= maxDigits ? Number(text) : 0;
}

// Moves the decimal point of a number written as text two places to the left ("250" -> "2.50",
// "2.5" -> "0.025"): pesewas written as text -> cedis written as text, with no division.
export function shiftTextToCedis(text) {
  const match = /^(\d*)(?:\.(\d*))?$/.exec(String(text).trim());
  if (!match || (!match[1] && !match[2])) return "";
  const whole = match[1].replace(/^0+/, "");
  const digits = whole + (match[2] ?? "");
  const pointAt = whole.length - 2;
  const padded = pointAt < 0 ? "0".repeat(-pointAt) + digits : digits;
  const at = Math.max(pointAt, 0);
  return `${padded.slice(0, at) || "0"}.${padded.slice(at)}`;
}

// Whole pesewas -> the text the editor shows ("10.05"), also without floating point.
export function formatPesewasText(pesewas) {
  if (!Number.isSafeInteger(pesewas) || pesewas < 0) return "";
  const remainder = pesewas % 100;
  return `${(pesewas - remainder) / 100}.${String(remainder).padStart(2, "0")}`;
}
