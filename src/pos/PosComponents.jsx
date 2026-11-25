import { createContext, useContext, useEffect, useState } from "react";
import { Banknote, BarChart3, Plus, Check, Home as HomeIcon, List, Menu as MenuIcon, Package, Settings, ShoppingCart, PanelLeft, Smartphone, Store, UserRound, UsersRound, WifiOff } from "lucide-react";
import { formatWeekdayDate } from "../lib/formatDate.js";
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

// wide: the page is on a wide layout (layout.js, passed down by PosApp): fixed wide padding instead of
// the responsive classes, no room for a bottom bar. Without it (every screen not yet built wide), as before.
const PAGE_BASE = "mx-auto box-border min-w-0 max-w-full flex-[1_0_auto] w-full overflow-x-hidden overflow-y-auto";

// wide_layout.page_types.task_column: on a wide layout every sale, collect, plan, MoMo, supplier,
// spent-money, manual-debt, backup and plan-payment screen is one white panel, 640px wide, centred on
// the grey page, with the phone screen's own components, wording and order inside it (Back at the top
// left, the main button at the bottom). PosApp says which routes are task columns (the layout mode, or
// null); the screens keep calling PosPage and do not read the width.
export const TaskColumnContext = createContext(null);
export const TASK_COLUMN_WIDTH_PX = 640;
// The wider task layout (wide_layout.screens["19 A little at a time"], D10): form and summary side by side.
export const WIDE_TASK_COLUMN_WIDTH_PX = 1040;
export function useTaskColumn() {
  return useContext(TaskColumnContext);
}
// The phone page's own width, margin, padding and overflow classes are the panel's business on wide.
const PHONE_PAGE_BOX = /^(?:[a-z]+:)*!?(?:p[xytrbl]?|m[xy]?|max-w|overflow(?:-[xy])?)-\S+$/;
function TaskColumnPage({ mode, className, style, width = TASK_COLUMN_WIDTH_PX, children }) {
  const kept = className.split(/\s+/).filter((token) => token && !PHONE_PAGE_BOX.test(token)).join(" ");
  return (
    <main data-task-column-page="" className={`${PAGE_BASE} ${mode === "rail" ? "px-5" : "px-8"} pb-10 pt-8`}>
      <div
        data-task-column=""
        style={{ ...style, maxWidth: width, padding: "26px 28px" }}
        className={`mx-auto box-border flex w-full min-w-0 flex-col rounded-[24px] border-2 border-slate-300 bg-white ${kept}`}
      >
        {children}
      </div>
    </main>
  );
}
// rail (with wide): the rail layout (layout.js) takes 20px side padding instead of 32px, so Home's
// five-column table fits at 768px (decided 21 Nov 2026); 1280px and up keep 32px.
// taskWidth: the task column's width on wide (640 unless a screen's wide rule says wider).
export function PosPage({ children, className = "", style, wide = false, rail = false, taskWidth }) {
  const taskColumn = useTaskColumn();
  if (taskColumn && !wide) return <TaskColumnPage mode={taskColumn} className={className} style={style} width={taskWidth}>{children}</TaskColumnPage>;
  // flex 1 0 auto: fills the page area (rules_global.shell_height) and grows past it when longer.
  const spacing = wide ? `${rail ? "px-5" : "px-8"} pb-10 pt-8` : "px-4 pb-28 pt-5 sm:px-6 lg:max-w-6xl lg:px-8 lg:pb-10 lg:pt-8";
  return <main style={style} className={`${PAGE_BASE} ${spacing} ${className}`}>{children}</main>;
}

// Where "Saved ✓" was: the connection status. While a save or sync runs, statusLabel shows instead.
// hideSaved (62) leaves out the word Saved: online shows only the dot; offline keeps its icon and word.
// Wiring 22/23 (14 Nov 2026): the Menu button is at the left (hamburger + Menu, 48px) where the green
// home tile was, then the shop name (cut with an ellipsis), then the connection status. It opens the
// Menu drawer over the page. Phone layout only: on wide screens (layout.js) PosApp shows the sidebar instead.
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
    <nav aria-label={t("nav.main")} className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t-[3px] border-slate-900 bg-white px-2 pt-1">
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

