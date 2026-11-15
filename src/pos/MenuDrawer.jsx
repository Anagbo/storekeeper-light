import { useEffect, useRef } from "react";
import { BarChart3, Home as HomeIcon, List, Package, Settings, X } from "lucide-react";
import { formatWeekdayDate } from "../lib/formatDate.js";
import { posText as t } from "./i18n.js";

// Wiring 23 (14 Nov 2026): the Menu is a drawer over the current page, never a page of its own.
// Opening it adds nothing to the in-app history and keeps every draft; the page behind is untouched.
// Close (X), a tap on the dimmed page, Escape and the phone's Back close it (PosApp registers Back).
// Choosing a row closes it and goes to that screen; Back from there returns to the page it was opened on.
export const MENU_ROWS = Object.freeze([
  { route: "Home", label: "nav.home", detail: "", icon: HomeIcon },
  { route: "TodaysTransactions", label: "menu.transactions", detail: "menu.transactionsDetail", icon: List },
  { route: "MyMoney", label: "menu.myMoney", detail: "menu.myMoneyDetail", icon: BarChart3 },
  { route: "MyItems", label: "menu.items", detail: "menu.itemsDetail", icon: Package },
  { route: "SettingsProfitTools", label: "menu.settings", detail: "", icon: Settings, divider: true }
]);

// The buttons Tab moves between inside the drawer (the focus stays in it).
function focusables(root) {
  return root ? [...root.querySelectorAll("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])")] : [];
}

export default function MenuDrawer({ current, shopName, onClose, onChoose, now = Date.now() }) {
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Focus moves into the drawer; Escape closes it; Tab and Shift+Tab stay inside it.
  useEffect(() => {
    closeRef.current?.focus?.();
    if (typeof document === "undefined") return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables(panelRef.current);
      if (!items.length) return;
      const first = items[0];
      const last = items.at(-1);
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panelRef.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panelRef.current.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="fixed inset-0 z-40" data-menu-drawer="">
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0" style={{ backgroundColor: "rgba(15, 23, 42, 0.55)" }} />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("app.menu")}
        className="pos-drawer absolute inset-y-0 left-0 flex w-[320px] max-w-[86%] flex-col bg-white text-slate-900"
        style={{ boxShadow: "6px 0 24px rgba(15, 23, 42, 0.35)" }}
      >
        <div className="flex items-center gap-2.5 border-b border-slate-300 py-3.5 pl-4 pr-3 pt-[max(0.875rem,env(safe-area-inset-top))]">
          <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-900 text-white">
            <HomeIcon size={28} strokeWidth={2.2} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[19px] font-extrabold">{shopName}</span>
            <span className="block text-[15px] text-slate-800">{formatWeekdayDate(now)}</span>
          </span>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t("nav.menuClose")} className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] border-2 border-slate-900 bg-white text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800">
            <X size={24} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
        <nav aria-label={t("app.menu")} className="flex-1 overflow-y-auto py-2">
          {MENU_ROWS.map(({ route, label, detail, icon: Icon, divider }) => {
            const active = route === current;
            return (
              <div key={route}>
                {divider && <div aria-hidden="true" className="mx-4 my-2 h-px bg-slate-300" />}
                <button
                  type="button"
                  onClick={() => onChoose(route)}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-[60px] w-full items-center gap-3.5 border-l-[5px] py-2 pl-[11px] pr-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-emerald-800 ${active ? "border-emerald-900 bg-emerald-100 text-emerald-900" : "border-transparent bg-white text-slate-900"}`}
                >
                  <Icon size={26} strokeWidth={2.2} className="shrink-0 text-emerald-900" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[19px] font-extrabold leading-tight">{t(label)}</span>
                    {detail && <span className="mt-px block text-[15px] font-medium text-slate-800">{t(detail)}</span>}
                  </span>
                </button>
              </div>
            );
          })}
        </nav>
      </aside>
    </div>
  );
}
