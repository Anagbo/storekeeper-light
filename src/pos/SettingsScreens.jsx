import { useEffect, useState } from "react";
import { Check, DatabaseBackup, Globe2, Volume2 } from "lucide-react";
import { getPreference, setPreference } from "../db/preferences.js";
import { PLAN_PRICES_PESEWAS } from "../config/plans.js";
import { formatGhs } from "../lib/money.js";
import { isAudioFeedbackEnabled, setAudioFeedbackEnabled } from "../utils/audioFeedback.js";
import { posText as t } from "./i18n.js";
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

export function SettingsProfitTools({
  shopName,
  onShopNameChange,
  onBack,
  onOpenBackup,
  onOpenMomoSettings,
  onOpenPlan,
  onOpenSubscription,
  subscriptionEnabled = false,
  hasActiveSubscription = false,
  subscriptionExpiry = "",
  trialActive = false,
  trialExpiry = ""
}) {
  const [draft, setDraft] = useState(shopName);
  const [audioEnabled, setAudioEnabled] = useState(isAudioFeedbackEnabled);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => setDraft(shopName), [shopName]);

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

  return (
    <PosPage className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <PosSecondaryButton type="button" onClick={onBack}>{t("items.back")}</PosSecondaryButton>
        <h1 className="text-2xl font-extrabold">{t("settings.title")}</h1>
      </div>
      <form onSubmit={saveShopName} className="rounded-2xl border-2 border-slate-500 p-4">
        <label className="block">
          <span className="mb-1 block font-extrabold">{t("settings.shopName")}</span>
          <input maxLength={60} value={draft} onChange={(event) => { setDraft(event.target.value); setSaved(false); }} className="h-12 w-full rounded-xl border-2 border-slate-500 px-3 text-lg" />
        </label>
        <PosSecondaryButton type="submit" className="mt-2">{t("settings.saveShopName")}</PosSecondaryButton>
      </form>
      <label className="flex min-h-16 items-center justify-between gap-3 rounded-2xl border-2 border-slate-500 p-4">
        <span className="flex items-center gap-2 font-extrabold"><Volume2 size={20} aria-hidden="true" />{t("settings.soundFeedback")}</span>
        <input type="checkbox" checked={audioEnabled} onChange={(event) => setAudioEnabled(setAudioFeedbackEnabled(event.target.checked))} className="h-6 w-6 accent-emerald-800" />
      </label>
      {/* 63 must be reachable without the subscription flag: it holds the number customers send to. */}
      <PosSecondaryButton type="button" onClick={onOpenMomoSettings}>MoMo payments</PosSecondaryButton>
      {subscriptionEnabled && (
        <section className="rounded-2xl border-2 border-emerald-800 bg-emerald-50 p-4">
          <h2 className="font-extrabold">{t("settings.subscriptionTitle")}</h2>
          <p className="mt-1 text-slate-800">
            {hasActiveSubscription
              ? t("settings.subscriptionActive")
              : t("settings.subscriptionInactive", { amount: formatGhs(PLAN_PRICES_PESEWAS.monthly) })}
          </p>
          {hasActiveSubscription && subscriptionExpiry && (
            <p className="mt-1 text-sm font-semibold text-emerald-900">
              {t("settings.subscriptionExpires", { date: new Date(subscriptionExpiry).toLocaleDateString("en-GB") })}
            </p>
          )}
          <PosSecondaryButton type="button" onClick={onOpenPlan}>My plan</PosSecondaryButton>
          {trialActive && trialExpiry && (
            <p className="mt-1 text-sm font-semibold text-sky-900">
              {t("settings.subscriptionTrial", { date: new Date(trialExpiry).toLocaleDateString("en-GB") })}
            </p>
          )}
          <PosSecondaryButton type="button" onClick={onOpenSubscription} className="mt-3">
            {hasActiveSubscription ? t("settings.manageSubscription") : t("settings.subscribe")}
          </PosSecondaryButton>
        </section>
      )}
      <PosSecondaryButton type="button" onClick={onOpenBackup}>
        <DatabaseBackup size={20} aria-hidden="true" />{t("settings.backup")}
      </PosSecondaryButton>
      {saved && <p role="status" className="text-emerald-900">{t("settings.saved")}</p>}
      {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
      <PosPrimaryButton type="button" onClick={onBack} className="mt-auto">{t("credit.done")}</PosPrimaryButton>
    </PosPage>
  );
}
