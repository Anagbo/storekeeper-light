import { useEffect, useState } from "react";
import { Check, Globe2 } from "lucide-react";
import { getPreference, setPreference } from "../db/preferences.js";
import { formatDate } from "../lib/formatDate.js";
import { isAudioFeedbackEnabled, setAudioFeedbackEnabled } from "../utils/audioFeedback.js";
import { posText as t } from "./i18n.js";
import { getMerchantMomoSettings } from "./momoConfig.js";
import { SHOW_PROFIT_PREFERENCE } from "./myMoneyReport.js";
import { PosPage, PosPrimaryButton, PosSecondaryButton } from "./PosComponents.jsx";

const VOICE_LANGUAGES = [
  { value: "en-GB", label: "English (UK)" },
  { value: "en-GH", label: "English (Ghana)" },
  { value: "en-US", label: "English (US)" }
];

export function LanguageSettings({ onBack }) {
  const [voiceLanguage, setVoiceLanguage] = useState("en-GB");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    getPreference("voiceInputLanguage", "en-GB")
      .then((value) => {
        if (active && VOICE_LANGUAGES.some((language) => language.value === value)) setVoiceLanguage(value);
      })
      .catch((loadError) => {
        console.error("Could not load language preferences.", loadError);
        if (active) setError(t("language.loadFailed"));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function saveLanguage(value) {
    setVoiceLanguage(value);
    setError("");
    setSaved(false);
    try {
      await setPreference("voiceInputLanguage", value);
      setSaved(true);
    } catch (saveError) {
      console.error("Could not save the voice input language.", saveError);
      setError(t("language.saveFailed"));
    }
  }

  return (
    <PosPage className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <PosSecondaryButton type="button" onClick={onBack}>{t("items.back")}</PosSecondaryButton>
        <h1 className="text-2xl font-extrabold">{t("language.title")}</h1>
      </div>
      <section className="rounded-2xl border-2 border-slate-500 p-4">
        <h2 className="font-extrabold">{t("language.appLanguage")}</h2>
        <p className="mt-1 text-slate-700">{t("language.englishOnly")}</p>
        <p className="mt-2 font-bold">{t("language.english")}</p>
      </section>
      <label className="block rounded-2xl border-2 border-slate-500 p-4">
        <span className="mb-1 flex items-center gap-2 font-extrabold"><Globe2 size={20} aria-hidden="true" />{t("language.voiceLanguage")}</span>
        <select disabled={loading} value={voiceLanguage} onChange={(event) => void saveLanguage(event.target.value)} className="min-h-12 w-full rounded-xl border-2 border-slate-500 bg-white px-3 font-semibold">
          {VOICE_LANGUAGES.map((language) => <option key={language.value} value={language.value}>{language.label}</option>)}
        </select>
      </label>
      {saved && <p role="status" className="flex items-center gap-2 text-emerald-900"><Check size={18} aria-hidden="true" />{t("language.saved")}</p>}
      {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
      <PosPrimaryButton type="button" onClick={onBack} className="mt-auto">{t("credit.done")}</PosPrimaryButton>
    </PosPage>
  );
}

function SettingsGroup({ id, title, children }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-1.5 px-1 text-xs font-extrabold uppercase tracking-wider text-slate-700">{title}</h2>
      <div className="divide-y divide-slate-200 overflow-hidden rounded-[18px] border-2 border-slate-300 bg-white">{children}</div>
    </section>
  );
}

// A switch (role "switch") with its label and one helper line. The input is the real control; the
// track and thumb are drawn beside it.
function SwitchRow({ id, label, helper, checked, onChange }) {
  return (
    <label htmlFor={id} className="flex min-h-16 cursor-pointer items-center justify-between gap-3 px-4 py-3">
      <span className="min-w-0">
        <span id={`${id}-label`} className="block text-lg font-extrabold">{label}</span>
        <span id={`${id}-help`} className="block text-sm text-slate-700">{helper}</span>
      </span>
      <span className="relative inline-flex h-8 w-14 shrink-0 items-center">
        <input id={id} type="checkbox" role="switch" aria-checked={checked} aria-labelledby={`${id}-label`} aria-describedby={`${id}-help`} checked={checked} onChange={onChange} className="peer sr-only" />
        <span aria-hidden="true" className="h-8 w-14 rounded-full bg-slate-400 transition-colors peer-checked:bg-emerald-900 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-emerald-800" />
        <span aria-hidden="true" className={`absolute left-1 top-1 h-6 w-6 rounded-full bg-white transition-transform ${checked ? "translate-x-6" : ""}`} />
      </span>
    </label>
  );
}

// A row that opens another screen: the title, an optional line under it, and a chevron.
function LinkRow({ id, title, detail, tag, onClick }) {
  return (
    <button type="button" onClick={onClick} aria-labelledby={`${id}-title`} aria-describedby={detail ? `${id}-detail` : undefined} className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-emerald-800">
      <span className="min-w-0 flex-1">
        <span id={`${id}-title`} className="block text-lg font-extrabold">{title}</span>
        {detail && <span id={`${id}-detail`} className="block text-sm text-slate-700">{detail}</span>}
      </span>
      {tag}
      <span aria-hidden="true" className="text-2xl font-extrabold text-slate-700">›</span>
    </button>
  );
}

export function SettingsProfitTools({
  shopName,
  onShopNameChange,
  onBack,
  onOpenBackup,
  onOpenMomoSettings,
  onOpenPlan,
  subscriptionEnabled = false,
  hasActiveSubscription = false,
  subscriptionExpiry = "",
  trialActive = false,
  trialExpiry = ""
}) {
  const [draft, setDraft] = useState(shopName);
  const [audioEnabled, setAudioEnabled] = useState(isAudioFeedbackEnabled);
  // One switch hides the Estimated profit card on My money (33). It is on by default.
  const [showProfit, setShowProfit] = useState(true);
  const [momoSetUp, setMomoSetUp] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => setDraft(shopName), [shopName]);
  useEffect(() => {
    let active = true;
    getPreference(SHOW_PROFIT_PREFERENCE, true)
      .then((value) => { if (active) setShowProfit(value !== false); })
      .catch((loadError) => console.error("Could not load the profit setting.", loadError));
    getMerchantMomoSettings()
      .then((settings) => { if (active) setMomoSetUp(Boolean(settings.number)); })
      .catch((loadError) => console.error("Could not load the MoMo settings.", loadError));
    return () => { active = false; };
  }, []);

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
    if (!cleanName) {
      setError(t("settings.shopNameRequired"));
      return;
    }
    try {
      localStorage.setItem("storekeeper-shop-name", cleanName);
      onShopNameChange(cleanName);
      setError("");
      setSaved(true);
    } catch (saveError) {
      console.error("Could not save the shop name.", saveError);
      setError(t("settings.saveFailed"));
    }
  }

  const nameChanged = draft.trim() !== "" && draft.trim() !== shopName;
  const planUntil = formatDate(subscriptionExpiry);
  const planDetail = hasActiveSubscription
    ? (planUntil ? t("settings.planActiveUntil", { date: planUntil }) : t("settings.planActiveTag"))
    : trialActive && formatDate(trialExpiry)
      ? t("settings.planTrialUntil", { date: formatDate(trialExpiry) })
      : t("settings.planNotActive");

  return (
    <PosPage className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <PosSecondaryButton type="button" onClick={onBack} className="min-h-12 px-4 text-lg">{t("items.back")}</PosSecondaryButton>
        <h1 className="text-2xl font-extrabold">{t("settings.title")}</h1>
      </div>

      <SettingsGroup id="settings-shop" title={t("settings.groupShop")}>
        <form onSubmit={saveShopName} className="flex items-end gap-2 px-4 py-3">
          <label className="block min-w-0 flex-1">
            <span className="mb-1 block text-base font-extrabold">{t("settings.shopName")}</span>
            <input maxLength={60} value={draft} onChange={(event) => { setDraft(event.target.value); setSaved(false); }} className="h-12 w-full rounded-xl border-2 border-slate-500 px-3 text-lg" />
          </label>
          <PosSecondaryButton type="submit" disabled={!nameChanged} className="min-h-12 shrink-0 border-emerald-900 text-emerald-900">{t("settings.save")}</PosSecondaryButton>
        </form>
      </SettingsGroup>
      {saved && <p role="status" className="px-1 text-base font-bold text-emerald-900">{t("settings.saved")}</p>}

      <SettingsGroup id="settings-preferences" title={t("settings.groupPreferences")}>
        <SwitchRow id="settings-sound" label={t("settings.soundFeedback")} helper={t("settings.soundHelper")} checked={audioEnabled} onChange={(event) => setAudioEnabled(setAudioFeedbackEnabled(event.target.checked))} />
        <SwitchRow id="settings-profit" label={t("settings.showEstimatedProfit")} helper={t("settings.showProfitHelper")} checked={showProfit} onChange={(event) => void changeShowProfit(event.target.checked)} />
      </SettingsGroup>

      <SettingsGroup id="settings-payments" title={t("settings.groupPayments")}>
        {/* 63 must be reachable without the subscription flag: it holds the number customers send to. */}
        <LinkRow id="settings-momo" title={t("settings.momoPayments")} detail={momoSetUp ? t("settings.momoSetUp") : t("settings.momoNotSetUp")} onClick={onOpenMomoSettings} />
        {subscriptionEnabled && (
          <LinkRow
            id="settings-plan"
            title={t("settings.myPlan")}
            detail={planDetail}
            tag={hasActiveSubscription ? <span className="shrink-0 rounded-lg border-2 border-emerald-900 bg-emerald-100 px-2 text-sm font-extrabold text-emerald-950">{t("settings.planActiveTag")}</span> : null}
            onClick={onOpenPlan}
          />
        )}
      </SettingsGroup>

      <SettingsGroup id="settings-records" title={t("settings.groupRecords")}>
        <LinkRow id="settings-backup" title={t("settings.backup")} onClick={onOpenBackup} />
      </SettingsGroup>

      {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
      <PosPrimaryButton type="button" onClick={onBack} className="mt-1">{t("credit.done")}</PosPrimaryButton>
    </PosPage>
  );
}
