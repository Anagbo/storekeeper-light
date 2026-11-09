import { posText as t } from "./i18n.js";

// D11: "Still saving…" after the save timeout, and the unknown-result message with
// Try again (which repeats the same save, so it reuses the same attempt key).
export default function SaveAttemptNotice({ saveAttempt, onTryAgain, busy = false }) {
  if (saveAttempt.checking) {
    return <p role="status" className="rounded-xl border-2 border-slate-500 bg-slate-100 p-3 text-base font-semibold text-slate-900">{t("save.checking")}</p>;
  }
  if (!saveAttempt.unknown) return null;
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-xl border-2 border-amber-800 bg-amber-50 p-3 text-base font-semibold text-amber-950">
      <p>{t("save.outcomeUnknown")}</p>
      <button type="button" disabled={busy} onClick={onTryAgain} className="min-h-12 rounded-xl border-2 border-amber-900 bg-white px-3 font-extrabold text-amber-950 disabled:opacity-50">
        {t("save.tryAgain")}
      </button>
    </div>
  );
}