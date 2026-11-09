// Number pad logic for 37 and 38 (Batch 15). The value is always a whole number: pesewas
// for money, a plain count for quantities. Nothing here turns text into a decimal.
export const PAD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "Delete"];

// Money: at most 9 digits of pesewas, the same limit as 53.
export const padMoney = { maxValue: 999999999 };
// A count of items: at most 6 digits.
export const padCount = { maxValue: 999999 };

// `fresh` is true until the first key, so the first digit replaces the starting value
// (typing 5 on a preset 1 gives 5, not 15) while Delete edits it.
export function startPad(value = 0) {
  return { value, fresh: true };
}

function appendDigit(value, digit, maxValue) {
  const next = value * 10 + digit;
  return next > maxValue ? null : next;
}

export function pressPad(pad, key, rules = padMoney) {
  const { maxValue } = rules;
  if (key === "Delete") return { value: Math.floor(pad.value / 10), fresh: false };
  const digits = key === "00" ? [0, 0] : /^[0-9]$/.test(key) ? [key.charCodeAt(0) - 48] : null;
  if (!digits) return pad;
  let value = pad.fresh ? 0 : pad.value;
  for (const digit of digits) {
    const next = appendDigit(value, digit, maxValue);
    if (next === null) return pad;
    value = next;
  }
  return { value, fresh: false };
}