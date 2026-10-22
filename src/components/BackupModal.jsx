import { useEffect, useRef, useState } from "react";
import { Download, Upload, X } from "lucide-react";
import { exportDatabaseToJson, importDatabaseFromJson } from "../utils/backup.js";
import { isAudioFeedbackEnabled, setAudioFeedbackEnabled } from "../utils/audioFeedback.js";

export default function BackupModal({ isOpen, onClose, onRestored }) {
  const fileInput = useRef(null);
  const [busy, setBusy] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(isAudioFeedbackEnabled);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, isOpen, onClose]);

  if (!isOpen) return null;

  async function downloadBackup() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await exportDatabaseToJson();
      setMessage("Backup downloaded. Keep the file somewhere safe.");
    } catch (backupError) {
      console.error("Could not export the local database.", backupError);
      setError("The backup could not be downloaded. Check browser storage and try again.");
    } finally {
      setBusy(false);
    }
  }

  function requestRestore() {
    if (busy) return;
    const confirmed = window.confirm(
      "Restore records from a backup? Records with matching IDs will be updated; other existing records will be kept."
    );
    if (confirmed) fileInput.current?.click();
  }

  async function restoreBackup(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setBusy(true);
    setMessage("");
    setError("");
    try {
      const counts = await importDatabaseFromJson(file);
      setMessage(`Backup restored and merged (${Object.values(counts).reduce((sum, count) => sum + count, 0)} records).`);
      onRestored?.();
    } catch (restoreError) {
      console.error("Could not restore the local database.", restoreError);
      setError(restoreError instanceof TypeError
        ? restoreError.message
        : "The backup could not be restored. Your existing data has not been changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}
    >
      <section role="dialog" aria-modal="true" aria-labelledby="backup-modal-title" className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto overscroll-contain rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-leaf">Keep your records safe</p>
            <h2 id="backup-modal-title" className="mt-1 text-xl font-bold">Backup &amp; restore</h2>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close backup and restore" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-700 transition hover:bg-slate-200 disabled:opacity-50">
            <X size={19} aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-3">
          <button type="button" onClick={() => void downloadBackup()} disabled={busy} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50">
            <Download size={19} aria-hidden="true" />
            {busy ? "Working…" : "📥 Download Backup File"}
          </button>
          <button type="button" onClick={requestRestore} disabled={busy} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50">
            <Upload size={19} aria-hidden="true" />
            📤 Restore from Backup File
          </button>
          <input ref={fileInput} type="file" accept="application/json,.json" onChange={(event) => void restoreBackup(event)} className="hidden" />
        </div>

        <label className="mt-5 flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3">
          <span>
            <span className="block text-sm font-semibold text-slate-800">Sound and voice feedback</span>
            <span className="block text-xs text-slate-500">Play confirmation sounds and spoken messages</span>
          </span>
          <input
            type="checkbox"
            checked={audioEnabled}
            onChange={(event) => {
              const enabled = setAudioFeedbackEnabled(event.target.checked);
              setAudioEnabled(enabled);
            }}
            aria-label="Enable sound and voice feedback"
            className="h-5 w-5 accent-emerald-700"
          />
        </label>

        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          Restore merges the backup into this device: matching records are updated, and other records already here are kept. This works offline.
        </p>
        {message && <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{message}</p>}
        {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </section>
    </div>
  );
}
