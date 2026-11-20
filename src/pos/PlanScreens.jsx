import { useEffect, useMemo, useRef, useState } from "react";
import { Banknote, Check, Smartphone } from "lucide-react";
import { formatDate } from "../lib/formatDate.js";
import { formatGhs } from "../lib/money.js";
import { getPreference } from "../db/preferences.js";
import { appendPlanPayment, createPlanCashCode, getPlanLastUsedMethod, getPlanPaymentConfiguration, groupPlanPayments, listPlanPayments, PLAN_CONFIG, planMethodLabel, planPaymentRows, planStatusLabel } from "./planPayments.js";
import { MOMO_CONFIG, PHONE_REQUEST_ENABLED } from "./momoConfig.js";
import { PosCard, PosPage, PosPrimaryButton, PosStatusTag, PosBackButton } from "./PosComponents.jsx";
import { useBackBlock } from "./browserBack.js";
import { EventDetail, KeyValueRows } from "./EventRows.jsx";
import { posText as t } from "./i18n.js";

const NETWORKS = ["MTN", "Telecel", "AirtelTigo"];

function BackTitle({ title, onBack }) {
  return <div className="flex items-center gap-3"><PosBackButton onClick={onBack} /><h1 className="text-2xl font-extrabold">{title}</h1></div>;
}

const PLAN_STATUS_TONES = Object.freeze({ confirmed: "green", waiting: "amber", failed: "red", reversed: "red" });

