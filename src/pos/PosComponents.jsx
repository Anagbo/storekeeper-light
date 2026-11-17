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
  // flex 1 0 auto: fills the page area (rules_global.shell_height) and grows past it when longer.
  return <main style={style} className={`mx-auto box-border min-w-0 max-w-full flex-[1_0_auto] w-full overflow-x-hidden overflow-y-auto px-4 pb-28 pt-5 sm:px-6 lg:max-w-6xl lg:px-8 lg:pb-10 lg:pt-8 ${className}`}>{children}</main>;
}

// Where "Saved ✓" was: the connection status. While a save or sync runs, statusLabel shows instead.
// hideSaved (62) leaves out the word Saved: online shows only the dot; offline keeps its icon and word.
// Wiring 22/23 (14 Nov 2026): the Menu button is at the left (hamburger + Menu, 48px) where the green
// home tile was, then the shop name (cut with an ellipsis), then the connection status. It opens the
// Menu drawer over the page. It stays at every width until the wide sidebar has every Menu destination.
export function PosHeader({ shopName, statusLabel, hideSaved = false, onHome, onMenu, menuOpen = false, menuButtonRef, hideMenu = false }) {
  const online = useOnline();
  const [explained, setExplained] = useState(false);
  useEffect(() => {
    if (!explained) return undefined;
    const timer = setTimeout(() => setExplained(false), STATUS_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [explained]);
  return (
    <header className="sticky top-0 z-30 flex-none border-b-[3px] border-slate-900 bg-white px-4 pt-[max(0.5rem,env(safe-area-inset-top))]">
      <div className="mx-auto flex min-h-16 min-w-0 max-w-6xl items-center gap-2 py-2">
        {hideMenu && (
          <button type="button" onClick={onHome} aria-label={t("nav.home")} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-900 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800">
            <HomeIcon size={28} aria-hidden="true" />
          </button>
        )}
        {!hideMenu && (
          <button ref={menuButtonRef} type="button" onClick={onMenu} aria-label={t("home.openMenu")} aria-haspopup="dialog" aria-expanded={menuOpen} className="flex h-12 shrink-0 items-center gap-1.5 rounded-[14px] border-2 border-slate-900 bg-white px-3 text-base font-extrabold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800">
            <MenuIcon size={26} strokeWidth={2.2} aria-hidden="true" /> {t("nav.menu")}
          </button>
        )}
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
  return <button data-look="main" {...props} className={`flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border-2 border-emerald-950 bg-emerald-900 px-4 text-lg font-extrabold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}>{children}</button>;
}

// The "other" look (rules_global.button_system.other and .secondary_component): 2px #0F172A border,
// dark bold 18px text, white fill, 52px or taller. A long label wraps (at most two lines; padding, never
// a shorter label, keeps it there).
export const OTHER_BUTTON_CLASS = "flex min-h-[52px] items-center justify-center gap-2 rounded-[14px] border-2 border-[#0F172A] bg-white px-4 py-1.5 text-center text-[18px] font-extrabold leading-tight text-[#0F172A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:cursor-not-allowed disabled:opacity-50";

export function PosSecondaryButton({ children, className = "", ...props }) {
  return <button data-look="other" {...props} className={`${OTHER_BUTTON_CLASS} ${className}`}>{children}</button>;
}

// The "add" look (rules_global.button_system.add): dashed 2px dark-green border, 14px corners, bold
// dark-green "+ Label", no fill. The "+" is shown but hidden from screen readers, so the accessible name
// is the word ("Add items"); plus={false} leaves it out ("Get signature"). Sizes (button_system.sizes):
// "standard" full width and 52px or taller; "compact" 44px, on 15 only; "tile" the 72px grid tile on 20.
// role="radio" (button_system.add_variants) is a choice inside a list (45 "+ New supplier"): same border,
// corners, height and text, left aligned like the rows beside it; when chosen the border turns solid on
// a light green fill, like the other chosen rows.
const ADD_SIZES = {
  standard: "min-h-[52px] w-full justify-center px-4 py-1.5 text-center",
  compact: "h-[44px] w-full justify-center px-4 text-center",
  tile: "min-h-[72px] justify-center px-2 text-center"
};

export function AddButton({ children, plus = true, size = "standard", role, checked = false, className = "", ...props }) {
  const radio = role === "radio";
  const layout = radio ? "min-h-[60px] w-full justify-start px-3.5 py-2 text-left" : ADD_SIZES[size];
  const border = radio && checked ? "border-solid bg-emerald-50" : "border-dashed bg-transparent";
  return (
    <button
      type="button"
      data-look="add"
      {...(radio ? { role: "radio", "aria-checked": checked } : {})}
      {...props}
      className={`flex min-w-0 items-center gap-1.5 rounded-[14px] border-2 border-emerald-900 ${border} ${layout} text-[18px] font-extrabold leading-tight text-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {plus && <span aria-hidden="true" className="shrink-0">+</span>}
      {plus && " "}
      {children}
    </button>
  );
}

// The "leave" look (rules_global.button_system.leave): grey outline (2px #64748B border), #334155 bold
// text, white fill, full width and 52px. Skip for now, Not now: lower priority than the main action but a
// real button.
export function LeaveButton({ children, className = "", ...props }) {
  return <button type="button" data-look="leave" {...props} className={`flex min-h-[52px] w-full items-center justify-center rounded-[14px] border-2 border-[#64748B] bg-white px-4 py-1.5 text-center text-[18px] font-bold leading-tight text-[#334155] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}>{children}</button>;
}

// The one Back button (wiring rules_global.back_button): arrow-left icon (24px, 6px gap) then "Back", bold 800, 18px, 52px tall, 2px #0F172A border.
export function PosBackButton({ className = "", ...props }) {
  return <button type="button" data-look="other" aria-label={t("items.back")} {...props} className={`flex h-[52px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[14px] border-2 border-[#0F172A] bg-white px-4 text-[18px] font-extrabold text-[#0F172A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}><svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M19 12H5M11 5l-7 7 7 7" /></svg>{t("items.back")}</button>;
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
