import { lazy, Suspense } from "react";
import { posText as t } from "./pos/i18n.js";
import "./pos/theme.css";

const PosApp = lazy(() => import("./pos/PosApp.jsx"));

export default function App() {
  return (
    <Suspense fallback={<main role="status" className="p-6 text-base font-semibold">{t("home.loading")}</main>}>
      <PosApp />
    </Suspense>
  );
}