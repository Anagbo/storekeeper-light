export async function requestBackgroundSync() {
  if (!("serviceWorker" in navigator) || !("SyncManager" in window)) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    await registration.sync.register("storekeeper-sync");
  } catch (error) {
    console.warn("Background sync could not be registered.", error);
  }
}
