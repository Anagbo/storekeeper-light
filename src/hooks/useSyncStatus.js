import { useCallback, useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db.js";

async function countUnsynced(table) {
  return table.where("syncStatus").equals("pending").count();
}

async function readStoragePersistence() {
  if (typeof navigator === "undefined" || !navigator.storage?.persisted) return false;
  return navigator.storage.persisted();
}

export function useSyncStatus() {
  const [isOnline, setIsOnline] = useState(() => (
    typeof navigator === "undefined" ? true : navigator.onLine
  ));
  const [storagePersistent, setStoragePersistent] = useState(false);
  const [storageCheckError, setStorageCheckError] = useState("");

  const counts = useLiveQuery(async () => {
    const [pendingTransactions, pendingDebts, saleCount, installmentSaleCount, installmentAddonCount, debtCount] = await Promise.all([
      countUnsynced(db.transactions),
      countUnsynced(db.debts),
      db.transactions.where("type").equals("sale").count(),
      db.transactions.where("type").equals("installment_sale").count(),
      db.transactions.where("type").equals("installment_addon").count(),
      db.debts.count()
    ]);
    return {
      pendingCount: pendingTransactions + pendingDebts,
      salesCount: saleCount + installmentSaleCount + installmentAddonCount,
      debtCount
    };
  }, [], { pendingCount: null, salesCount: 0, debtCount: 0 });

  useEffect(() => {
    const setOnline = () => setIsOnline(true);
    const setOffline = () => setIsOnline(false);
    window.addEventListener("online", setOnline);
    window.addEventListener("offline", setOffline);
    return () => {
      window.removeEventListener("online", setOnline);
      window.removeEventListener("offline", setOffline);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    readStoragePersistence()
      .then((persistent) => {
        if (!cancelled) {
          setStoragePersistent(persistent);
          setStorageCheckError("");
        }
      })
      .catch((error) => {
        console.error("Could not check persistent storage status.", error);
        if (!cancelled) setStorageCheckError("Storage persistence status could not be checked.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const requestPersistentStorage = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) {
      setStoragePersistent(false);
      return false;
    }
    try {
      const granted = await navigator.storage.persist();
      setStoragePersistent(granted);
      setStorageCheckError("");
      return granted;
    } catch (error) {
      console.error("Could not request persistent storage.", error);
      setStorageCheckError("Persistent storage could not be requested. Try again.");
      throw error;
    }
  }, []);

  return {
    isOnline,
    pendingCount: counts.pendingCount,
    salesCount: counts.salesCount,
    debtCount: counts.debtCount,
    storagePersistent,
    storageCheckError,
    requestPersistentStorage
  };
}
