import React from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import App from "./App.jsx";
import "./styles.css";

if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloadingForUpdate = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController && !reloadingForUpdate) {
        reloadingForUpdate = true;
        window.location.reload();
      }
    });
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        console.error("The offline app shell could not be registered.", error);
      });
    });
  } else {
    navigator.serviceWorker.getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      .then(() => {
        if (navigator.serviceWorker.controller) window.location.reload();
      })
      .catch((error) => {
        console.error("A stale offline app shell could not be removed in development.", error);
      });
  }
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
    {import.meta.env.PROD && <Analytics />}
  </React.StrictMode>
);
