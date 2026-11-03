import { BarChart3, ClipboardList, Globe2, Home as HomeIcon, Package, Settings, X } from "lucide-react";
import { PosPage } from "./PosComponents.jsx";
import { posText as t } from "./i18n.js";

const menuLinks = [
  { label: "nav.home", detail: "", icon: HomeIcon, route: "Home" },
  { label: "menu.transactions", detail: "menu.transactionsDetail", icon: ClipboardList, route: "TodaysTransactions" },
  { label: "menu.myMoney", detail: "menu.myMoneyDetail", icon: BarChart3, route: "MyMoney" },
  { label: "menu.items", detail: "menu.itemsDetail", icon: Package, route: "MyItems" },
  { label: "menu.language", detail: "menu.languageDetail", icon: Globe2, route: "LanguageSettings" },
  { label: "menu.settings", detail: "", icon: Settings, route: "SettingsProfitTools" }
];

export default function Menu({ onNavigate }) {
  return (
    <PosPage style={{ paddingTop: 14 }} className="flex flex-col gap-3 lg:gap-5">
      <div className="flex items-center justify-between gap-3 lg:col-span-2">
        <h1 className="text-[26px] font-extrabold">{t("app.menu")}</h1>
        <button type="button" onClick={() => onNavigate("Home")} className="flex h-[52px] items-center gap-2 rounded-[14px] border-2 border-slate-900 bg-white px-4 text-lg font-extrabold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800"><X size={20} aria-hidden="true" />{t("menu.close")}</button>
      </div>
      <div className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:gap-4">
        {menuLinks.map(({ label, detail, icon: Icon, route }) => (
          <section key={route} className="rounded-[18px] border-2 border-slate-300 bg-white">
            <button type="button" onClick={() => onNavigate(route)} className="flex min-h-[68px] w-full items-center gap-[14px] rounded-[18px] px-[14px] py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 lg:min-h-24 lg:px-5">
              <Icon size={28} className="shrink-0 text-emerald-900" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-xl font-extrabold">{t(label)}</span>
                {detail && <span className="block text-base text-slate-700">{t(detail)}</span>}
              </span>
              <span className="text-2xl font-extrabold" aria-hidden="true">›</span>
            </button>
          </section>
        ))}
      </div>
    </PosPage>
  );
}
