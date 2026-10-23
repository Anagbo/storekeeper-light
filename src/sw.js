import { NavigationRoute, registerRoute } from "workbox-routing";
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { ExpirationPlugin } from "workbox-expiration";
import { StaleWhileRevalidate } from "workbox-strategies";

const DATABASE_NAME = "StoreKeeperLight";
const TABLES = ["products", "transactions", "debts"];
const SYNC_ENDPOINT = import.meta.env.VITE_SYNC_ENDPOINT?.trim();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html")));
registerRoute(
  ({ request, url }) =>
    ["script", "style", "font"].includes(request.destination) &&
    !url.pathname.startsWith("/_vercel/"),
  new StaleWhileRevalidate({
    cacheName: "storekeeper-runtime-assets",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 30 })
    ]
  })
);

self.addEventListener("install", () => {
  void self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME);
    request.onupgradeneeded = (event) => {
      if (event.oldVersion !== 0) return;
      for (const tableName of TABLES) {
        const store = request.result.createObjectStore(tableName, {
          keyPath: "id",
          autoIncrement: tableName === "products"
        });
        store.createIndex("syncStatus", "syncStatus");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readPending(db) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(TABLES, "readonly");
    const records = {};
    let remaining = TABLES.length;

    for (const tableName of TABLES) {
      const request = transaction.objectStore(tableName).index("syncStatus").getAll("pending");
      request.onsuccess = () => {
        records[tableName] = request.result;
        remaining -= 1;
        if (remaining === 0) resolve(records);
      };
      request.onerror = () => reject(request.error);
    }
    transaction.onerror = () => reject(transaction.error);
  });
}

function getAcknowledgedIds(body) {
  const acknowledged = body?.acknowledged;
  if (!acknowledged || typeof acknowledged !== "object") {
    throw new Error("The sync server response is missing acknowledged record IDs.");
  }

  return Object.fromEntries(TABLES.map((tableName) => {
    const ids = acknowledged[tableName];
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" && typeof id !== "number")) {
      throw new Error(`The sync server response has an invalid ${tableName} acknowledgment list.`);
    }
    return [tableName, new Set(ids)];
  }));
}

function markAcknowledged(db, records, acknowledged) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(TABLES, "readwrite");

    for (const tableName of TABLES) {
      const store = transaction.objectStore(tableName);
      for (const record of records[tableName]) {
        if (!acknowledged[tableName].has(record.id)) continue;
        const request = store.get(record.id);
        request.onsuccess = () => {
          const current = request.result;
          if (current?.syncStatus === "pending" && current.updatedAt === record.updatedAt) {
            store.put({ ...current, syncStatus: "synced", synced: true });
          }
        };
      }
    }

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function syncPendingRecords() {
  if (!SYNC_ENDPOINT) return;

  const db = await openDatabase();
  try {
    const records = await readPending(db);
    if (!TABLES.some((tableName) => records[tableName].length > 0)) return;

    const response = await fetch(SYNC_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schemaVersion: 2, records })
    });
    if (!response.ok) throw new Error(`Sync server returned HTTP ${response.status}.`);

    const acknowledged = getAcknowledgedIds(await response.json());
    await markAcknowledged(db, records, acknowledged);
  } finally {
    db.close();
  }
}

self.addEventListener("sync", (event) => {
  if (event.tag === "storekeeper-sync") event.waitUntil(syncPendingRecords());
});
