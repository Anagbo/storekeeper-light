import { useEffect, useRef, useState } from "react";
import { CreditCard, Database, Home, Smartphone } from "lucide-react";
import { getPreference, setPreference } from "../db/preferences.js";
import { formatDate } from "../lib/formatDate.js";
import { posText as t } from "./i18n.js";
import { getMerchantMomoSettings } from "./momoConfig.js";
import { SHOW_PROFIT_PREFERENCE } from "./myMoneyReport.js";
import { PosPage, PosPrimaryButton, PosBackButton } from "./PosComponents.jsx";
import { useFormErrors } from "./formErrors.js";
import { PaymentSettings } from "./MoMoScreens.jsx";
import { MyPlan } from "./PlanScreens.jsx";
import BackupRestore from "./BackupRestore.jsx";
import { SettingsPane, SettingsPaneContext } from "./SettingsPane.jsx";

function SettingsGroup({ id, title, children }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-1.5 px-1 text-xs font-extrabold uppercase tracking-wider text-slate-700">{title}</h2>
      <div className="divide-y divide-slate-200 overflow-hidden rounded-[18px] border-2 border-slate-300 bg-white">{children}</div>
    </section>
  );
}

// A switch (role "switch") with its label and one helper line. The input is the real control; the
// track and thumb are drawn beside it. wide: the pane's sizes (label 19px, helper 17px, no side padding).
function SwitchRow({ id, label, helper, checked, onChange, wide = false }) {
  return (
    <label htmlFor={id} className={`flex min-h-16 cursor-pointer items-center justify-between gap-3 ${wide ? "py-2" : "px-4 py-3"}`}>
      <span className="min-w-0">
        <span id={`${id}-label`} className={`block font-extrabold ${wide ? "text-[19px]" : "text-lg"}`}>{label}</span>
        <span id={`${id}-help`} className={`block text-slate-700 ${wide ? "text-[17px]" : "text-sm"}`}>{helper}</span>
      </span>
      <span className="relative inline-flex h-8 w-14 shrink-0 items-center">
        <input id={id} type="checkbox" role="switch" aria-checked={checked} aria-labelledby={`${id}-label`} aria-describedby={`${id}-help`} checked={checked} onChange={onChange} className="peer sr-only" />
        <span aria-hidden="true" className="h-8 w-14 rounded-full bg-slate-400 transition-colors peer-checked:bg-emerald-900 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-emerald-800" />
        <span aria-hidden="true" className={`absolute left-1 top-1 h-6 w-6 rounded-full bg-white transition-transform ${checked ? "translate-x-6" : ""}`} />
      </span>
    </label>
  );
}

