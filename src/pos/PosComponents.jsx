import { useEffect, useState } from "react";
import { Banknote, BarChart3, Check, Home as HomeIcon, Menu as MenuIcon, ShoppingCart, Smartphone, UserRound, UsersRound, WifiOff } from "lucide-react";
import { posText as t } from "./i18n.js";
import { useOnline } from "./useOnline.js";

// rules_global.connection_status: offline is normal for this app, so it is amber-brown, never red.
const ONLINE_GREEN = "#22C55E";
const OFFLINE_BROWN = "#92400E";
const STATUS_MESSAGE_MS = 6000;

function OnlineDot() {
  return <span aria-hidden="true" className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: ONLINE_GREEN, boxShadow: "0 0 0 3px rgba(34, 197, 94, 0.25)" }} />;
}

function OfflineIcon({ size = 16 }) {
  return <WifiOff data-status-icon="wifi-off" size={size} aria-hidden="true" className="shrink-0" style={{ color: OFFLINE_BROWN }} />;
}

export function PosPage({ children, className = "", style }) {
  return <main style={style} className={`mx-auto box-border min-w-0 max-w-full min-h-[calc(100vh-4rem)] w-full overflow-x-hidden overflow-y-auto px-4 pb-28 pt-5 sm:px-6 lg:max-w-6xl lg:px-8 lg:pb-10 lg:pt-8 ${className}`}>{children}</main>;
}

