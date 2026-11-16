import { useRef } from "react";
import { typeAmountText } from "./amountKeypad.js";

// The one typed amount field (wiring rules_global.amount_entry, 16 Nov 2026), used on the split field
// (16/27), 19 How much each time and Amount paid today, 44, 45, 46 and the balance correction.
// Focus selects the whole amount, so the first digit typed replaces it; typing follows the pad rules
// (typeAmountText: two decimals, one ".", digits only; pasted text still rounds). The text is
// right-aligned; the screen puts the GH₵ label on its left.
//
// onValue(nextText) gets the cleaned text; the field never shows anything else.
export default function AmountTextInput({ value, onValue, onFocus, className = "", ...rest }) {
  // A tap that focuses the field must not drop the selection on mouse up (Safari and some Chrome builds).
  const keepSelection = useRef(false);
  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={text}
      onFocus={(event) => {
        onFocus?.(event);
        if (event.currentTarget.value) {
          event.currentTarget.select();
          keepSelection.current = true;
        }
      }}
      onMouseUp={(event) => {
        if (!keepSelection.current) return;
        keepSelection.current = false;
        event.preventDefault();
      }}
      onChange={(event) => onValue(typeAmountText(event.target.value, text))}
      className={`text-right ${className}`}
    />
  );
}