// wide_layout.shell: the sidebar order. Every Menu drawer row (MENU_ROWS, wiring 23) is here, so on
// wide screens the sidebar replaces the header, the bottom bar and the Menu. Settings sits at the bottom.
export const SIDEBAR_ROWS = Object.freeze([
  { route: "Home", label: "nav.home", icon: HomeIcon },
  { route: "Sell", label: "nav.sell", icon: ShoppingCart },
  { route: "PeopleWhoOweYou", label: "nav.owed", icon: UsersRound },
  { route: "TodaysTransactions", label: "menu.transactions", icon: List },
  { route: "MyMoney", label: "menu.myMoney", icon: BarChart3 },
  { route: "MyItems", label: "menu.items", icon: Package },
  { route: "SettingsProfitTools", label: "menu.settings", icon: Settings, bottom: true }
]);

// Labels 18px bold on one line, rows 54px; the rail is icons only with 60px targets and the label as the
// accessible name. The active row has a light green background AND a 2px green outline (never colour alone).
const SIDE_ROW_BASE = "flex shrink-0 items-center rounded-[14px] border-2 text-[18px] font-extrabold leading-tight focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#0F172A]";
const SIDE_ROW_MODES = {
  sidebar: "min-h-[54px] w-full gap-3 whitespace-nowrap px-3.5 text-left",
  rail: "h-[60px] w-[60px] justify-center"
};
const SIDE_ROW_ACTIVE = "border-[#03543F] bg-[#D1FAE5] text-[#03543F]";
const SIDE_ROW_IDLE = "border-transparent bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-100";

function SideRow({ route, label, icon: Icon, mode, active, onNavigate }) {
  const name = t(label);
  return (
    <button
      type="button"
      data-side-row={route}
      onClick={() => onNavigate(route)}
      aria-current={active ? "page" : undefined}
      aria-label={mode === "rail" ? name : undefined}
      title={mode === "rail" ? name : undefined}
      className={`${SIDE_ROW_BASE} ${SIDE_ROW_MODES[mode]} ${active ? SIDE_ROW_ACTIVE : SIDE_ROW_IDLE}`}
    >
      <Icon size={mode === "rail" ? 26 : 24} strokeWidth={2.2} aria-hidden="true" className={`shrink-0 ${active ? "text-[#03543F]" : "text-emerald-900"}`} />
      {mode === "sidebar" && <span className="min-w-0 truncate">{name}</span>}
    </button>
  );
}

// wide_layout.shell: the rail or the sidebar. The mode comes from layout.js through PosApp; this
// component never reads the width. Top: the shop name with today's
// date under it (the rail shows the shop tile; the name and date are its accessible text). Bottom:
// Settings, then the connection status. statusLabel ("Syncing…") shows above the status while it runs.
export function PosSideNav({ mode = "sidebar", current, onNavigate, shopName = "", statusLabel = "", hideSaved = false, now = Date.now(), collapsible = false, collapsed = false, onToggleCollapse }) {
  const rail = mode === "rail";
  const dateText = formatWeekdayDate(now);
  const top = SIDEBAR_ROWS.filter((row) => !row.bottom);
  const bottom = SIDEBAR_ROWS.filter((row) => row.bottom);
  // Sidebar mode only (layout.js decides): a 48px button folds the sidebar into the 84px rail (same rail
  // component and styles) and back. Expanded it ends the brand row; folded it sits under the logo.
  const toggle = collapsible && onToggleCollapse ? (
    <button type="button" data-side-toggle="" onClick={onToggleCollapse} aria-expanded={!collapsed} aria-label={collapsed ? t("nav.expandMenu") : t("nav.collapseMenu")} title={collapsed ? t("nav.expandMenu") : t("nav.collapseMenu")} className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] border-2 border-[#CBD5E1] bg-white text-slate-900 hover:bg-slate-100 focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#0F172A]">
      <PanelLeft size={26} strokeWidth={2.2} aria-hidden="true" />
    </button>
  ) : null;
  return (
    <nav aria-label={t("nav.main")} data-side-nav={mode} className={`flex h-full shrink-0 flex-col overflow-y-auto border-r-2 border-slate-200 bg-white pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] ${rail ? "w-[84px] items-center px-3" : "w-[300px] px-4"}`}>
      <div data-side-brand="" className={`flex items-center gap-3 border-b-2 border-slate-200 pb-3 ${rail ? "justify-center" : "px-1"}`}>
        <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] bg-emerald-900 text-white">
          <Store size={26} strokeWidth={2.2} />
        </span>
        <span className={rail ? "sr-only" : "min-w-0 flex-1"}>
          <span data-side-shop="" className="block truncate text-[19px] font-extrabold text-slate-900">{shopName}</span>
          {!collapsible && <span data-side-date="" className="block whitespace-nowrap text-[15px] font-semibold text-slate-700">{dateText}</span>}
        </span>
        {!rail && toggle}
      </div>
      {rail && toggle && <div className="mt-3 flex justify-center">{toggle}</div>}
      <div className={`${rail && toggle ? "mt-2" : "mt-3"} flex flex-col gap-1.5 ${rail ? "items-center" : ""}`}>
        {top.map((row) => <SideRow key={row.route} {...row} mode={mode} active={current === row.route} onNavigate={onNavigate} />)}
      </div>
      <div className={`mt-auto flex flex-col gap-1.5 pt-4 ${rail ? "items-center" : ""}`}>
        {bottom.map((row) => <SideRow key={row.route} {...row} mode={mode} active={current === row.route} onNavigate={onNavigate} />)}
        {statusLabel && <p role="status" className={`flex items-center gap-1 text-sm font-bold text-emerald-900 ${rail ? "sr-only" : "px-1"}`}><Check size={16} aria-hidden="true" />{statusLabel}</p>}
        <SideConnectionStatus hideSaved={hideSaved} rail={rail} />
      </div>
    </nav>
  );
}

