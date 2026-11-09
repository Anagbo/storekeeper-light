import { useEffect, useMemo, useState } from "react";
import { Banknote, Check, Smartphone } from "lucide-react";
import { formatGhs } from "../lib/money.js";
import { getPreference } from "../db/preferences.js";
import { appendPlanPayment, getPlanPaymentConfiguration, listPlanPayments, PLAN_CONFIG } from "./planPayments.js";
import { PHONE_REQUEST_ENABLED } from "./momoConfig.js";
import { PosCard, PosPage, PosPrimaryButton, PosSecondaryButton, PosStatusTag } from "./PosComponents.jsx";

const NETWORKS = ["MTN", "Telecel", "AirtelTigo"];

function BackTitle({ title, onBack }) {
  return <div className="flex items-center gap-3"><PosSecondaryButton type="button" onClick={onBack} className="min-h-[52px] px-4 text-lg">‹ Back</PosSecondaryButton><h1 className="text-2xl font-extrabold">{title}</h1></div>;
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

export function MyPlan({ expiry = "", onBack, onNavigate }) {
  const [payments, setPayments] = useState([]);
  useEffect(() => { listPlanPayments().then(setPayments).catch((error) => console.error("Could not load plan payments.", error)); }, []);
  const status = planStatus(expiry);
  return <PosPage className="flex flex-col gap-3"><BackTitle title="My plan" onBack={onBack} /><PosCard><h2 className="text-xl font-extrabold">Shop plan · {formatGhs(PLAN_CONFIG.amountPesewas)} a month</h2><PosStatusTag tone={status.tone}>{status.label}</PosStatusTag><p className="mt-2 text-sm">Your sales and records stay safe if a payment is late.</p></PosCard><PosPrimaryButton type="button" onClick={() => onNavigate("PlanPayMethod")}>Pay now</PosPrimaryButton><h2 className="text-lg font-extrabold">Payments</h2><PosCard>{payments.length === 0 ? <p>No payments recorded yet.</p> : payments.map((payment) => <div key={payment.id} className="flex justify-between gap-3 border-b border-slate-200 py-2 last:border-0"><span>{new Date(payment.createdAt).toLocaleDateString("en-GB")} · {payment.method}</span><span className="font-bold">{formatGhs(payment.amountPesewas)} · {payment.status}</span></div>)}</PosCard></PosPage>;
}

function MethodTile({ icon: Icon, title, detail, disabled = false, onClick }) {
  return <button type="button" disabled={disabled} onClick={onClick} className="flex min-h-[92px] items-center gap-3 rounded-[20px] border-[3px] border-slate-900 bg-white p-3 text-left disabled:cursor-not-allowed disabled:opacity-60"><Icon size={30} className="shrink-0 text-emerald-900" aria-hidden="true" /><span><b className="block text-xl">{title}</b><span className="text-base">{detail}</span></span></button>;
}

export function PlanPayMethod({ onBack, onNavigate }) {
  return <PosPage className="flex flex-col gap-3"><BackTitle title="Pay for my plan" onBack={onBack} /><p className="text-[22px] font-extrabold">{formatGhs(PLAN_CONFIG.amountPesewas)} for 1 month</p><h2 className="text-lg font-bold">How do you want to pay?</h2><MethodTile icon={Banknote} title="Cash" detail="Give cash to a StoreKeeper agent." onClick={() => onNavigate("PlanPayCash")} /><MethodTile icon={Smartphone} title="Mobile money" detail="Send to our number. Enter the message code." onClick={() => onNavigate("PlanPayMoMo")} /><MethodTile icon={Smartphone} title="Phone request" detail={PHONE_REQUEST_ENABLED ? "Approve on your phone. Confirmed by itself." : "Not available yet"} disabled={!PHONE_REQUEST_ENABLED} onClick={() => onNavigate("PlanPayPhone")} /></PosPage>;
}

export function PlanPayCash({ onBack, onNavigate }) {
  const [reference] = useState(() => `plan-${Date.now()}`);
  return <PosPage className="flex flex-col gap-3"><BackTitle title="Pay cash" onBack={onBack} /><p className="text-xl font-extrabold">Give {formatGhs(PLAN_CONFIG.amountPesewas)} to a StoreKeeper agent.</p><PosCard><p className="font-semibold">Show this code to the agent</p><p className="text-4xl font-extrabold">{reference.slice(-6).replace(/(.{3})/, "$1 ")}</p></PosCard><p className="font-semibold">The agent enters the code. Your plan starts when they confirm.</p><PosPrimaryButton type="button" onClick={async () => { const payment = await appendPlanPayment({ method: "cash", reference }); onNavigate("PlanPaymentResult", { state: "waiting", payment }); }}>I gave the cash</PosPrimaryButton></PosPage>;
}

export function PlanPayMoMo({ onBack, onNavigate }) {
  const [config, setConfig] = useState({ receivingNumber: "", shopPhone: "" });
  const [code, setCode] = useState("");
  useEffect(() => { getPlanPaymentConfiguration().then(setConfig).catch((error) => console.error("Could not load plan payment configuration.", error)); }, []);
  return <PosPage className="flex flex-col gap-3"><BackTitle title="Send to StoreKeeper" onBack={onBack} /><p className="text-lg font-bold">Send {formatGhs(PLAN_CONFIG.amountPesewas)} by MoMo to</p><PosCard><p className="text-3xl font-extrabold">{config.receivingNumber || "Receiving number not configured"}</p><p className="text-lg font-semibold">{PLAN_CONFIG.receivingName}</p></PosCard><p className="font-bold">Reference: write your shop phone</p><input value={config.shopPhone} readOnly className="h-14 rounded-xl border-2 border-slate-700 px-3 text-xl font-bold" /><label className="font-bold">Code from the MoMo message<input value={code} onChange={(event) => setCode(event.target.value)} className="mt-1 h-14 w-full rounded-xl border-2 border-slate-700 px-3 text-xl" /></label><PosPrimaryButton type="button" disabled={!code.trim()} onClick={async () => { const payment = await appendPlanPayment({ method: "momo_direct", reference: code }); onNavigate("PlanPaymentResult", { state: "waiting", payment }); }}>I sent it</PosPrimaryButton><p className="text-sm">We check it and confirm your plan.</p></PosPage>;
}

export function PlanPayPhone({ onBack, onNavigate }) {
  const [network, setNetwork] = useState("MTN");
  const [number, setNumber] = useState("");
  useEffect(() => { getPreference("momoReceivingNumber", "").then(setNumber).catch((error) => console.error("Could not load MoMo number.", error)); }, []);
  return <PosPage className="flex flex-col gap-3"><BackTitle title="Phone request" onBack={onBack} /><p className="text-2xl font-extrabold">{formatGhs(PLAN_CONFIG.amountPesewas)}</p><p>Fee is configuration-driven.</p><fieldset><legend className="font-bold">Your network</legend><div className="grid grid-cols-3 gap-2">{NETWORKS.map((item) => <button key={item} type="button" aria-label={`Network ${item}`} aria-pressed={network === item} onClick={() => setNetwork(item)} className={`min-h-14 rounded-xl border-2 font-bold ${network === item ? "border-emerald-900 bg-green-200" : "border-slate-700 bg-white"}`}>Network {item}</button>)}</div></fieldset><label className="font-bold">Your MoMo number<input value={number} onChange={(event) => setNumber(event.target.value)} className="mt-1 h-14 w-full rounded-xl border-2 border-slate-700 px-3 text-xl" /></label><PosPrimaryButton type="button" disabled={!PHONE_REQUEST_ENABLED || !number.trim()} onClick={async () => { const payment = await appendPlanPayment({ method: "momo_paystack" }); onNavigate("PlanPaymentResult", { state: "waiting", payment }); }}>Send request</PosPrimaryButton><p className="text-sm">Each month you get a new request. It does not renew by itself.</p></PosPage>;
}

export function PlanPaymentResult({ params = {}, onNavigate }) {
  const waiting = params.state === "waiting";
  return <PosPage className="flex flex-col gap-3"><h1 className="text-2xl font-extrabold">{waiting ? "Waiting to confirm" : "Plan paid"}</h1><PosCard>{waiting ? <><h2 className="text-xl font-extrabold">We have your payment details</h2><p>Waiting for confirmation. Your plan starts when we confirm. You can keep selling.</p></> : <><h2 className="text-2xl font-extrabold text-emerald-900">✓ {formatGhs(params.payment?.amountPesewas ?? PLAN_CONFIG.amountPesewas)} received</h2><p>Plan payment confirmed.</p></>}</PosCard><PosPrimaryButton type="button" onClick={() => onNavigate("MyPlan")}> <Check size={24} aria-hidden="true" />Done</PosPrimaryButton></PosPage>;
}