function daysLeft(expiry) {
  const time = Date.parse(expiry);
  return Number.isFinite(time) ? Math.max(0, Math.ceil((time - Date.now()) / 86400000)) : 0;
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

// 64: one status for the plan card. The paid plan wins over the trial; a missing or past
// expiry is calm (amber), never a red alarm.
function planStatus(expiry, trialActive, trialExpiry) {
  const time = Date.parse(expiry);
  const today = startOfToday();
  if (Number.isFinite(time) && time >= today + 86400000) {
    const days = daysLeft(expiry);
    // Wiring 64 "Key-value rows" (16 Nov 2026): rows Active until (dd/mm/yyyy) and Days left (a number).
    return { kind: "active", label: "Active", tone: "green", rows: [{ name: "active-until", label: t("kv.activeUntil"), value: formatDate(expiry) }, { name: "days-left", label: t("kv.daysLeft"), value: String(days) }] };
  }
  if (Number.isFinite(time) && time >= today) return { kind: "due", label: "Due today", tone: "amber", line: "Due today" };
  if (trialActive && Number.isFinite(Date.parse(trialExpiry))) {
    const days = Math.max(1, daysLeft(trialExpiry));
    // The Trial tag is on the card header; the days left are a row, like the active plan.
    return { kind: "trial", label: "Trial", tone: "neutral", rows: [{ name: "days-left", label: t("kv.daysLeft"), value: String(days) }] };
  }
  return {
    kind: "ended",
    label: "Late",
    tone: "amber",
    line: Number.isFinite(time) ? `Your plan ended on ${formatDate(expiry)}. Your sales and records are safe.` : "Your plan is not active. Your sales and records are safe."
  };
}

export function MyPlan({
  expiry = "",
  onBack,
  onNavigate,
  subscriptionExpiry = "",
  trialActive = false,
  trialExpiry = ""
}) {
  const [payments, setPayments] = useState([]);
  useEffect(() => { listPlanPayments().then((rows) => setPayments(groupPlanPayments(rows))).catch((error) => console.error("Could not load plan payments.", error)); }, []);
  const status = planStatus(expiry || subscriptionExpiry, trialActive, trialExpiry);
  return <PosPage className="flex flex-col gap-3">
    <BackTitle title="My plan" onBack={onBack} />
    <PosCard className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-extrabold">Shop plan</h2><PosStatusTag tone={status.tone}>{status.label}</PosStatusTag></div>
      <p className="flex items-baseline gap-2"><span className="text-4xl font-extrabold">{formatGhs(PLAN_CONFIG.amountPesewas)}</span><span className="text-base font-semibold">a month</span></p>
      {/* Late or ended, and Due today, keep their existing wording (rule on 64). */}
      {status.rows
        ? <KeyValueRows name="plan-status">{status.rows.map((row) => <EventDetail key={row.name} label={row.label} name={row.name}>{row.value}</EventDetail>)}</KeyValueRows>
        : <p className="text-base font-bold text-slate-800">{status.line}</p>}
      {status.kind !== "ended" && <p className="text-sm">Your sales and records stay safe if a payment is late.</p>}
      <PosPrimaryButton type="button" onClick={() => onNavigate("PlanPayMethod")} className="mt-1 h-14 min-h-0">Pay now</PosPrimaryButton>
    </PosCard>
    <h2 className="text-lg font-extrabold">Payments</h2>
    <PosCard className="p-0">
      {payments.length === 0
        ? <p className="p-4">No payments yet.</p>
        : <div className="divide-y divide-slate-200">{payments.map((payment) => <div key={payment.id} data-row="payment" className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0"><p className="font-extrabold">{planMethodLabel(payment.method)}</p><p className="text-sm text-slate-700">{formatDate(payment.createdAt)}</p></div>
            <div className="flex shrink-0 flex-col items-end gap-1"><span className="whitespace-nowrap font-extrabold">{formatGhs(payment.amountPesewas)}</span>{planStatusLabel(payment.status) && <PosStatusTag compact tone={PLAN_STATUS_TONES[payment.status] ?? "neutral"}>{planStatusLabel(payment.status)}</PosStatusTag>}</div>
          </div>)}</div>}
    </PosCard>
  </PosPage>;
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
  useBackBlock(saving);
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

// What Send request on 68 saves as the plan payment, and what its You pay row shows: the plan price (the
// same amount appendPlanPayment saves by default, so stored data is unchanged).
const PHONE_PLAN_AMOUNT = PLAN_CONFIG.amountPesewas;

export function PlanPayPhone({ onBack, onNavigate }) {
  const [network, setNetwork] = useState("MTN");
  const [number, setNumber] = useState("");
  const { saving, save, errorMessage } = useSavePlanPayment(onNavigate);
  useEffect(() => { getPreference("momoReceivingNumber", "").then(setNumber).catch((error) => console.error("Could not load MoMo number.", error)); }, []);
  return <PosPage className="flex flex-col gap-3"><BackTitle title="Phone request" onBack={onBack} /><p className="text-2xl font-extrabold">{formatGhs(PLAN_CONFIG.amountPesewas)}</p>{/* Wiring 68 "Fee and You pay" (20 Nov 2026, until the owner decides who bears the fee): one row, You pay,
  equal to the plan price that Send request saves as the plan payment (PHONE_PLAN_AMOUNT below); no Fee row. */}<KeyValueRows name="plan-pay"><EventDetail label={t("kv.youPay")} name="you-pay">{formatGhs(PHONE_PLAN_AMOUNT)}</EventDetail></KeyValueRows><fieldset><legend className="font-bold">Your network</legend><div className="grid grid-cols-3 gap-2">{NETWORKS.map((item) => <button key={item} type="button" aria-label={`Network ${item}`} aria-pressed={network === item} onClick={() => setNetwork(item)} className={`min-h-14 rounded-xl border-2 font-bold ${network === item ? "border-emerald-900 bg-green-200" : "border-slate-700 bg-white"}`}>Network {item}</button>)}</div></fieldset><label className="font-bold">Your MoMo number<input value={number} onChange={(event) => setNumber(event.target.value)} className="mt-1 h-14 w-full rounded-xl border-2 border-slate-700 px-3 text-xl" /></label>{errorMessage}<PosPrimaryButton type="button" disabled={!PHONE_REQUEST_ENABLED || !number.trim() || saving} onClick={() => void save({ method: "momo_paystack", amountPesewas: PHONE_PLAN_AMOUNT })}>Send request</PosPrimaryButton><p className="text-sm">Each month you get a new request. It does not renew by itself.</p></PosPage>;
}

export function PlanPaymentResult({ params = {}, onNavigate }) {
  const waiting = params.state === "waiting";
  return <PosPage className="flex flex-col gap-3"><h1 className="text-2xl font-extrabold">{waiting ? planStatusLabel("waiting") : "Plan paid"}</h1><PosCard>{waiting ? <><h2 className="text-xl font-extrabold">We have your payment details</h2><p>Waiting for confirmation. Your plan starts when we confirm. You can keep selling.</p></> : <><h2 className="text-2xl font-extrabold text-emerald-900">✓ {formatGhs(params.payment?.amountPesewas ?? PLAN_CONFIG.amountPesewas)} received</h2>{planPaymentRows(params.payment).length > 0 && <KeyValueRows name="plan-paid">{planPaymentRows(params.payment).map((row) => <EventDetail key={row.name} label={row.label} name={row.name}>{row.value}</EventDetail>)}</KeyValueRows>}</>}</PosCard><PosPrimaryButton type="button" onClick={() => onNavigate("MyPlan")}> <Check size={24} aria-hidden="true" />Done</PosPrimaryButton></PosPage>;
}
