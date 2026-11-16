import { Eye, EyeOff } from "lucide-react";
import { formatGhs } from "../lib/money.js";
import { posText as t } from "./i18n.js";

// rules_global.hide_amounts: the one rendering every hidden shop figure on Home (22) and My money (33)
// uses. The text is always the same "GH₵ ••••" whatever the amount, so the length of the number is
// never leaked; screen readers hear "Amount hidden".
export function HiddenAmount() {
  return (
    <span data-hidden-amount="" role="img" aria-label={t("amounts.hidden")} className="inline-block whitespace-nowrap">
      {t("amounts.hiddenText")}
    </span>
  );
}

// A shop figure: the formatted amount, or the hidden form.
export function Amount({ pesewas, hidden }) {
  return hidden ? <HiddenAmount /> : formatGhs(pesewas);
}

// A sentence with amounts in it ("Sales {sales} − stock {stock} …"): the words stay, each amount is
// formatted, or replaced by the hidden form.
export function amountText(key, amounts, hidden) {
  if (!hidden) return t(key, Object.fromEntries(Object.entries(amounts).map(([name, pesewas]) => [name, formatGhs(pesewas)])));
  const template = t(key, Object.fromEntries(Object.keys(amounts).map((name) => [name, `{${name}}`])));
  return template.split(/(\{\w+\})/).filter(Boolean).map((part, index) => (
    /^\{\w+\}$/.test(part) ? <HiddenAmount key={`${part}${index}`} /> : part
  ));
}

// The eye button on the title row of 22 and 33: 48px, icon eye / eye-off, the accessible name says
// what a tap does ("Hide amounts" while shown, "Show amounts" while hidden). No navigation.
export function HideAmountsButton({ hidden, onToggle, className = "" }) {
  const Icon = hidden ? EyeOff : Eye;
  return (
    <button
      type="button"
      data-hide-amounts=""
      onClick={onToggle}
      aria-label={hidden ? t("amounts.show") : t("amounts.hide")}
      className={`grid h-12 w-12 shrink-0 place-items-center rounded-[14px] border-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 ${className}`}
    >
      <Icon size={26} strokeWidth={2.2} aria-hidden="true" />
    </button>
  );
}