// The bottom of the sidebar on wide screens: the same status, with "Saved on this device" under it.
// 62 (hideSaved) leaves out "Saved on this device": nothing is recorded there yet. The rail shows the
// dot or the crossed Wi-Fi icon only; the words stay as its accessible name.
function SideConnectionStatus({ hideSaved, rail = false }) {
  const online = useOnline();
  return (
    <div role="status" aria-label={online ? t("status.nameOnline") : t("status.nameOffline")} className={`mt-1 flex items-start gap-3 border-t-2 border-slate-200 pt-3 ${rail ? "w-full justify-center" : "px-4"}`}>
      <span className="mt-1.5 grid w-6 shrink-0 place-items-center">{online ? <OnlineDot /> : <OfflineIcon size={rail ? 22 : 16} />}</span>
      <span className={rail ? "sr-only" : "flex flex-col text-[15px]"}>
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
const OTHER_SHAPE = "flex min-h-[52px] items-center justify-center gap-2 rounded-[14px] border-2 bg-white px-4 py-1.5 text-center text-[18px] font-extrabold leading-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:cursor-not-allowed disabled:opacity-50";
export const OTHER_BUTTON_CLASS = `${OTHER_SHAPE} border-[#0F172A] text-[#0F172A]`;
// tone="danger" (rules_global.button_system.danger, 17 Nov 2026): the same shape with a red border and
// red bold text, only for actions that remove or reverse something (Delete on 40, Undo on 28).
const SECONDARY_TONES = { other: OTHER_BUTTON_CLASS, danger: `${OTHER_SHAPE} border-rose-900 text-rose-900` };

export function PosSecondaryButton({ children, tone = "other", className = "", ...props }) {
  return <button data-look={tone === "danger" ? "danger" : "other"} {...props} className={`${SECONDARY_TONES[tone] ?? OTHER_BUTTON_CLASS} ${className}`}>{children}</button>;
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

// pressed (split_payment_look, 21 Nov 2026): a choice tile with a selected state (Split payment on 19)
// stays dashed and gets the green fill of the tiles beside it; aria-pressed is set either way.
export function AddButton({ children, plus = true, size = "standard", role, checked = false, pressed, className = "", ...props }) {
  const radio = role === "radio";
  const layout = radio ? "min-h-[60px] w-full justify-start px-3.5 py-2 text-left" : ADD_SIZES[size];
  const border = radio && checked ? "border-dashed bg-transparent ring-2 ring-emerald-900" : pressed ? "border-dashed bg-green-100" : "border-dashed bg-transparent";
  return (
    <button
      type="button"
      data-look="add"
      {...(radio ? { role: "radio", "aria-checked": checked } : {})}
      {...(pressed !== undefined ? { "aria-pressed": Boolean(pressed) } : {})}
      {...props}
      className={`flex min-w-0 items-center gap-1.5 rounded-[14px] border-2 border-emerald-900 ${border} ${layout} text-[18px] font-extrabold leading-tight text-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {plus && <span aria-hidden="true" className="shrink-0">+</span>}
      {plus && " "}
      {children}
    </button>
  );
}

// The shared payment tile (Sell keypad and Review and pay; rules_global.selected_states, payment tiles).
// Selected: mint #D1FAE5, 2px #03543F border, icon and label #03543F and a 16px tick badge top-right
// (never dropped). Not selected: white, 2px #64748B border, #0F172A label. Disabled: #CBD5E1 border, #94A3B8 label.
// The one selected tick (rules_global.selected_states, ONE TICK MARK): a 16px #03543F filled circle with a
// white tick. Used by the tiles (top-right corner) and the chips (inline before the label).
export function TickBadge({ className = "", ...props }) {
  return <span aria-hidden="true" className={`grid h-4 w-4 shrink-0 place-items-center rounded-full bg-[#03543F] text-white ${className}`} {...props}><Check size={11} strokeWidth={3.5} /></span>;
}

export function PaymentTile({ icon: Icon, label, selected = false, disabled = false, iconSize = 24, className = "", children, ...props }) {
  const look = disabled
    ? "border-[#CBD5E1] bg-white text-[#94A3B8]"
    : selected
      ? "border-[#03543F] bg-[#D1FAE5] text-[#03543F]"
      : "border-[#64748B] bg-white text-[#0F172A]";
  return (
    <button
      type="button"
      data-payment-tile=""
      aria-pressed={selected}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      {...props}
      className={`relative flex min-w-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-[14px] border-2 px-1 text-[15px] font-bold leading-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 disabled:cursor-not-allowed ${look} ${className}`}
    >
      {selected && !disabled && (
        <TickBadge data-tile-tick="" className="absolute right-1 top-1" />
      )}
      {Icon && <Icon size={iconSize} className="shrink-0" aria-hidden="true" />}
      {children ?? <span className="w-full min-w-0 truncate text-center">{label}</span>}
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

// The one selected-state component (rules_global.selected_states). kind="view" switches a view: navy
// #0F172A with white text when selected. kind="choice" sets a value in a form: mint #D1FAE5, 2px #03543F
// border, dark text and a 16px tick on the left (so it is never colour only). Unselected is white with a
// 2px #64748B border. Solid green stays only on the one action of a screen.
export function ChoiceChip({ kind = "choice", selected = false, children, className = "", ...props }) {
  const look = selected
    ? (kind === "view" ? "border-[#0F172A] bg-[#0F172A] text-white" : "border-[#03543F] bg-[#D1FAE5] text-[#0F172A]")
    : "border-[#64748B] bg-white text-[#0F172A]";
  return (
    <button
      type="button"
      data-chip={kind}
      data-selected={selected ? "true" : "false"}
      aria-pressed={selected}
      {...props}
      className={`flex min-h-12 min-w-0 items-center justify-center gap-1 rounded-[14px] border-2 px-1.5 text-center font-extrabold leading-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 ${look} ${className}`}
    >
      {kind === "choice" && selected && (
        <TickBadge data-chip-tick="" />
      )}
      {children}
    </button>
  );
}

export function PosCard({ children, className = "", ...rest }) {
  return <section {...rest} className={`rounded-2xl border-2 border-slate-600 bg-white p-4 ${className}`}>{children}</section>;
}

// The original Cash + MoMo + Owe trio for the Sell keypad Split tile: 20px high, 76px wide.
export function SplitTrio({ className = "" }) {
  return (
    <span data-split-trio="" aria-hidden="true" className={`flex h-5 w-[76px] shrink-0 items-center justify-between ${className}`}>
      <Banknote size={17} className="shrink-0" />
      <Plus size={10} strokeWidth={3.5} className="shrink-0" />
      <Smartphone size={17} className="shrink-0" />
      <Plus size={10} strokeWidth={3.5} className="shrink-0" />
      <UserRound size={17} className="shrink-0" />
    </span>
  );
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

export function PosStatusTag({ children, tone = "neutral", compact = false, large = false }) {
  const styles = {
    neutral: "border-slate-700 bg-slate-100 text-slate-950",
    green: "border-emerald-900 bg-emerald-100 text-emerald-950",
    amber: "border-amber-800 bg-amber-100 text-amber-950",
    red: "border-rose-900 bg-rose-100 text-rose-950"
  };
  return <span className={`inline-flex min-h-8 max-w-full items-center rounded-lg border-2 py-0.5 ${large ? "text-[15px]" : "text-sm"} font-extrabold ${compact ? "px-2" : "px-2.5"} ${styles[tone]}`}>{children}</span>;
}