// A row that opens another screen: a small green icon, the title, an optional line under it, and a chevron.
function LinkRow({ id, icon: Icon, title, detail, tag, onClick }) {
  return (
    <button type="button" onClick={onClick} aria-labelledby={`${id}-title`} aria-describedby={detail ? `${id}-detail` : undefined} className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-emerald-800">
      {Icon && <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-[#03543F]"><Icon size={22} aria-hidden="true" /></span>}
      <span className="min-w-0 flex-1">
        <span id={`${id}-title`} className="block text-lg font-extrabold">{title}</span>
        {detail && <span id={`${id}-detail`} className="block text-sm text-slate-700">{detail}</span>}
      </span>
      {tag}
    </button>
  );
}

// Wide D13: one section row in the list, a 60px+ button with the phone row's icon, the title, its status
// line (one line) and the Active tag on My plan. The selected one is marked (aria-current).
function SectionRow({ id, icon: Icon, title, detail, tag, current, onClick }) {
  return (
    <button
      type="button"
      data-settings-row={id}
      aria-current={current ? "true" : undefined}
      aria-labelledby={`settings-row-${id}-title`}
      aria-describedby={`settings-row-${id}-detail`}
      onClick={onClick}
      className={`flex min-h-[60px] w-full shrink-0 items-center gap-3 rounded-2xl px-3.5 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 ${current ? "border-[3px] border-emerald-900 bg-green-50" : "border-2 border-slate-300 bg-white hover:bg-slate-50"}`}
    >
      <Icon size={24} strokeWidth={2.2} aria-hidden="true" className="shrink-0 text-[#03543F]" />
      <span className="min-w-0 flex-1">
        <span id={`settings-row-${id}-title`} className="block truncate text-[18px] font-bold text-[#0F172A]">{title}</span>
        <span id={`settings-row-${id}-detail`} data-settings-row-detail="" className="block truncate text-[15px] text-slate-700">{detail}</span>
      </span>
      {tag}
    </button>
  );
}

const SECTIONS = ["shop", "momo", "plan", "backup"];

export function SettingsProfitTools({
  shopName,
  savedShopName,
  onShopNameChange,
  onBack,
  onOpenBackup,
  onOpenMomoSettings,
  onOpenPlan,
  onNavigate,
  params = {},
  onUpdateParams,
  layoutMode = "phone",
  subscriptionEnabled = false,
  hasActiveSubscription = false,
  subscriptionExpiry = "",
  trialActive = false,
  trialExpiry = ""
}) {
  const wide = layoutMode !== "phone";
  // The name that was really saved. With none saved it is empty and the field shows My shop as a grey
  // placeholder. A caller that only passes shopName (the name in the header) starts with that name.
  const startingName = savedShopName ?? shopName;
  const [savedName, setSavedName] = useState(startingName);
  // draft_survives_trip_away: an unsaved Shop name is also kept in the route params (shopNameDraft), so
  // 63, 64 or 71 and Back show it again with Save still green. Save, Home or a tab drop it.
  const [draft, setDraft] = useState(params.shopNameDraft ?? startingName);
  const shownStartingName = useRef(startingName);
  // One switch hides the Estimated profit card on My money (33). It is on by default.
  const [showProfit, setShowProfit] = useState(true);
  const [momoSetUp, setMomoSetUp] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  // rules_global.form_errors: shown after Save with an empty name, gone at the first letter.
  const shopNameErrors = useFormErrors([["shopName", draft.trim() ? "" : t("settings.shopNameRequired")]]);

  // A new saved name (from the header, or Save) resets the field; mounting again does not.
  useEffect(() => {
    if (shownStartingName.current === startingName) return;
    shownStartingName.current = startingName;
    setSavedName(startingName);
    setDraft(startingName);
  }, [startingName]);
  useEffect(() => {
    let active = true;
    getPreference(SHOW_PROFIT_PREFERENCE, true)
      .then((value) => { if (active) setShowProfit(value !== false); })
      .catch((loadError) => console.error("Could not load the profit setting.", loadError));
    loadMomoSetUp(() => active);
    return () => { active = false; };
  }, []);
  function loadMomoSetUp(stillActive = () => true) {
    getMerchantMomoSettings()
      .then((settings) => { if (stillActive()) setMomoSetUp(Boolean(settings.number)); })
      .catch((loadError) => console.error("Could not load the MoMo settings.", loadError));
  }

  async function changeShowProfit(checked) {
    setShowProfit(checked);
    setError("");
    try {
      await setPreference(SHOW_PROFIT_PREFERENCE, checked);
    } catch (saveError) {
      console.error("Could not save the profit setting.", saveError);
      setShowProfit(!checked);
      setError(t("settings.saveFailed"));
    }
  }

  function saveShopName(event) {
    event.preventDefault();
    const cleanName = draft.trim();
    setError("");
    if (!shopNameErrors.check()) return;
    try {
      localStorage.setItem("storekeeper-shop-name", cleanName);
      onShopNameChange(cleanName);
      setSavedName(cleanName);
      setDraft(cleanName);
      onUpdateParams?.({ shopNameDraft: undefined });
      setError("");
      setSaved(true);
    } catch (saveError) {
      console.error("Could not save the shop name.", saveError);
      setError(t("settings.saveFailed"));
    }
  }

  const nameChanged = draft.trim() !== "" && draft.trim() !== savedName.trim();
  const planUntil = formatDate(subscriptionExpiry);
  const planDetail = hasActiveSubscription
    ? (planUntil ? t("settings.planActiveUntil", { date: planUntil }) : t("settings.planActiveTag"))
    : trialActive && formatDate(trialExpiry)
      ? t("settings.planTrialUntil", { date: formatDate(trialExpiry) })
      : t("settings.planNotActive");
  function changeDraft(value) {
    setDraft(value);
    onUpdateParams?.({ shopNameDraft: value });
    setSaved(false);
  }

  if (wide) {
    // Wide D13 (wide_layout.screens["47 Settings"]): list with detail on this route. The selected section
    // is this route's own param (settingsSection), changed by replacing the entry, so the drafts kept in
    // the same params (shopNameDraft, momoSettingsDraft) survive switching sections. No Back, no Done.
    const sections = SECTIONS.filter((id) => id !== "plan" || subscriptionEnabled);
    const section = sections.includes(params.settingsSection) ? params.settingsSection : "shop";
    const select = (id) => { if (id !== section) onUpdateParams?.({ settingsSection: id }); };
    const rail = layoutMode === "rail";
    const rows = {
      shop: { icon: Home, title: t("settings.groupShop"), detail: t("settings.shopDetail") },
      momo: { icon: Smartphone, title: t("settings.momoPayments"), detail: momoSetUp ? t("settings.momoSetUp") : t("settings.momoNotSetUp") },
      plan: { icon: CreditCard, title: t("settings.myPlan"), detail: planDetail, tag: hasActiveSubscription && <span className="shrink-0 rounded-lg border-2 border-emerald-900 bg-emerald-100 px-2 text-[15px] font-extrabold text-emerald-950">{t("settings.planActiveTag")}</span> },
      backup: { icon: Database, title: t("settings.backup"), detail: t("settings.backupDetail") }
    };
    const pane = section === "momo" ? (
      <PaymentSettings params={params} onBack={() => {}} onNavigate={onNavigate} onUpdateParams={onUpdateParams} onPaneSaved={() => loadMomoSetUp()} />
    ) : section === "plan" ? (
      <MyPlan expiry={subscriptionExpiry} onNavigate={onNavigate} subscriptionExpiry={subscriptionExpiry} trialActive={trialActive} trialExpiry={trialExpiry} />
    ) : section === "backup" ? (
      <BackupRestore />
    ) : (
      <SettingsPane id="shop" title={t("settings.groupShop")}>
        <form onSubmit={saveShopName} className="flex flex-col gap-1">
          <label htmlFor="settings-shop-name" className="block text-[17px] font-extrabold">{t("settings.shopName")}</label>
          <div className="flex items-center gap-3">
            <input id="settings-shop-name" maxLength={60} value={draft} placeholder={t("app.defaultShopName")} onChange={(event) => changeDraft(event.target.value)} className="h-14 min-w-0 flex-1 rounded-xl border-2 border-slate-500 px-3 text-lg placeholder:text-slate-500" />
            <button
              type="submit"
              disabled={!nameChanged}
              className={`flex min-h-14 min-w-[120px] shrink-0 items-center justify-center rounded-2xl border-2 px-4 text-[18px] font-extrabold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 ${nameChanged ? "border-[#03543F] bg-[#03543F] text-white" : "cursor-not-allowed border-slate-300 bg-slate-200 text-slate-500"}`}
            >
              {t("settings.save")}
            </button>
          </div>
        </form>
        {saved && <p role="status" className="text-[17px] font-bold text-emerald-900">{t("settings.saved")}</p>}
        {(shopNameErrors.message || error) && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 text-[17px] font-semibold text-rose-950">{shopNameErrors.message || error}</p>}
        <div className="border-t-2 border-[#E2E8F0] pt-4">
          <h3 id="settings-preferences" className="text-[15px] font-extrabold uppercase tracking-wider text-slate-700">{t("settings.groupPreferences")}</h3>
          <SwitchRow wide id="settings-profit" label={t("settings.showEstimatedProfit")} helper={t("settings.showProfitHelper")} checked={showProfit} onChange={(event) => void changeShowProfit(event.target.checked)} />
        </div>
      </SettingsPane>
    );
    return (
      <PosPage wide rail={rail} style={{ height: "100dvh" }} className="flex flex-col gap-5">
        <h1 className="text-[30px] font-bold leading-tight text-[#0F172A]">{t("settings.title")}</h1>
        <div data-settings-columns="" className="grid min-h-0 min-w-0 flex-1 gap-6" style={{ gridTemplateColumns: rail ? "280px minmax(0, 1fr)" : "clamp(340px, 36%, 400px) minmax(0, 1fr)" }}>
          <nav data-settings-list="" aria-label={t("settings.title")} className="-m-1 flex min-h-0 min-w-0 flex-col gap-2.5 overflow-y-auto p-1">
            {sections.map((id) => <SectionRow key={id} id={id} {...rows[id]} current={id === section} onClick={() => select(id)} />)}
          </nav>
          <div data-settings-detail="" className="flex min-h-0 min-w-0 flex-col">
            <SettingsPaneContext.Provider value={layoutMode}>{pane}</SettingsPaneContext.Provider>
          </div>
        </div>
      </PosPage>
    );
  }

  return (
    <PosPage className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <PosBackButton onClick={onBack} />
        <h1 className="text-2xl font-extrabold">{t("settings.title")}</h1>
      </div>

      <SettingsGroup id="settings-shop" title={t("settings.groupShop")}>
        <form onSubmit={saveShopName} className="flex items-end gap-2 px-4 py-3">
          <label className="block min-w-0 flex-1">
            <span className="mb-1 block text-base font-extrabold">{t("settings.shopName")}</span>
            <input maxLength={60} value={draft} placeholder={t("app.defaultShopName")} onChange={(event) => { setDraft(event.target.value); onUpdateParams?.({ shopNameDraft: event.target.value }); setSaved(false); }} className="h-12 w-full rounded-xl border-2 border-slate-500 px-3 text-lg placeholder:text-slate-500" />
          </label>
          {/* Grey while there is nothing to save, green (#03543F) with white bold text once the name changes. */}
          <button
            type="submit"
            disabled={!nameChanged}
            className={`flex min-h-12 shrink-0 items-center justify-center rounded-2xl border-2 px-4 text-base font-extrabold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 ${nameChanged ? "border-[#03543F] bg-[#03543F] text-white" : "cursor-not-allowed border-slate-300 bg-slate-200 text-slate-500"}`}
          >
            {t("settings.save")}
          </button>
        </form>
      </SettingsGroup>
      {saved && <p role="status" className="px-1 text-base font-bold text-emerald-900">{t("settings.saved")}</p>}

      <SettingsGroup id="settings-preferences" title={t("settings.groupPreferences")}>
        <SwitchRow id="settings-profit" label={t("settings.showEstimatedProfit")} helper={t("settings.showProfitHelper")} checked={showProfit} onChange={(event) => void changeShowProfit(event.target.checked)} />
      </SettingsGroup>

      <SettingsGroup id="settings-payments" title={t("settings.groupPayments")}>
        {/* 63 must be reachable without the subscription flag: it holds the number customers send to. */}
        <LinkRow id="settings-momo" icon={Smartphone} title={t("settings.momoPayments")} detail={momoSetUp ? t("settings.momoSetUp") : t("settings.momoNotSetUp")} onClick={onOpenMomoSettings} />
        {subscriptionEnabled && (
          <LinkRow
            id="settings-plan"
            icon={CreditCard}
            title={t("settings.myPlan")}
            detail={planDetail}
            tag={hasActiveSubscription ? <span className="shrink-0 rounded-lg border-2 border-emerald-900 bg-emerald-100 px-2 text-sm font-extrabold text-emerald-950">{t("settings.planActiveTag")}</span> : null}
            onClick={onOpenPlan}
          />
        )}
      </SettingsGroup>

      <SettingsGroup id="settings-records" title={t("settings.groupRecords")}>
        <LinkRow id="settings-backup" icon={Database} title={t("settings.backup")} detail={t("settings.backupDetail")} onClick={onOpenBackup} />
      </SettingsGroup>

      {(shopNameErrors.message || error) && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{shopNameErrors.message || error}</p>}
      <PosPrimaryButton type="button" onClick={onBack} className="mt-1">{t("credit.done")}</PosPrimaryButton>
    </PosPage>
  );
}
