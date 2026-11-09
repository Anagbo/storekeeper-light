import { useEffect, useState } from "react";
import { Check, Clock3, Copy, Send, Smartphone, UserRound } from "lucide-react";
import { getPreference, setPreference } from "../db/preferences.js";
import { formatGhs } from "../lib/money.js";
import { MOMO_CONFIG, getMerchantMomoSettings } from "./momoConfig.js";
import { getMomoAmountPesewas } from "./paymentAmount.js";
import { PosCard, PosPage, PosPrimaryButton, PosSecondaryButton, PosStatusTag } from "./PosComponents.jsx";

const NETWORKS = ["MTN", "Telecel", "AirtelTigo"];

function BackTitle({ title, onBack }) {
  return <div className="flex items-center gap-3"><PosSecondaryButton type="button" onClick={onBack} className="min-h-[52px] px-4 text-lg">‹ Back</PosSecondaryButton><h1 className="text-2xl font-extrabold">{title}</h1></div>;
}

function ChoiceTile({ icon: Icon, title, detail, selected, onClick, children }) {
  return <button type="button" aria-pressed={selected} onClick={onClick} className={`flex min-h-[92px] items-center gap-3 rounded-[20px] border-[3px] p-3 text-left ${selected ? "border-emerald-900 bg-green-200" : "border-slate-900 bg-white"}`}>
    <Icon size={30} className="shrink-0 text-emerald-900" aria-hidden="true" />
    <span className="min-w-0 flex-1"><b className="block text-xl">{title}</b><span className="text-base text-slate-800">{detail}</span>{children}</span>
  </button>;
}

export function MoMoChoice({ params = {}, onBack, onNavigate }) {
  const [settings, setSettings] = useState({ defaultMethod: "ask" });
  useEffect(() => { getMerchantMomoSettings().then(setSettings).catch((error) => console.error("Could not load MoMo settings.", error)); }, []);
  const lastUsed = settings.defaultMethod === "phone" ? "phone" : "direct";
  const paymentAmountPesewas = getMomoAmountPesewas(params);
  return <PosPage className="flex flex-col gap-3">
    <BackTitle title="MoMo payment" onBack={onBack} />
    <p className="text-[22px] font-extrabold">Customer pays {formatGhs(paymentAmountPesewas)}</p>
    <h2 className="text-xl font-extrabold">How will they pay?</h2>
    <ChoiceTile icon={Send} title="Customer sends to my number" detail="Free. You check the MoMo message." selected={lastUsed === "direct"} onClick={() => onNavigate("MoMoDirect", { ...params, momoMethod: "direct" })}>
      {lastUsed === "direct" && <PosStatusTag compact>Last used</PosStatusTag>}
    </ChoiceTile>
    <ChoiceTile icon={Smartphone} title="Phone request" detail={`Customer approves on their phone. Confirmed by itself. Fee ${formatGhs(MOMO_CONFIG.phoneRequestFeePesewas)}.`} selected={lastUsed === "phone"} onClick={() => onNavigate(params.paystackSetUp ? "MoMoPayment" : "MoMoSetup", { ...params, momoMethod: "paystack", returnToMomo: true })}>
      {lastUsed === "phone" && <PosStatusTag compact>Last used</PosStatusTag>}
    </ChoiceTile>
    <p className="text-sm font-medium text-slate-800">Change the usual choice in Settings.</p>
  </PosPage>;
}

