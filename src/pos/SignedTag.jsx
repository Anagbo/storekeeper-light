import { posText as t } from "./i18n.js";

// The signed tag on a credit row, the same pill on 29, 43 and 73 (16 Nov 2026): "Signed ✓" with a green
// border and light green fill, "Not signed" with a grey border and light grey fill. Always words, never
// colour alone; 16px bold.
export default function SignedTag({ signed }) {
  return (
    <span
      data-signed={signed ? "yes" : "no"}
      className={`inline-flex min-h-8 shrink-0 items-center self-start whitespace-nowrap rounded-lg border-2 px-2 text-base font-bold ${signed ? "border-emerald-900 bg-green-100 text-emerald-900" : "border-slate-400 bg-slate-100 text-slate-700"}`}
    >
      {signed ? t("creditRow.signed") : t("creditRow.notSigned")}
    </span>
  );
}
