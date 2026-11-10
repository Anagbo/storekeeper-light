import { useRef, useState } from "react";
import { exportDatabaseToJson, importDatabaseFromJson, validateBackupData } from "../utils/backup.js";
import { posText as t } from "./i18n.js";
import { PosPage, PosSecondaryButton } from "./PosComponents.jsx";

// Screen 71 (brief 3.13): Backup and restore as a normal screen with Back. Layout only: the backup
// and restore logic is the existing one in utils/backup.js. Restore asks first; a file that cannot
// be used shows one plain message and changes nothing, never the raw error.
const cardClass = "flex flex-col gap-[10px] rounded-[18px] border-2 border-[#CBD5E1] bg-white p-4";
const headingClass = "text-[19px] font-bold text-[#0F172A]";
// The two card icons are the prototype's own drawings (26px, 2.2 stroke), green.
function CardIcon({ name, path }) {
  return (
    <svg data-icon={name} width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-[#03543F]">
      <path d={path} />
    </svg>
  );
}
const textClass = "text-base text-[#475569]";
const buttonBase = "flex h-14 w-full items-center justify-center rounded-2xl border-2 px-4 text-[18px]! font-extrabold! focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:cursor-not-allowed disabled:opacity-50";

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
    <PosPage className="flex flex-col gap-[14px]">
      <div className="flex items-center gap-3">
        <PosSecondaryButton type="button" onClick={onBack} disabled={busy} className="min-h-12 px-4 text-lg">{t("items.back")}</PosSecondaryButton>
        <h1 className="text-2xl font-extrabold">{t("backup.title")}</h1>
      </div>
      <p className={textClass}>{t("backup.intro")}</p>

      <section aria-labelledby="backup-save-title" className={cardClass}>
        <div className="flex items-center gap-[10px]">
          <CardIcon name="download" path="M12 3v12m0 0l-4-4m4 4l4-4M4 20h16" />
          <h2 id="backup-save-title" className={headingClass}>{t("backup.saveTitle")}</h2>
        </div>
        <p className={textClass}>{t("backup.saveHelp")}</p>
        <button type="button" onClick={() => void downloadBackup()} disabled={busy} className={`${buttonBase} border-[#03543F] bg-[#03543F] text-white`}>
          {busy ? t("backup.working") : t("backup.download")}
        </button>
      </section>

      <section aria-labelledby="backup-restore-title" className={cardClass}>
        <div className="flex items-center gap-[10px]">
          <CardIcon name="upload" path="M12 21V9m0 0l-4 4m4-4l4 4M4 4h16" />
          <h2 id="backup-restore-title" className={headingClass}>{t("backup.restoreTitle")}</h2>
        </div>
        <p className={textClass}>{t("backup.restoreHelp")}</p>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          className={`${buttonBase} border-[#0F172A] bg-white text-[#0F172A]`}
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
