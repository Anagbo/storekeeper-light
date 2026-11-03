import { Banknote, BarChart3, Check, Home as HomeIcon, Menu as MenuIcon, ShoppingCart, Smartphone, UsersRound } from "lucide-react";
import { posText as t } from "./i18n.js";

export function PosPage({ children, className = "", style }) {
  return <main style={style} className={`mx-auto min-h-screen w-full max-w-3xl px-4 pb-28 pt-5 sm:px-6 lg:max-w-6xl lg:px-8 lg:pb-10 lg:pt-8 ${className}`}>{children}</main>;
}

export function PosHeader({ shopName, statusLabel, onHome, onMenu, menuActive = false, hideMenu = false }) {
  return (
    <header className="sticky top-0 z-30 border-b-[3px] border-slate-900 bg-white px-4 pt-[max(0.5rem,env(safe-area-inset-top))]">
      <div className="mx-auto flex min-h-16 max-w-6xl items-center gap-3 py-2">
        <button type="button" onClick={onHome} aria-label={t("nav.home")} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-900 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800">
          <HomeIcon size={28} aria-hidden="true" />
        </button>
        <p className="min-w-0 flex-1 truncate text-lg font-extrabold text-slate-900">{shopName}</p>
        <p className="flex shrink-0 items-center gap-1 text-sm font-bold text-emerald-900"><Check size={16} aria-hidden="true" />{statusLabel}</p>
        {!hideMenu && (
          <button type="button" onClick={onMenu} aria-label={menuActive ? t("nav.menuClose") : t("nav.menu")} aria-current={menuActive ? "page" : undefined} className="flex min-h-12 items-center gap-1.5 rounded-[14px] border-2 border-slate-900 px-3 text-base font-extrabold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800">
            <MenuIcon size={26} aria-hidden="true" /> {t("nav.menu")}
          </button>
        )}
      </div>
    </header>
  );
}

export function PosBottomNav({ current, onNavigate }) {
  return (
    <nav aria-label={t("nav.main")} className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t-[3px] border-slate-900 bg-white px-2 pt-1 lg:hidden">
      <div className="mx-auto grid min-h-[76px] max-w-3xl grid-cols-3 items-center">
        <button type="button" onClick={() => onNavigate("Home")} aria-current={current === "Home" ? "page" : undefined} className={`flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-[15px] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 ${current === "Home" ? "text-emerald-900" : "text-slate-800"}`}>
          <HomeIcon size={22} aria-hidden="true" /> {t("nav.home")}
        </button>
        <button type="button" onClick={() => onNavigate("Sell")} aria-label={t("nav.sell")} aria-current={current === "Sell" ? "page" : undefined} className="mx-auto -mt-[30px] grid h-[68px] w-[68px] place-items-center rounded-full border-4 border-white bg-emerald-900 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800">
          <span>
            <ShoppingCart size={30} aria-hidden="true" />
          </span>
        </button>
        <button type="button" onClick={() => onNavigate("PeopleWhoOweYou")} aria-current={current === "PeopleWhoOweYou" ? "page" : undefined} className={`flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-[15px] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 ${current === "PeopleWhoOweYou" ? "text-emerald-900" : "text-slate-800"}`}>
          <UsersRound size={22} aria-hidden="true" /> {t("nav.owed")}
        </button>
      </div>
    </nav>
  );
}

export function PosSideNav({ current, onNavigate }) {
  const links = [
    { route: "Home", label: t("nav.home"), icon: HomeIcon },
    { route: "Sell", label: t("nav.sell"), icon: ShoppingCart },
    { route: "PeopleWhoOweYou", label: t("nav.owed"), icon: UsersRound },
    { route: "MyMoney", label: t("money.title"), icon: BarChart3 }
  ];
  return (
    <nav aria-label={t("nav.main")} className="hidden w-60 shrink-0 border-r-2 border-slate-200 bg-white p-5 lg:block">
      <div className="sticky top-24 space-y-2">
        {links.map(({ route, label, icon: Icon }) => (
          <button key={route} type="button" onClick={() => onNavigate(route)} aria-current={current === route ? "page" : undefined} className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-base font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 ${current === route ? "bg-emerald-100 text-emerald-950" : "text-slate-900 hover:bg-slate-100"}`}>
            <Icon size={21} aria-hidden="true" /> {label}
          </button>
        ))}
      </div>
    </nav>
  );
}

export function PosPrimaryButton({ children, className = "", ...props }) {
  return <button {...props} className={`flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border-2 border-emerald-950 bg-emerald-900 px-4 text-lg font-extrabold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}>{children}</button>;
}

export function PosSecondaryButton({ children, className = "", ...props }) {
  return <button {...props} className={`flex min-h-12 items-center justify-center gap-2 rounded-2xl border-2 border-slate-600 bg-white px-4 text-base font-bold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}>{children}</button>;
}

export function PosCard({ children, className = "" }) {
  return <section className={`rounded-2xl border-2 border-slate-600 bg-white p-4 ${className}`}>{children}</section>;
}

export function CashAndMomoLabel() {
  return (
    <span className="flex min-w-0 items-center justify-center">
      <span className="flex items-center justify-center gap-1.5 whitespace-nowrap text-sm sm:text-base">
        <Banknote size={18} aria-hidden="true" />
        <span>Cash</span>
        <span aria-hidden="true">+</span>
        <Smartphone size={18} aria-hidden="true" />
        <span>MoMo</span>
      </span>
    </span>
  );
}

export function PosStatusTag({ children, tone = "neutral" }) {
  const styles = {
    neutral: "border-slate-700 bg-slate-100 text-slate-950",
    green: "border-emerald-900 bg-emerald-100 text-emerald-950",
    amber: "border-amber-800 bg-amber-100 text-amber-950",
    red: "border-rose-900 bg-rose-100 text-rose-950"
  };
  return <span className={`inline-flex min-h-8 items-center rounded-lg border-2 px-2.5 py-0.5 text-sm font-extrabold ${styles[tone]}`}>{children}</span>;
}