export function MoMoDirect({ params = {}, onBack, onConfirm, onPick }) {
  const [settings, setSettings] = useState({ number: "", network: "" });
  const [copied, setCopied] = useState(false);
  const paymentAmountPesewas = getMomoAmountPesewas(params);
  useEffect(() => { getMerchantMomoSettings().then(setSettings).catch((error) => console.error("Could not load receiving settings.", error)); }, []);
  async function copyNumber() {
    if (!settings.number) return;
    try { await navigator.clipboard.writeText(settings.number); setCopied(true); } catch (error) { console.error("Could not copy MoMo number.", error); }
  }
  return <PosPage className="flex flex-col gap-3">
    <BackTitle title="Customer sends to me" onBack={onBack} />
    <p className="text-lg font-bold">Ask the customer to send {formatGhs(paymentAmountPesewas)} to</p>
    <PosCard><p className="text-[32px] font-extrabold">{settings.number || "—"}</p><p className="text-lg font-semibold">{settings.network || "—"}</p></PosCard>
    <PosSecondaryButton type="button" onClick={() => void copyNumber()}><Copy size={20} aria-hidden="true" />Copy number</PosSecondaryButton>
    {copied && <p role="status">Number copied.</p>}
    <p className="text-base font-semibold">Wait for the MoMo message. Check the amount and the name before you tap.</p>
    <PosPrimaryButton type="button" onClick={() => (params.pickOnly ? onPick({ ...params, momoMethod: "direct", verification: "merchant_confirmed" }) : onConfirm({ ...params, momoMethod: "direct", verification: "merchant_confirmed" }))}><Check size={28} aria-hidden="true" />Money received</PosPrimaryButton>
    <p className="text-sm font-medium">Saved as MoMo · you confirmed.</p>
  </PosPage>;
}

export function PaymentSettings({ onBack, onNavigate }) {
  const [settings, setSettings] = useState({ number: "", network: "", defaultMethod: "ask" });
  const [enabled, setEnabled] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { getMerchantMomoSettings().then((value) => { setSettings(value); setEnabled(Boolean(value.number)); }).catch((error) => console.error("Could not load payment settings.", error)); }, []);
  async function save() {
    await Promise.all([
      setPreference("momoDefault", settings.defaultMethod),
      setPreference("momoReceivingNumber", enabled ? settings.number : ""),
      setPreference("momoReceivingNetwork", settings.network)
    ]);
    setSaved(true);
    onBack();
  }
  return <PosPage className="flex flex-col gap-3">
    <BackTitle title="How customers pay me" onBack={onBack} />
    <PosCard>
      <label className="flex min-h-12 items-center justify-between gap-3 font-extrabold"><span>Customer sends to my number</span><input aria-label="Customer sends to my number" type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="h-6 w-6" /></label>
      <p className="mt-1 text-base">{enabled ? `On · ${settings.number || "number not set"} · ${settings.network}` : "Off"}</p>
    </PosCard>
    <PosCard><h2 className="text-lg font-extrabold">Phone request</h2><p className="text-base">Confirmed by itself. Fee {formatGhs(MOMO_CONFIG.phoneRequestFeePesewas)} per payment.</p><PosSecondaryButton type="button" onClick={() => onNavigate("MoMoSetup")} className="mt-2">Phone request: set up ›</PosSecondaryButton></PosCard>
    <h2 className="text-lg font-extrabold">When I tap MoMo</h2>
    {[["ask", "Ask me each time"], ["direct", "Always: customer sends to my number"], ["phone", "Always: phone request"]].map(([value, label]) => <button key={value} type="button" aria-pressed={settings.defaultMethod === value} onClick={() => setSettings((current) => ({ ...current, defaultMethod: value }))} className={`min-h-[72px] rounded-[18px] border-[3px] p-3 text-left text-lg font-extrabold ${settings.defaultMethod === value ? "border-emerald-900 bg-green-200" : "border-slate-900 bg-white"}`}><UserRound size={24} className="mr-3 inline text-emerald-900" aria-hidden="true" />{label}</button>)}
    {saved && <p role="status">Saved.</p>}
    <PosPrimaryButton type="button" onClick={() => void save()}><Check size={28} aria-hidden="true" />Save</PosPrimaryButton>
  </PosPage>;
}

