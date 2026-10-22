import { useEffect, useState } from "react";
import { Database, X } from "lucide-react";
import { useSyncStatus } from "../hooks/useSyncStatus.js";

export default function SyncStatusBadge() {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [requestMessage, setRequestMessage] = useState("");
  const status = useSyncStatus();
  const syncConfigured = Boolean(import.meta.env.VITE_SYNC_ENDPOINT?.trim());
  const offline = !status.isOnline;
  const checking = status.pendingCount === null;
  const syncing = syncConfigured && !checking && status.pendingCount > 0;
  const label = checking
    ? "Checking local records…"
    : offline
      ? "📶 Saved on device (Offline)"
      : syncing
        ? `${status.pendingCount} local record${status.pendingCount === 1 ? "" : "s"} awaiting sync`
        : syncConfigured
          ? "🟢 Saved & Synced"
          : "Saved on this device";
  const badgeTone = checking
    ? "border-slate-300 bg-slate-100 text-slate-700"
    : offline
      ? "border-amber-300 bg-amber-100 text-amber-900"
      : syncing
        ? "border-blue-300 bg-blue-100 text-blue-900"
        : "border-emerald-300 bg-emerald-100 text-emerald-900";

  useEffect(() => {
    if (!detailsOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setDetailsOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [detailsOpen]);

  async function requestPersistence() {
    setRequesting(true);
    setRequestMessage("");
    try {
      const granted = await status.requestPersistentStorage();
      setRequestMessage(granted
        ? "Persistent storage enabled for this device."
        : "The browser did not grant persistent storage.");
    } catch {
      setRequestMessage("Persistent storage could not be requested. Try again.");
    } finally {
      setRequesting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setDetailsOpen(true)}
        aria-haspopup="dialog"
        className={`max-w-full shrink-0 truncate rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-tight transition focus:outline-none focus:ring-2 focus:ring-leaf focus:ring-offset-1 ${badgeTone}`}
      >
        {label}
      </button>
      {detailsOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/40 p-0 sm:items-start sm:justify-end sm:p-4"
          onMouseDown={(event) => event.target === event.currentTarget && setDetailsOpen(false)}
        >
          <section role="dialog" aria-modal="true" aria-labelledby="sync-details-title" className="safe-bottom max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto overscroll-contain rounded-t-3xl bg-white p-5 shadow-xl sm:mt-14 sm:rounded-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Database size={19} className="text-leaf" aria-hidden="true" />
                <h2 id="sync-details-title" className="font-bold">Device storage</h2>
              </div>
              <button type="button" onClick={() => setDetailsOpen(false)} aria-label="Close storage details" className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200">
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <p className="text-sm text-slate-600">Your records are stored locally in this device’s database.</p>
            <dl className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-50 p-3">
                <dt className="text-xs text-slate-500">Sales stored</dt>
                <dd className="mt-1 text-lg font-bold text-slate-900">{status.salesCount}</dd>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <dt className="text-xs text-slate-500">Debt records stored</dt>
                <dd className="mt-1 text-lg font-bold text-slate-900">{status.debtCount}</dd>
              </div>
            </dl>
            <p className={`mt-3 text-sm ${status.storagePersistent ? "text-emerald-800" : "text-amber-800"}`}>
              {status.storagePersistent
                ? "Persistent storage is enabled."
                : "Browser storage may be cleared automatically."}
            </p>
            {status.storageCheckError && <p role="alert" className="mt-2 text-sm text-red-700">{status.storageCheckError}</p>}
            {!status.storagePersistent && (
              <button
                type="button"
                disabled={requesting}
                onClick={() => void requestPersistence()}
                className="mt-4 min-h-12 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
              >
                {requesting ? "Requesting…" : "🔒 Request Persistent Storage"}
              </button>
            )}
            {requestMessage && <p role="status" className="mt-3 text-sm text-slate-700">{requestMessage}</p>}
          </section>
        </div>
      )}
    </>
  );
}
