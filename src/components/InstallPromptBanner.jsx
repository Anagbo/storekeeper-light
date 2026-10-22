import { useEffect, useState } from "react";

function isMobileBrowser() {
  const isMobileDevice = navigator.userAgentData?.mobile ??
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const hasTouchscreen = navigator.maxTouchPoints > 0;
  return isMobileDevice || (hasTouchscreen && window.matchMedia("(max-width: 767px)").matches);
}

function isInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

export default function InstallPromptBanner() {
  const [installPrompt, setInstallPrompt] = useState(null);

  useEffect(() => {
    if (!isMobileBrowser() || isInstalled()) return undefined;

    function handleBeforeInstallPrompt(event) {
      event.preventDefault();
      setInstallPrompt(event);
    }

    function handleInstalled() {
      setInstallPrompt(null);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  async function installApp() {
    if (!installPrompt) return;
    try {
      await installPrompt.prompt();
      await installPrompt.userChoice;
      setInstallPrompt(null);
    } catch (error) {
      console.error("The native app installation prompt could not be opened.", error);
    }
  }

  if (!installPrompt) return null;

  return (
    <aside className="mb-4 flex flex-col items-start justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 sm:flex-row sm:items-center">
      <p className="text-sm font-medium text-emerald-950">
        Install StoreKeeper Light for 1-tap offline market access
      </p>
      <button
        type="button"
        onClick={() => void installApp()}
        className="min-h-12 w-full shrink-0 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 sm:w-auto"
      >
        📲 Install App
      </button>
    </aside>
  );
}
