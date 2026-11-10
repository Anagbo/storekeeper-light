import { useEffect, useMemo, useRef, useState } from "react";
import { Banknote, Check, Smartphone } from "lucide-react";
import { formatDate } from "../lib/formatDate.js";
import { formatGhs } from "../lib/money.js";
import { PLAN_PRICES_PESEWAS } from "../config/plans.js";
import { posText as t } from "./i18n.js";
import { getPreference } from "../db/preferences.js";
import { appendPlanPayment, createPlanCashCode, describePlanPayment, getPlanLastUsedMethod, getPlanPaymentConfiguration, groupPlanPayments, listPlanPayments, PLAN_CONFIG, planMethodLabel, planStatusLabel } from "./planPayments.js";
import { MOMO_CONFIG, PHONE_REQUEST_ENABLED } from "./momoConfig.js";
import { PosCard, PosPage, PosPrimaryButton, PosSecondaryButton, PosStatusTag, PosBackButton } from "./PosComponents.jsx";

const NETWORKS = ["MTN", "Telecel", "AirtelTigo"];

function BackTitle({ title, onBack }) {
  return <div className="flex items-center gap-3"><PosBackButton onClick={onBack} /><h1 className="text-2xl font-extrabold">{title}</h1></div>;
}

function daysLeft(expiry) {
  const time = Date.parse(expiry);
  return Number.isFinite(time) ? Math.max(0, Math.ceil((time - Date.now()) / 86400000)) : 0;
}

function planStatus(expiry) {
  const time = Date.parse(expiry);
  if (!Number.isFinite(time)) return { label: "Late", tone: "red" };
  const days = daysLeft(expiry);
  if (days === 0) return { label: "Due today", tone: "amber" };
  return { label: `Active · ${days} days left`, tone: "green" };
}

export function MyPlan({
  expiry = "",
  onBack,
  onNavigate,
  onOpenSubscription,
  subscriptionEnabled = false,
  hasActiveSubscription = false,
  subscriptionExpiry = "",
  trialActive = false,
  trialExpiry = ""
}) {
  const [payments, setPayments] = useState([]);
  useEffect(() => { listPlanPayments().then((rows) => setPayments(groupPlanPayments(rows))).catch((error) => console.error("Could not load plan payments.", error)); }, []);
  const status = planStatus(expiry);
  return <PosPage className="flex flex-col gap-3"><BackTitle title="My plan" onBack={onBack} /><PosCard><h2 className="text-xl font-extrabold">Shop plan · {formatGhs(PLAN_CONFIG.amountPesewas)} a month</h2><PosStatusTag tone={status.tone}>{status.label}</PosStatusTag><p className="mt-2 text-sm">Your sales and records stay safe if a payment is late.</p></PosCard><PosPrimaryButton type="button" onClick={() => onNavigate("PlanPayMethod")}>Pay now</PosPrimaryButton>{subscriptionEnabled && <SubscriptionCard hasActiveSubscription={hasActiveSubscription} expiry={subscriptionExpiry || expiry} trialActive={trialActive} trialExpiry={trialExpiry} onOpenSubscription={onOpenSubscription} />}<h2 className="text-lg font-extrabold">Payments</h2><PosCard>{payments.length === 0 ? <p>No payments recorded yet.</p> : payments.map((payment) => <div key={payment.id} className="flex justify-between gap-3 border-b border-slate-200 py-2 last:border-0"><span>{formatDate(payment.createdAt)} · {planMethodLabel(payment.method)}</span><span className="font-bold">{[formatGhs(payment.amountPesewas), planStatusLabel(payment.status)].filter(Boolean).join(" · ")}</span></div>)}</PosCard></PosPage>;
}

// What the "View subscription" button in Settings opened (the Paystack plans), now reached from here.
function SubscriptionCard({ hasActiveSubscription, expiry, trialActive, trialExpiry, onOpenSubscription }) {
  return <PosCard>
    <h2 className="text-lg font-extrabold">{t("settings.subscriptionTitle")}</h2>
    <p className="mt-1">{hasActiveSubscription ? t("settings.subscriptionActive") : t("settings.subscriptionInactive", { amount: formatGhs(PLAN_PRICES_PESEWAS.monthly) })}</p>
    {hasActiveSubscription && formatDate(expiry) && <p className="mt-1 text-sm font-semibold text-emerald-900">{t("settings.subscriptionExpires", { date: formatDate(expiry) })}</p>}
    {trialActive && formatDate(trialExpiry) && <p className="mt-1 text-sm font-semibold text-sky-900">{t("settings.subscriptionTrial", { date: formatDate(trialExpiry) })}</p>}
    <PosSecondaryButton type="button" onClick={onOpenSubscription} className="mt-3 min-h-12 w-full">{hasActiveSubscription ? t("settings.manageSubscription") : t("settings.subscribe")}</PosSecondaryButton>
  </PosCard>;
}