// Where "Saved ✓" was: the connection status. While a save or sync runs, statusLabel shows instead.
// hideSaved (62) leaves out the word Saved: online shows only the dot; offline keeps its icon and word.
export function PosHeader({ shopName, statusLabel, hideSaved = false, onHome, onMenu, menuActive = false, hideMenu = false }) {
  const online = useOnline();
  const [explained, setExplained] = useState(false);
  useEffect(() => {
    if (!explained) return undefined;
    const timer = setTimeout(() => setExplained(false), STATUS_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [explained]);
  return (
    <header className="sticky top-0 z-30 border-b-[3px] border-slate-900 bg-white px-4 pt-[max(0.5rem,env(safe-area-inset-top))]">
      <div className="mx-auto flex min-h-16 min-w-0 max-w-6xl items-center gap-2 py-2">
        <button type="button" onClick={onHome} aria-label={t("nav.home")} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-900 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800">
          <HomeIcon size={28} aria-hidden="true" />
        </button>
        <p className="min-w-0 flex-1 truncate text-lg font-extrabold text-slate-900">{shopName}</p>
        {statusLabel ? (
          <p className="flex shrink-0 items-center gap-1 text-sm font-bold text-emerald-900"><Check size={16} aria-hidden="true" />{statusLabel}</p>
        ) : (
          <button type="button" onClick={() => setExplained((open) => !open)} aria-label={online ? t("status.nameOnline") : t("status.nameOffline")} className="flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800">
            {online ? <OnlineDot /> : <OfflineIcon />}
            {online
              ? (hideSaved ? null : <span className="text-emerald-900">{t("status.savedCheck")}</span>)
              : <span style={{ color: OFFLINE_BROWN }}>{t("status.offlineWord")}</span>}
          </button>
        )}
        {!hideMenu && (
          <button type="button" onClick={onMenu} aria-label={menuActive ? t("nav.menuClose") : t("nav.menu")} aria-current={menuActive ? "page" : undefined} className="flex min-h-12 items-center gap-1.5 rounded-[14px] border-2 border-slate-900 px-3 text-base font-extrabold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800">
            <MenuIcon size={26} aria-hidden="true" /> {t("nav.menu")}
          </button>
        )}
      </div>
      {explained && !statusLabel && (
        <p role="status" className="mx-auto max-w-6xl pb-2 text-sm font-semibold text-slate-800" style={online ? undefined : { color: OFFLINE_BROWN }}>
          {online ? t("status.messageOnline") : t("status.messageOffline")}
        </p>
      )}
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

export function PosSideNav({ current, onNavigate, hideSaved = false }) {
  const links = [
    { route: "Home", label: t("nav.home"), icon: HomeIcon },
    { route: "Sell", label: t("nav.sell"), icon: ShoppingCart },
    { route: "PeopleWhoOweYou", label: t("nav.owed"), icon: UsersRound },
    { route: "MyMoney", label: t("money.title"), icon: BarChart3 }
  ];
  return (
    <nav aria-label={t("nav.main")} className="hidden w-60 shrink-0 border-r-2 border-slate-200 bg-white p-5 lg:flex lg:flex-col">
      <div className="sticky top-24 space-y-2">
        {links.map(({ route, label, icon: Icon }) => (
          <button key={route} type="button" onClick={() => onNavigate(route)} aria-current={current === route ? "page" : undefined} className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-base font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 ${current === route ? "bg-emerald-100 text-emerald-950" : "text-slate-900 hover:bg-slate-100"}`}>
            <Icon size={21} aria-hidden="true" /> {label}
          </button>
        ))}
      </div>
      <SideConnectionStatus hideSaved={hideSaved} />
    </nav>
  );
}

// The bottom of the sidebar on wide screens: the same status, with "Saved on this device" under it.
// 62 (hideSaved) leaves out "Saved on this device": nothing is recorded there yet.
function SideConnectionStatus({ hideSaved }) {
  const online = useOnline();
  return (
    <div role="status" aria-label={online ? t("status.nameOnline") : t("status.nameOffline")} className="sticky bottom-5 mt-auto flex items-start gap-2 border-t-2 border-slate-200 pt-3">
      <span className="mt-1">{online ? <OnlineDot /> : <OfflineIcon />}</span>
      <span className="flex flex-col text-sm">
        <span className="font-bold" style={{ color: online ? "#14532D" : OFFLINE_BROWN }}>{online ? t("status.onlineWord") : t("status.offlineWord")}</span>
        {!hideSaved && <span className="text-slate-700">{t("status.savedOnDevice")}</span>}
      </span>
    </div>
  );
}

export function PosPrimaryButton({ children, className = "", ...props }) {
  return <button {...props} className={`flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border-2 border-emerald-950 bg-emerald-900 px-4 text-lg font-extrabold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}>{children}</button>;
}

export function PosSecondaryButton({ children, className = "", ...props }) {
  return <button {...props} className={`flex min-h-12 items-center justify-center gap-2 rounded-2xl border-2 border-slate-600 bg-white px-4 text-base font-bold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}>{children}</button>;
}

// The one Back button (prototype): "‹ Back", bold 800, 18px, 52px tall, 2px #0F172A border.
export function PosBackButton({ className = "", ...props }) {
  return <button type="button" aria-label={t("items.back")} {...props} className={`flex h-[52px] shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-[14px] border-2 border-[#0F172A] bg-white px-4 text-[18px] font-extrabold text-[#0F172A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}>‹ {t("items.back")}</button>;
}

export function PosCard({ children, className = "", ...rest }) {
  return <section {...rest} className={`rounded-2xl border-2 border-slate-600 bg-white p-4 ${className}`}>{children}</section>;
}

export function SplitIcons({ withOwe = false, size = 20, className = "" }) {
  const isCompact = size <= 14;
  const isMedium = size <= 18;
  const plusSize = isCompact
    ? "text-[9px] font-black leading-none text-slate-800"
    : isMedium
      ? "text-xs font-black leading-none text-slate-800"
      : "text-base font-extrabold leading-none text-slate-950";
  const gapSize = isCompact ? "gap-0.5" : isMedium ? "gap-1" : "gap-1.5";

  return (
    <span className={`inline-flex max-w-full shrink-0 items-center justify-center ${gapSize} ${className}`} aria-hidden="true">
      <Banknote size={size} className="shrink-0" />
      <span className={plusSize}>+</span>
      <Smartphone size={size} className="shrink-0" />
      {withOwe && (
        <>
          <span className={plusSize}>+</span>
          <UserRound size={size} className="shrink-0" />
        </>
      )}
    </span>
  );
}

export function PosStatusTag({ children, tone = "neutral", compact = false }) {
  const styles = {
    neutral: "border-slate-700 bg-slate-100 text-slate-950",
    green: "border-emerald-900 bg-emerald-100 text-emerald-950",
    amber: "border-amber-800 bg-amber-100 text-amber-950",
    red: "border-rose-900 bg-rose-100 text-rose-950"
  };
  return <span className={`inline-flex min-h-8 max-w-full items-center rounded-lg border-2 py-0.5 text-sm font-extrabold ${compact ? "px-2" : "px-2.5"} ${styles[tone]}`}>{children}</span>;
}
