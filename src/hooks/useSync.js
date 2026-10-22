import { useCallback, useEffect, useRef, useState } from "react";
import { db } from "../db/db.js";
import { requestBackgroundSync } from "../lib/syncRegistration.js";

const SYNC_ENDPOINT = import.meta.env.VITE_SYNC_ENDPOINT?.trim();
const TABLES = ["products", "transactions", "debts"];

async function readPending() {
  const pending = {};
  for (const tableName of TABLES) {
    pending[tableName] = await db[tableName].where("syncStatus").equals("pending").toArray();
  }
  return pending;
}

function getAcknowledgedIds(body) {
  const acknowledged = body?.acknowledged;
  if (!acknowledged || typeof acknowledged !== "object") {
    throw new Error("The sync server response is missing acknowledged record IDs.");
  }
  return Object.fromEntries(
    TABLES.map((tableName) => {
      const ids = acknowledged[tableName];
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" && typeof id !== "number")) {
        throw new Error(`The sync server response has an invalid ${tableName} acknowledgment list.`);
      }
      return [tableName, new Set(ids)];
    })
  );
}

export function useSync() {
  const [state, setState] = useState({
    status: SYNC_ENDPOINT ? (navigator.onLine ? "idle" : "offline") : "unconfigured",
    lastSyncedAt: null
  });
  const inFlight = useRef(false);

  const syncNow = useCallback(async () => {
    if (!SYNC_ENDPOINT || !navigator.onLine || inFlight.current) return;
    inFlight.current = true;
    setState((current) => ({ ...current, status: "syncing" }));

    try {
      const records = await readPending();
      const hasPending = TABLES.some((tableName) => records[tableName].length > 0);
      if (!hasPending) {
        setState((current) => ({ ...current, status: "idle" }));
        return;
      }

      const response = await fetch(SYNC_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schemaVersion: 2, records })
      });
      if (!response.ok) {
        throw new Error(`Sync server returned HTTP ${response.status}.`);
      }
      const acknowledged = getAcknowledgedIds(await response.json());

      await db.transaction("rw", db.products, db.transactions, db.debts, async () => {
        for (const tableName of TABLES) {
          const table = db[tableName];
          for (const record of records[tableName]) {
            if (!acknowledged[tableName].has(record.id)) continue;
            const current = await table.get(record.id);
            if (current?.syncStatus === "pending" && current.updatedAt === record.updatedAt) {
              await table.update(record.id, { syncStatus: "synced", synced: true });
            }
          }
        }
      });

      const remaining = await readPending();
      const hasRemaining = TABLES.some((tableName) => remaining[tableName].length > 0);
      setState((current) => ({
        ...current,
        status: "idle",
        lastSyncedAt: hasRemaining ? current.lastSyncedAt : new Date()
      }));
    } catch {
      setState((current) => ({
        ...current,
        status: navigator.onLine ? "idle" : "offline"
      }));
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    const onOnline = () => {
      setState((current) => ({ ...current, status: SYNC_ENDPOINT ? "idle" : "unconfigured" }));
      void syncNow();
    };
    const onOffline = () => setState((current) => ({ ...current, status: "offline" }));
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncNow();
    };
    const onWorkerMessage = (event) => {
      if (event.data?.type === "STOREKEEPER_SYNC_REQUESTED") void syncNow();
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    navigator.serviceWorker?.addEventListener("message", onWorkerMessage);
    const intervalId = window.setInterval(() => void syncNow(), 60_000);

    if (navigator.onLine) void syncNow();
    void requestBackgroundSync();

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      navigator.serviceWorker?.removeEventListener("message", onWorkerMessage);
      window.clearInterval(intervalId);
    };
  }, [syncNow]);

  return { ...state, syncNow };
}