function MethodTile({ icon: Icon, title, detail, disabled = false, onClick, children }) {
  return <button type="button" disabled={disabled} onClick={onClick} className="flex min-h-[92px] items-center gap-3 rounded-[20px] border-[3px] border-slate-900 bg-white p-3 text-left disabled:cursor-not-allowed disabled:opacity-60"><Icon size={30} className="shrink-0 text-emerald-900" aria-hidden="true" /><span className="min-w-0 flex-1"><b className="block text-xl">{title}</b><span className="text-base">{detail}</span>{children && <span className="mt-1 flex flex-wrap gap-1">{children}</span>}</span></button>;
}

// 65: helper and tag text from the wiring file (K15). Last used shows only on the
// method stored by the last plan payment; the fee comes from configuration.
export function PlanPayMethod({ onBack, onNavigate }) {
  const [lastUsed, setLastUsed] = useState("");
  useEffect(() => { getPlanLastUsedMethod().then(setLastUsed).catch((error) => console.error("Could not load the last plan payment method.", error)); }, []);
  return <PosPage className="flex flex-col gap-3"><BackTitle title="Pay for my plan" onBack={onBack} /><p className="text-[22px] font-extrabold">{formatGhs(PLAN_CONFIG.amountPesewas)} for 1 month</p><h2 className="text-lg font-bold">How do you want to pay?</h2>
    <MethodTile icon={Banknote} title="Cash" detail="Give cash to a StoreKeeper agent." onClick={() => onNavigate("PlanPayCash")}>{lastUsed === "cash" && <PosStatusTag compact>Last used</PosStatusTag>}<PosStatusTag compact>Free</PosStatusTag></MethodTile>
    <MethodTile icon={Smartphone} title="Mobile money" detail="Send to our number. Enter the message code." onClick={() => onNavigate("PlanPayMoMo")}>{lastUsed === "momo_direct" && <PosStatusTag compact>Last used</PosStatusTag>}<PosStatusTag compact>Free</PosStatusTag></MethodTile>
    <MethodTile icon={Smartphone} title="Phone request" detail={PHONE_REQUEST_ENABLED ? "Approve on your phone. Confirmed by itself." : "Not available yet"} disabled={!PHONE_REQUEST_ENABLED} onClick={() => onNavigate("PlanPayPhone")}>{PHONE_REQUEST_ENABLED && lastUsed === "momo_paystack" && <PosStatusTag compact>Last used</PosStatusTag>}<PosStatusTag compact>{`Fee ${formatGhs(MOMO_CONFIG.phoneRequestFeePesewas)}`}</PosStatusTag></MethodTile>
  </PosPage>;
}

// One save at a time for plan payment buttons (66, 67, 68). The guard is released
// only when the save fails; on success the screen is replaced by the result.
function useSavePlanPayment(onNavigate) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  async function save(details) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const payment = await appendPlanPayment(details);
      onNavigate("PlanPaymentResult", { state: "waiting", payment });
    } catch (saveError) {
      console.error("Could not save the plan payment.", saveError);
      savingRef.current = false;
      setSaving(false);
      setError("Could not save the payment. Please try again.");
    }
  }
  const errorMessage = error ? <p role="alert" className="text-base font-bold text-rose-900">{error}</p> : null;
  return { saving, save, errorMessage };
}

export function PlanPayCash({ onBack, onNavigate }) {
  const [reference] = useState(() => `plan-${createPlanCashCode()}`);
  const { saving, save, errorMessage } = useSavePlanPayment(onNavigate);
  return <PosPage className="flex flex-col gap-3"><BackTitle title="Pay cash" onBack={onBack} /><p className="text-xl font-extrabold">Give {formatGhs(PLAN_CONFIG.amountPesewas)} to a StoreKeeper agent.</p><PosCard><p className="font-semibold">Show this code to the agent</p><p className="text-4xl font-extrabold">{reference.slice(-6).replace(/(.{3})/, "$1 ")}</p></PosCard><p className="font-semibold">The agent enters the code. Your plan starts when they confirm.</p>{errorMessage}<PosPrimaryButton type="button" disabled={saving} onClick={() => void save({ method: "cash", reference })}>I gave the cash</PosPrimaryButton></PosPage>;
}

