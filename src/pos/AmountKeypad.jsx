import { Delete } from "lucide-react";
import { AMOUNT_KEYPAD_DIGIT_KEYS, AMOUNT_KEYPAD_LAST_ROW } from "./amountKeypad.js";
import { posText as t } from "./i18n.js";

const keyShape = "min-w-0 rounded-2xl disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800";
const keyClass = `h-[var(--key-h,62px)] ${keyShape} lg:h-[76px]`;
// fill (wide 15, D2/D15): the keys share the height the pad is given, never under 56px.
const fillKeyClass = `min-h-14 h-[var(--key-max,100%)] ${keyShape} hover:brightness-95`;
const looks = (base) => ({
  digit: `${base} border-2 border-slate-500 bg-white text-slate-950`,
  delete: `${base} flex items-center justify-center bg-slate-300 text-slate-950`
});
const KEY_LOOKS = looks(keyClass);
const FILL_KEY_LOOKS = looks(fillKeyClass);

// The one amount keypad (wiring rules_global.amount_entry): 1 to 9 in three columns, then one last
// row of four equal keys ". 0 00 Delete" with Delete in grey. Every pad in the app is this component;
// the screens only decide what a key does (pressAmountKey in amountKeypad.js).
// keyHeight: an optional CSS height for the keys below lg (15 passes a clamp that shortens them on short
// screens, never under 48px), through --key-h; without it the keys are 62px, as everywhere else. lg keeps 76px.
export default function AmountKeypad({ onKey, disabled = false, decimalDisabled = false, label = t("pad.label"), keyHeight, fill = false, maxKeyHeight }) {
  const { digit: digitClass, delete: deleteClass } = fill ? FILL_KEY_LOOKS : KEY_LOOKS;
  const digitKey = (key, extraDisabled = false) => (
    <button key={key} type="button" disabled={disabled || extraDisabled} onClick={() => onKey(key)} style={{ fontSize: fill ? 32 : 28, fontWeight: 800 }} className={digitClass}>{key}</button>
  );
  return (
    <div role="group" aria-label={label} data-amount-keypad="" style={{ ...(keyHeight ? { "--key-h": keyHeight } : {}), ...(maxKeyHeight ? { "--key-max": `${maxKeyHeight}px` } : {}) }} className={fill && maxKeyHeight ? "flex flex-col gap-3" : fill ? "flex min-h-0 flex-1 flex-col gap-3" : "flex flex-col gap-2 lg:gap-3"}>
      <div className={fill && maxKeyHeight ? "grid grid-cols-3 gap-3" : fill ? "grid min-h-0 flex-[3_1_0] grid-cols-3 grid-rows-3 gap-3" : "grid grid-cols-3 gap-2 lg:gap-3"}>
        {AMOUNT_KEYPAD_DIGIT_KEYS.map((key) => digitKey(key))}
      </div>
      <div data-keypad-last-row="" className={fill && maxKeyHeight ? "grid grid-cols-4 gap-3" : fill ? "grid min-h-0 flex-[1_1_0] grid-cols-4 gap-3" : "grid grid-cols-4 gap-2 lg:gap-3"}>
        {AMOUNT_KEYPAD_LAST_ROW.map((key) => key === "Delete" ? (
          <button key={key} type="button" disabled={disabled} onClick={() => onKey(key)} aria-label={t("pad.delete")} className={deleteClass}>
            <Delete size={28} aria-hidden="true" />
          </button>
        ) : digitKey(key, key === "." && decimalDisabled))}
      </div>
    </div>
  );
}
