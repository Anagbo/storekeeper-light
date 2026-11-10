import { Search } from "lucide-react";
import { posText as t } from "./i18n.js";

// The "Search name or phone" field of 17 (Who owes you?) and 32 (People who owe you). One
// component, so both screens look and read the same. The caller owns the text and the filtering.
export default function SearchField({ value, onChange }) {
  return (
    <label className="flex min-h-14 items-center gap-2 rounded-2xl border-[3px] border-slate-500 px-3">
      <Search size={24} aria-hidden="true" />
      <span className="sr-only">{t("credit.search")}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("credit.search")}
        className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none"
      />
    </label>
  );
}