export function MoMoSetup({ params = {}, onBack, onNavigate, shopName = "My shop" }) {
  const [network, setNetwork] = useState(MOMO_CONFIG.defaultNetwork);
  const [number, setNumber] = useState("");
  return <PosPage className="flex flex-col gap-3">
    <BackTitle title="Receive MoMo payments" onBack={onBack} />
    <p className="text-lg text-slate-800">Customers pay by MoMo. The money goes to the account below.</p>
    <div className="flex items-center gap-2 text-lg"><span className="font-extrabold">Status</span><PosStatusTag>Not set up</PosStatusTag></div>
    <label className="font-bold">Business name<input value={shopName} readOnly className="mt-1 h-14 w-full rounded-2xl border-[3px] border-slate-500 bg-white px-3 text-xl" /></label>
    <fieldset>
      <legend className="mb-2 text-lg font-extrabold">Payout network</legend>
      <div className="grid grid-cols-3 gap-2">{NETWORKS.map((item) => <button key={item} type="button" aria-label={`Payout ${item}`} aria-pressed={network === item} onClick={() => setNetwork(item)} className={`min-h-14 rounded-2xl border-[3px] px-2 font-extrabold ${network === item ? "border-emerald-900 bg-green-200" : "border-slate-500 bg-white"}`}>{item}</button>)}</div>
    </fieldset>
    <label className="font-bold">Payout MoMo number<input value={number} onChange={(event) => setNumber(event.target.value)} type="tel" inputMode="tel" className="mt-1 h-14 w-full rounded-2xl border-[3px] border-slate-500 px-3 text-xl" /></label>
    <p className="text-base font-extrabold text-emerald-900">Account name will appear after verification.</p>
    <p className="text-base text-slate-800">Payouts come on Paystack&apos;s schedule, not the moment a customer pays.</p>
    <div className="flex-1" />
    <PosPrimaryButton type="button" onClick={async () => { await setPreference("momoReceivingNumber", number); await setPreference("momoReceivingNetwork", network); onNavigate("MoMoPayment", { ...params, returnToMomo: true, paystackSetUp: true }); }}><Check size={28} aria-hidden="true" />Save and verify</PosPrimaryButton>
  </PosPage>;
}

export function MoMoPayment({ params = {}, onBack, onNavigate }) {
  const [network, setNetwork] = useState("MTN");
  const [phone, setPhone] = useState(params.customer?.phone ?? params.phone ?? "");
  const paymentAmountPesewas = getMomoAmountPesewas(params);
  const feePesewas = MOMO_CONFIG.phoneRequestFeePesewas;
  const merchantReceivesPesewas = Math.max(0, paymentAmountPesewas - feePesewas);
  return <PosPage className="flex flex-col gap-3">
    <BackTitle title="MoMo payment" onBack={onBack} />
    <section className="rounded-[20px] bg-emerald-900 p-3 text-white">
      <p className="text-lg font-bold text-white">Customer pays</p>
      <p className="text-4xl font-extrabold text-white">{formatGhs(paymentAmountPesewas)}</p>
      <p className="text-base text-white">Fee {formatGhs(feePesewas)} · You receive {formatGhs(merchantReceivesPesewas)}</p>
    </section>
    <fieldset>
      <legend className="mb-2 text-lg font-extrabold">Customer&apos;s network</legend>
      <div className="grid grid-cols-3 gap-2">{NETWORKS.map((item) => <button key={item} type="button" aria-label={`Network ${item}`} aria-pressed={network === item} onClick={() => setNetwork(item)} className={`min-h-14 rounded-xl border-[3px] px-2 font-bold ${network === item ? "border-emerald-900 bg-green-200" : "border-slate-500 bg-white"}`}>{item}</button>)}</div>
    </fieldset>
    <label className="font-bold">Customer&apos;s MoMo number<input aria-label="Customer's MoMo number" value={phone} onChange={(event) => setPhone(event.target.value)} type="tel" inputMode="tel" className="mt-1 h-14 w-full rounded-xl border-[3px] border-slate-500 px-3 text-xl" /></label>
    <PosPrimaryButton type="button" onClick={() => onNavigate(network === "Telecel" ? "MoMoCode" : "MoMoWaiting", { ...params, network, phone })}><Smartphone size={24} aria-hidden="true" />Send request</PosPrimaryButton>
    <button type="button" onClick={() => onNavigate("MoMoDirect", params)} className="min-h-10 border-0 bg-transparent font-extrabold text-emerald-900 underline">Customer already paid me directly</button>
    <p className="-mt-2 text-center text-sm text-slate-700">That sale is marked Not verified.</p>
  </PosPage>;
}

