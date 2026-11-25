import { posText as t } from "./i18n.js";

// rules_global.form_fields (25 Nov 2026): a native date field. Light picker (color-scheme light, set for
// every date field in styles.css), and an empty field shows "Choose a date" instead of the browser's
// blank or mm/dd/yyyy; the hint goes while the field has focus, so typing a date is not covered.
export default function DateField({ value, className = "", ...props }) {
  const empty = !value;
  return (
    <span className="relative block">
      <input type="date" value={value} {...props} data-empty-date={empty ? "" : undefined} className={`peer ${className}${empty ? " text-transparent focus:text-inherit" : ""}`} />
      {empty && (
        <span aria-hidden="true" data-date-placeholder="" className="pointer-events-none absolute inset-y-0 left-0 flex items-center px-3.5 text-lg font-normal text-slate-500 peer-focus:hidden">
          {t("form.chooseDate")}
        </span>
      )}
    </span>
  );
}