export function PlanPayMoMo({ onBack, onNavigate }) {
  const [config, setConfig] = useState({ receivingNumber: "", shopPhone: "" });
  const [code, setCode] = useState("");
  const { saving, save, errorMessage } = useSavePlanPayment(onNavigate);
  useEffect(() => { getPlanPaymentConfiguration().then(setConfig).catch((error) => console.error("Could not load plan payment configuration.", error)); }, []);
  return <PosPage className="flex flex-col gap-3"><BackTitle title="Send to StoreKeeper" onBack={onBack} /><p className="text-lg font-bold">Send {formatGhs(PLAN_CONFIG.amountPesewas)} by MoMo to</p><PosCard><p className="text-3xl font-extrabold">{config.receivingNumber || "Receiving number not configured"}</p><p className="text-lg font-semibold">{PLAN_CONFIG.receivingName}</p></PosCard><p className="font-bold">Reference: write your shop phone</p><input value={config.shopPhone} readOnly className="h-14 rounded-xl border-2 border-slate-700 px-3 text-xl font-bold" /><label className="font-bold">Code from the MoMo message<input value={code} onChange={(event) => setCode(event.target.value)} className="mt-1 h-14 w-full rounded-xl border-2 border-slate-700 px-3 text-xl" /></label>{errorMessage}<PosPrimaryButton type="button" disabled={!code.trim() || saving} onClick={() => void save({ method: "momo_direct", reference: code })}>I sent it</PosPrimaryButton><p className="text-sm">We check it and confirm your plan.</p></PosPage>;
}

export function PlanPayPhone({ onBack, onNavigate }) {
  const [network, setNetwork] = useState("MTN");
  const [number, setNumber] = useState("");
  const { saving, save, errorMessage } = useSavePlanPayment(onNavigate);
  useEffect(() => { getPreference("momoReceivingNumber", "").then(setNumber).catch((error) => console.error("Could not load MoMo number.", error)); }, []);
  return <PosPage className="flex flex-col gap-3"><BackTitle title="Phone request" onBack={onBack} /><p className="text-2xl font-extrabold">{formatGhs(PLAN_CONFIG.amountPesewas)}</p><p className="font-semibold">{`Fee ${formatGhs(MOMO_CONFIG.phoneRequestFeePesewas)}`}</p><fieldset><legend className="font-bold">Your network</legend><div className="grid grid-cols-3 gap-2">{NETWORKS.map((item) => <button key={item} type="button" aria-label={`Network ${item}`} aria-pressed={network === item} onClick={() => setNetwork(item)} className={`min-h-14 rounded-xl border-2 font-bold ${network === item ? "border-emerald-900 bg-green-200" : "border-slate-700 bg-white"}`}>Network {item}</button>)}</div></fieldset><label className="font-bold">Your MoMo number<input value={number} onChange={(event) => setNumber(event.target.value)} className="mt-1 h-14 w-full rounded-xl border-2 border-slate-700 px-3 text-xl" /></label>{errorMessage}<PosPrimaryButton type="button" disabled={!PHONE_REQUEST_ENABLED || !number.trim() || saving} onClick={() => void save({ method: "momo_paystack" })}>Send request</PosPrimaryButton><p className="text-sm">Each month you get a new request. It does not renew by itself.</p></PosPage>;
}

export function PlanPaymentResult({ params = {}, onNavigate }) {
  const waiting = params.state === "waiting";
  return <PosPage className="flex flex-col gap-3"><h1 className="text-2xl font-extrabold">{waiting ? planStatusLabel("waiting") : "Plan paid"}</h1><PosCard>{waiting ? <><h2 className="text-xl font-extrabold">We have your payment details</h2><p>Waiting for confirmation. Your plan starts when we confirm. You can keep selling.</p></> : <><h2 className="text-2xl font-extrabold text-emerald-900">✓ {formatGhs(params.payment?.amountPesewas ?? PLAN_CONFIG.amountPesewas)} received</h2>{describePlanPayment(params.payment) && <p>{describePlanPayment(params.payment)}</p>}</>}</PosCard><PosPrimaryButton type="button" onClick={() => onNavigate("MyPlan")}> <Check size={24} aria-hidden="true" />Done</PosPrimaryButton></PosPage>;
}
