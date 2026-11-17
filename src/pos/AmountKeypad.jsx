import { Delete } from "lucide-react";
import { AMOUNT_KEYPAD_DIGIT_KEYS, AMOUNT_KEYPAD_LAST_ROW } from "./amountKeypad.js";
import { posText as t } from "./i18n.js";

const keyClass = "h-[var(--key-h,62px)] min-w-0 rounded-2xl disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 lg:h-[76px]";
const digitClass = `${keyClass} border-2 border-slate-500 bg-white text-slate-950`;
const deleteClass = `${keyClass} flex items-center justify-center bg-slate-300 text-slate-950`;

// The one amount keypad (wiring rules_global.amount_entry): 1 to 9 in three columns, then one last
// row of four equal keys ". 0 00 Delete" with Delete in grey. Every pad in the app is this component;
// the screens only decide what a key does (pressAmountKey in amountKeypad.js).
// keyHeight: an optional CSS height for the keys below lg (15 passes a clamp that shortens them on short
// screens, never under 48px), through --key-h; without it the keys are 62px, as everywhere else. lg keeps 76px.
export default function AmountKeypad({ onKey, disabled = false, decimalDisabled = false, label = t("pad.label"), keyHeight }) {
  const digitKey = (key, extraDisabled = false) => (
    <button key={key} type="button" disabled={disabled || extraDisabled} onClick={() => onKey(key)} style={{ fontSize: 28, fontWeight: 800 }} className={digitClass}>{key}</button>
  );
  return (
    <div role="group" aria-label={label} data-amount-keypad="" style={keyHeight ? { "--key-h": keyHeight } : undefined} className="flex flex-col gap-2 lg:gap-3">
      <div className="grid grid-cols-3 gap-2 lg:gap-3">
        {AMOUNT_KEYPAD_DIGIT_KEYS.map((key) => digitKey(key))}
      </div>
      <div data-keypad-last-row="" className="grid grid-cols-4 gap-2 lg:gap-3">
        {AMOUNT_KEYPAD_LAST_ROW.map((key) => key === "Delete" ? (
          <button key={key} type="button" disabled={disabled} onClick={() => onKey(key)} aria-label={t("pad.delete")} className={deleteClass}>
            <Delete size={28} aria-hidden="true" />
          </button>
        ) : digitKey(key, key === "." && decimalDisabled))}
      </div>
    </div>
  );
}
