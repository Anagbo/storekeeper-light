import { useRef, useState } from "react";
import { exportDatabaseToJson, importDatabaseFromJson, validateBackupData } from "../utils/backup.js";
import { posText as t } from "./i18n.js";
import { PosPage, PosPrimaryButton, PosSecondaryButton } from "./PosComponents.jsx";

// Screen 71 (brief 3.13): Backup and restore as a normal screen with Back. Layout only: the backup
// and restore logic is the existing one in utils/backup.js. Restore asks first; a file that cannot
// be used shows one plain message and changes nothing, never the raw error.
const cardClass = "flex flex-col gap-2 rounded-[18px] border-2 border-slate-300 bg-white p-4";

function countRecords(data) {
  return Object.values(data).reduce((sum, records) => sum + (Array.isArray(records) ? records.length : 0), 0);
}

export default function BackupRestore({ onBack }) {
  const fileInput = useRef(null);
  // A ref as well as the state, so a second tap in the same frame sees the first one.
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function reset() {
    setMessage("");
    setError("");
  }

  async function downloadBackup() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    reset();
    try {
      await exportDatabaseToJson();
      setMessage(t("backup.downloaded"));
    } catch (backupError) {
      console.error("Could not export the local database.", backupError);
      setError(t("backup.downloadFailed"));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  // Reading the file only: nothing is changed until Restore is chosen on the question below.
  async function chooseFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busyRef.current) return;
    reset();
    setPending(null);
    try {
      const backup = JSON.parse(await file.text());
      setPending({ file, count: countRecords(validateBackupData(backup)) });
    } catch (readError) {
      console.error("Could not use the chosen backup file.", readError);
      setError(t("backup.badFile"));
    }
  }

  async function restore() {
    if (busyRef.current || !pending) return;
    busyRef.current = true;
    setBusy(true);
    reset();
    try {
      await importDatabaseFromJson(pending.file);
      setPending(null);
      setMessage(t("backup.finished"));
    } catch (restoreError) {
      console.error("Could not restore the local database.", restoreError);
      setPending(null);
      setError(restoreError instanceof TypeError ? t("backup.badFile") : t("backup.restoreFailed"));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <PosPage className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <PosSecondaryButton type="button" onClick={onBack} disabled={busy} className="min-h-12 px-4 text-lg">{t("items.back")}</PosSecondaryButton>
        <h1 className="text-2xl font-extrabold">{t("backup.title")}</h1>
      </div>

      <section aria-labelledby="backup-save-title" className={cardClass}>
        <h2 id="backup-save-title" className="text-lg font-extrabold">{t("backup.saveTitle")}</h2>
        <p className="text-base text-slate-700">{t("backup.saveHelp")}</p>
        <PosPrimaryButton type="button" onClick={() => void downloadBackup()} disabled={busy}>
          {busy ? t("backup.working") : t("backup.download")}
        </PosPrimaryButton>
      </section>

      <section aria-labelledby="backup-restore-title" className={cardClass}>
        <h2 id="backup-restore-title" className="text-lg font-extrabold">{t("backup.restoreTitle")}</h2>
        <p className="text-base text-slate-700">{t("backup.restoreHelp")}</p>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          className="flex min-h-14 w-full items-center justify-center rounded-2xl border-2 border-emerald-900 bg-white px-4 text-lg font-extrabold text-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("backup.choose")}
        </button>
        <input ref={fileInput} type="file" accept="application/json,.json" onChange={(event) => void chooseFile(event)} className="hidden" tabIndex={-1} />
      </section>

      {pending && (
        <section aria-labelledby="backup-confirm-title" className="flex flex-col gap-2 rounded-[18px] border-[3px] border-slate-900 bg-white p-4">
          <h2 id="backup-confirm-title" className="text-xl font-extrabold">{t("backup.confirmTitle")}</h2>
          <p className="text-base font-bold">{pending.count === 1 ? t("backup.foundOne") : t("backup.foundMany", { count: pending.count })}</p>
          <p className="text-base text-slate-800">{t("backup.confirmBody")}</p>
          <div className="grid grid-cols-2 gap-2">
            <PosSecondaryButton type="button" onClick={() => void restore()} disabled={busy} className="min-h-14 border-slate-900 text-lg">{t("backup.restore")}</PosSecondaryButton>
            <PosSecondaryButton type="button" autoFocus onClick={() => setPending(null)} disabled={busy} className="min-h-14 border-slate-900 text-lg">{t("backup.cancel")}</PosSecondaryButton>
          </div>
        </section>
      )}

      {message && <p role="status" className="rounded-xl border-2 border-emerald-900 bg-emerald-50 p-3 text-base font-bold text-emerald-950">{message}</p>}
      {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 text-base font-bold text-rose-950">{error}</p>}
    </PosPage>
  );
}
