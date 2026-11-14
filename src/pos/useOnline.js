import { useEffect, useState } from "react";

// Whether the device is online. navigator.onLine can be wrong in one direction only (it can say
// "online" with no real connection), so this is a hint, never a gate: nothing is blocked by it.
export function readOnline() {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

// Follows navigator.onLine and the window online and offline events, with no reload.
export function useOnline() {
  const [online, setOnline] = useState(readOnline);
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const update = () => setOnline(readOnline());
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    update();
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}
