import { formatGhs } from "../lib/money.js";
import { hasPosText, posText as t } from "./i18n.js";
import { displayName } from "../lib/displayName.js";
import { PosPage, PosPrimaryButton } from "./PosComponents.jsx";

const warned = new Set();

// The title never throws: a route with no planned title shows "This screen" and the route
// name goes to the console for developers only. No declared route should reach this screen
// (tests/routeScreens.test.js); it is the safety net for a route that has no built screen.
function plannedTitle(route) {
  const key = `planned.titles.${route}`;
  if (hasPosText(key)) return t(key);
  if (!warned.has(route)) {
    warned.add(route);
    console.warn(`No planned title for route "${route}".`);
  }
  return t("planned.untitled");
}

export default function PlannedScreen({ route, params, onBack, onOpenBackup }) {
  const title = plannedTitle(route);
  return (
    <PosPage className="space-y-4">
      <h1 className="text-2xl font-extrabold">{title}</h1>
      <section className="rounded-2xl border-2 border-amber-800 bg-amber-100 p-4">
        <p className="text-base font-semibold">{t("planned.notReady", { title })}</p>
        {params?.customerName && <p className="mt-3 text-base font-semibold">{t("planned.customer", { name: displayName(params.customerName) })}</p>}
        {params?.amountPesewas > 0 && <p className="mt-3 text-base font-semibold">{t("planned.saleAmount", { amount: formatGhs(params.amountPesewas) })}</p>}
        {route === "SettingsProfitTools" && (
          <PosPrimaryButton type="button" onClick={onOpenBackup} className="mt-4">
            {t("planned.backup")}
          </PosPrimaryButton>
        )}
      </section>
      <button type="button" onClick={onBack} className="min-h-12 rounded-xl border-2 border-slate-800 px-4 text-base font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800">
        {t("planned.back")}
      </button>
    </PosPage>
  );
}