export function MoMoWaiting({ params = {}, onCancel }) {
  const paymentAmountPesewas = getMomoAmountPesewas(params);
  const [secondsRemaining, setSecondsRemaining] = useState(120);
  useEffect(() => {
    if (secondsRemaining <= 0) return undefined;
    const timer = window.setInterval(() => setSecondsRemaining((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [secondsRemaining]);
  const minutes = Math.floor(secondsRemaining / 60);
  const seconds = String(secondsRemaining % 60).padStart(2, "0");
  const phone = params.phone ?? params.customer?.phone ?? "";
  const network = params.network ?? MOMO_CONFIG.defaultNetwork;
  return <PosPage className="flex flex-col gap-3">
    <div className="pt-1 text-center">
      <div className="mx-auto mb-2 grid h-24 w-24 place-items-center rounded-full border-[3px] border-amber-700 bg-amber-100 text-amber-800"><Clock3 size={56} aria-hidden="true" /></div>
      <h1 className="text-[26px] font-extrabold">Waiting for customer</h1>
      <p className="mt-1 text-lg text-slate-700">We sent a request to {phone || "the customer's number"} ({network}). Ask the customer to approve it on their phone.</p>
      <p className="mt-2 text-4xl font-extrabold">{formatGhs(paymentAmountPesewas)}</p>
      <span className="mt-1 inline-block rounded-xl border-2 border-amber-700 bg-amber-100 px-3 py-1 text-lg font-extrabold text-amber-800">Expires in {minutes}:{seconds}</span>
    </div>
    <div className="grid grid-cols-2 gap-2">
      <button type="button" disabled={secondsRemaining > 0} className="min-h-14 rounded-2xl border-2 border-slate-300 bg-slate-100 px-2 font-extrabold text-slate-500 disabled:opacity-100">Resend request</button>
      <button type="button" onClick={onCancel} className="min-h-14 rounded-2xl border-2 border-rose-900 bg-white px-2 font-extrabold text-rose-900">Cancel request</button>
    </div>
    <p className="text-center text-base text-slate-700">Nothing is recorded until Paystack confirms the payment.</p>
  </PosPage>;
}

export function MoMoCode({ params = {}, onBack, onNavigate }) {
  const [code, setCode] = useState("");
  return <PosPage className="flex flex-col gap-3">
    <BackTitle title="Enter the code" onBack={onBack} />
    <label className="font-bold">Code<input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" className="mt-1 h-14 w-full rounded-xl border-2 border-slate-500 px-3 text-xl" /></label>
    <PosPrimaryButton type="button" disabled={!code.trim()} onClick={() => onNavigate("MoMoWaiting", { ...params, code })}>Submit code</PosPrimaryButton>
  </PosPage>;
}

export function MoMoNotCompleted({ params = {}, onBack, onNavigate }) {
  return <PosPage className="flex flex-col gap-3"><BackTitle title="Payment not completed" onBack={onBack} /><p className="text-lg font-semibold">The phone request was not completed. Nothing was saved.</p><PosPrimaryButton type="button" onClick={() => onNavigate("MoMoPayment", params)}>Try again</PosPrimaryButton><PosSecondaryButton type="button" onClick={onBack}>Pay another way</PosSecondaryButton><PosSecondaryButton type="button" onClick={() => onNavigate("Home")}>Cancel sale</PosSecondaryButton></PosPage>;
}
