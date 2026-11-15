// The one amount keypad (wiring rules_global.amount_entry, decided 15 Nov 2026). Every pad in the app
// uses these keys and this logic through AmountKeypad.jsx; a test fails if a second keypad exists.
//
// The pad keeps the amount as the text the merchant typed ("85", "2.5"), and that text becomes whole
// pesewas through parseAmountToPesewas (integer math on the text, never floating point).
// - Digits fill whole cedis from the left: 8 is GH₵8.00 and 8 5 is GH₵85.00.
// - "." starts pesewas; at most two decimals; a second "." is ignored. "." on an empty pad gives "0.".
// - "00" is ignored on an empty pad and after "."; "0" is ignored on an empty pad, so no leading
//   zero is ever shown.
// - Delete drops the last character; a pad left at "0" (after "0." lost its point) is empty again.
import { formatPesewasText, parseAmountToPesewas } from "../lib/parsePesewas.js";

export const AMOUNT_KEYPAD_DIGIT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
// The last row, four equal keys, the same on every pad.
export const AMOUNT_KEYPAD_LAST_ROW = [".", "0", "00", "Delete"];
export const AMOUNT_KEYPAD_KEYS = [...AMOUNT_KEYPAD_DIGIT_KEYS, ...AMOUNT_KEYPAD_LAST_ROW];

// Money: up to 7 digits of whole cedis (999 999 999 pesewas at most, the limit 53 and 37 always had).
export const MONEY_KEYPAD = { decimals: true, maxWholeDigits: 7 };
// A count (38 How many): whole numbers only, up to 6 digits; the "." key is shown but does nothing.
export const COUNT_KEYPAD = { decimals: false, maxWholeDigits: 6 };

export function pressAmountKey(text, key, rules = MONEY_KEYPAD) {
  const current = typeof text === "string" ? text : "";
  const { decimals = true, maxWholeDigits = 7 } = rules;
  const pointAt = current.indexOf(".");
  const hasPoint = pointAt !== -1;
  if (key === "Delete") {
    const next = current.slice(0, -1);
    return next === "0" ? "" : next;
  }
  if (key === ".") {
    if (!decimals || hasPoint) return current;
    return current === "" ? "0." : `${current}.`;
  }
  if (key === "00") {
    if (current === "" || hasPoint) return current;
    return current.length + 2 > maxWholeDigits ? current : `${current}00`;
  }
  if (!/^[0-9]$/.test(key)) return current;
  if (hasPoint) return current.length - pointAt - 1 >= 2 ? current : `${current}${key}`;
  if (current === "" && key === "0") return current;
  return current.length >= maxWholeDigits ? current : `${current}${key}`;
}

// What a pad shows and saves: whole pesewas (0 for an empty pad).
export function amountTextToPesewas(text) {
  return parseAmountToPesewas(text) ?? 0;
}

// A count pad's text (digits only) -> a whole number, digit by digit (0 for an empty pad).
export function countFromKeypadText(text) {
  if (typeof text !== "string" || !/^\d+$/.test(text)) return 0;
  let count = 0;
  for (const digit of text) count = count * 10 + (digit.charCodeAt(0) - 48);
  return count;
}

// Whole pesewas -> pad text, for a draft or a preset amount: 800 -> "8", 850 -> "8.5", 805 -> "8.05".
// Text only, no division here: formatPesewasText gives "8.50", and trailing zeros are dropped.
export function pesewasToAmountText(pesewas) {
  if (!Number.isSafeInteger(pesewas) || pesewas <= 0) return "";
  return formatPesewasText(pesewas).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

// A typed amount field (44 Spent money, the field on 26) follows the same rules as the pad: the new
// text is replayed key by key, so "," counts as ".", a second "." and a third decimal are ignored, and
// leading zeros go. A currency word or symbol and spaces are dropped (6,50 typed after it is 6.50). Any other
// character (1e2, 0x10, signs) is refused: the field keeps what it had (`current`).
export function normalizeTypedAmount(value, current = "", rules = MONEY_KEYPAD) {
  const cleaned = String(value ?? "").replace(/GH[S₵C]|₵|\s/gi, "").replace(/,/g, ".");
  if (/[^\d.]/.test(cleaned)) return typeof current === "string" ? current : "";
  let text = "";
  for (const character of cleaned) text = pressAmountKey(text, character, rules);
  return text;
}
