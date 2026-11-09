import { Delete } from "lucide-react";
import { PAD_KEYS } from "./amountPad.js";
import { posText as t } from "./i18n.js";

// The number pad of 37 and 38: 1-9, 00, 0, Delete (journey wiring), like the other money screens.
export default function NumberPad({ onKey, disabled = false }) {
  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label={t("pad.label")}>
      {PAD_KEYS.map((key) => key === "Delete" ? (
        <button key={key} type="button" disabled={disabled} aria-label={t("pad.delete")} onClick={() => onKey(key)} className="flex h-[62px] items-center justify-center rounded-2xl bg-slate-300 disabled:opacity-50">
          <Delete size={26} aria-hidden="true" />
        </button>
      ) : (
        <button key={key} type="button" disabled={disabled} onClick={() => onKey(key)} style={{ fontSize: 28, fontWeight: 800 }} className="h-[62px] rounded-2xl border-2 border-slate-500 bg-white disabled:opacity-50">{key}</button>
      ))}
    </div>
  );
}