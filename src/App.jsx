import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Activity, Check, Cloud, CloudOff, Pencil, RefreshCw, Settings, WalletCards, Wifi, WifiOff, X } from "lucide-react";
import { db } from "./db/db.js";
import Dashboard from "./components/Dashboard.jsx";
import BackupModal from "./components/BackupModal.jsx";
import DebtLedger from "./components/DebtLedger.jsx";
import QuickSaleModal from "./components/QuickSaleModal.jsx";
import SubscriptionModal from "./components/SubscriptionModal.jsx";
import { FEATURE_FLAGS, FEATURE_SUBSCRIPTION_LOCKOUT } from "./config/features.js";
import { useSync } from "./hooks/useSync.js";

function getSavedShopName() {
  try {
    return localStorage.getItem("storekeeper-shop-name") || "My shop";
  } catch (error) {
    console.warn("The saved shop name could not be read.", error);
    return "My shop";
  }
}

function SyncStatus({ sync }) {
  const label = {
    unconfigured: "Saved on this device",
    offline: "Offline · saved on this device",
    syncing: "Syncing…",
    idle: sync.lastSyncedAt ? `Synced ${sync.lastSyncedAt.toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit" })}` : "Ready to sync"
  }[sync.status];
  const Icon = sync.status === "syncing" ? RefreshCw : sync.status === "offline" ? CloudOff : Cloud;

  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-500" title={label} aria-live="polite">
      <Icon size={15} className={sync.status === "syncing" ? "animate-spin" : ""} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState("home");
  const [quickEntryOpen, setQuickEntryOpen] = useState(false);
  const [entryType, setEntryType] = useState("sale");
  const [refreshKey, setRefreshKey] = useState(0);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [shopName, setShopName] = useState(getSavedShopName);
  const [editingShopName, setEditingShopName] = useState(false);
  const [shopNameDraft, setShopNameDraft] = useState(shopName);
  const [backupOpen, setBackupOpen] = useState(false);
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const [subscriptionNotice, setSubscriptionNotice] = useState(null);
  const sync = useSync();
  const settings = useLiveQuery(
    () => FEATURE_FLAGS.SHOW_SUBSCRIPTION_FEATURE ? db.settings.toArray() : Promise.resolve([]),
    [FEATURE_FLAGS.SHOW_SUBSCRIPTION_FEATURE],
    []
  );
  const processedPaymentReference = useRef("");
  const subscriptionExpiry = settings.find((setting) => setting.key === "subscriptionExpiry")?.value ?? "";
  const expiryTimestamp = Date.parse(subscriptionExpiry);
  const hasActiveSubscription = Number.isFinite(expiryTimestamp) && expiryTimestamp > Date.now();
  const subscriptionRequired = FEATURE_FLAGS.SHOW_SUBSCRIPTION_FEATURE
    && FEATURE_SUBSCRIPTION_LOCKOUT
    && !hasActiveSubscription;

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    if (!FEATURE_FLAGS.SHOW_SUBSCRIPTION_FEATURE) return;
    const callbackUrl = new URL(window.location.href);
    const reference = callbackUrl.searchParams.get("reference") || callbackUrl.searchParams.get("trxref");
    if (!reference || processedPaymentReference.current === reference) return;
    processedPaymentReference.current = reference;
    callbackUrl.searchParams.delete("reference");
    callbackUrl.searchParams.delete("trxref");
    callbackUrl.searchParams.delete("status");
    window.history.replaceState({}, "", `${callbackUrl.pathname}${callbackUrl.search}${callbackUrl.hash}`);

    async function verifySubscriptionPayment() {
      try {
        const response = await fetch("/api/subscription/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reference }),
          signal: AbortSignal.timeout(20000)
        });
        const result = await response.json();
        if (!response.ok || result.success !== true || result.reference !== reference) {
          throw new Error(result.error || "Payment could not be verified.");
        }
        const expiresAt = new Date(result.expiresAt);
        if (!Number.isFinite(expiresAt.getTime())) throw new Error("The payment verification response had an invalid expiry date.");

        await db.transaction("rw", db.settings, async () => {
          const current = await db.settings.get("subscriptionExpiry");
          const currentTime = Date.parse(current?.value ?? "");
          if (!Number.isFinite(currentTime) || expiresAt.getTime() > currentTime) {
            await db.settings.put({ key: "subscriptionExpiry", value: expiresAt.toISOString() });
          }
          await db.settings.put({ key: "isSubscribed", value: true });
          await db.settings.put({ key: "lastSubscriptionReference", value: reference });
        });
        setSubscriptionNotice({
          type: "success",
          text: `Payment verified. This subscription is active until ${expiresAt.toLocaleDateString("en-GH")}.`
        });
      } catch (verificationError) {
        console.error("Could not verify the Paystack subscription payment.", verificationError);
        setSubscriptionNotice({
          type: "error",
          text: verificationError.message || "Payment verification failed. Please contact support before paying again."
        });
      }
    }
    void verifySubscriptionPayment();
  }, []);

  function closeQuickEntry() {
    setQuickEntryOpen(false);
  }

  function saveShopName(event) {
    event.preventDefault();
    const nextName = shopNameDraft.trim();
    if (!nextName) return;
    setShopName(nextName);
    try {
      localStorage.setItem("storekeeper-shop-name", nextName);
    } catch (error) {
      console.warn("The shop name could not be saved on this device.", error);
    }
    setEditingShopName(false);
  }

  return (
    <div className="min-h-screen bg-cream">
      <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-cream/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur sm:px-6">
        <div className="mx-auto flex min-h-14 max-w-5xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-leaf text-white"><WalletCards size={22} aria-hidden="true" /></span>
            <div className="min-w-0">
              {editingShopName ? (
                <form onSubmit={saveShopName} className="flex items-center gap-1">
                  <input
                    aria-label="Shop name"
                    autoFocus
                    maxLength={60}
                    value={shopNameDraft}
                    onChange={(event) => setShopNameDraft(event.target.value)}
                    className="h-8 w-36 rounded border border-slate-300 bg-white px-2 text-base font-semibold outline-none focus:border-leaf sm:text-sm"
                  />
                  <button type="submit" aria-label="Save shop name" className="grid h-8 w-8 place-items-center rounded text-leaf"><Check size={17} /></button>
                  <button type="button" aria-label="Cancel editing shop name" onClick={() => setEditingShopName(false)} className="grid h-8 w-8 place-items-center rounded text-slate-500"><X size={17} /></button>
                </form>
              ) : (
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setPage("home")} className="max-w-40 truncate text-left font-bold leading-tight">{shopName}</button>
                  <button
                    type="button"
                    aria-label="Edit shop name"
                    onClick={() => { setShopNameDraft(shopName); setEditingShopName(true); }}
                    className="grid min-h-10 min-w-10 shrink-0 place-items-center rounded text-slate-400 hover:text-leaf"
                  >
                    <Pencil size={14} />
                  </button>
                </div>
              )}
              <p className="flex items-center gap-1 text-xs text-slate-500">
                {isOnline ? <Wifi size={12} className="text-leaf" aria-hidden="true" /> : <WifiOff size={12} className="text-amber-700" aria-hidden="true" />}
                {isOnline ? "Online" : "Offline · saved on this device"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden flex-col items-end gap-0.5 sm:flex">
              <span className="text-[11px] font-medium text-slate-500">StoreKeeper Light</span>
              <SyncStatus sync={sync} />
            </div>
            <button
              type="button"
              onClick={() => setBackupOpen(true)}
              aria-label="Open backup and restore settings"
              title="Backup and restore"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700 transition hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-leaf"
            >
              <Settings size={19} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      {page === "home" ? (
        <Dashboard
          refreshKey={refreshKey}
          shopName={shopName}
          onQuickEntry={(type) => { setEntryType(type); setQuickEntryOpen(true); }}
          onViewDebts={() => setPage("debts")}
        />
      ) : (
        <DebtLedger
          shopName={shopName}
          onReturnToDashboard={() => setPage("home")}
          onDataChanged={() => setRefreshKey((current) => current + 1)}
        />
      )}

      <nav aria-label="Main navigation" className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 pt-2 backdrop-blur">
        <div className="mx-auto grid max-w-lg grid-cols-2 gap-2">
          <button type="button" onClick={() => setPage("home")} aria-current={page === "home" ? "page" : undefined} className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl text-xs font-semibold ${page === "home" ? "text-leaf" : "text-slate-500"}`}>
            <Activity size={19} aria-hidden="true" /> Overview
          </button>
          <button type="button" onClick={() => setPage("debts")} aria-current={page === "debts" ? "page" : undefined} className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl text-xs font-semibold ${page === "debts" ? "text-leaf" : "text-slate-500"}`}>
            <WalletCards size={19} aria-hidden="true" /> Debts
          </button>
        </div>
      </nav>

      {quickEntryOpen && (
        <QuickSaleModal
          type={entryType}
          onClose={closeQuickEntry}
          onSaved={() => {
            setRefreshKey((current) => current + 1);
          }}
        />
      )}
      <BackupModal
        isOpen={backupOpen}
        onClose={() => setBackupOpen(false)}
        onManageSubscription={FEATURE_FLAGS.SHOW_SUBSCRIPTION_FEATURE
          ? () => { setBackupOpen(false); setSubscriptionOpen(true); }
          : undefined}
        onRestored={() => setRefreshKey((current) => current + 1)}
        subscriptionExpiry={subscriptionExpiry}
        subscriptionNotice={subscriptionNotice}
      />
      {FEATURE_FLAGS.SHOW_SUBSCRIPTION_FEATURE && (
        <SubscriptionModal
          isOpen={subscriptionOpen || subscriptionRequired}
          lockout={subscriptionRequired}
          isActive={hasActiveSubscription}
          onClose={() => setSubscriptionOpen(false)}
          expiresAt={subscriptionExpiry}
          notice={subscriptionNotice}
        />
      )}
    </div>
  );
}
