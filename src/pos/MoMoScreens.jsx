import { useEffect, useRef, useState } from "react";
import { Check, Clock3, Copy, Send, Smartphone, UserRound } from "lucide-react";
import { setPreference } from "../db/preferences.js";
import { formatGhs } from "../lib/money.js";
import { secondsUntil } from "../lib/countdown.js";
import { MOMO_CONFIG, PHONE_REQUEST_ENABLED, RECEIVING_NETWORKS, getMerchantMomoSettings, maskPhoneNumber, normalizeReceivingNumber, recordMomoLastUsed, saveReceivingNumber } from "./momoConfig.js";
import { getMomoAmountPesewas } from "./paymentAmount.js";
import { PosCard, PosPage, PosPrimaryButton, PosSecondaryButton, PosStatusTag, PosBackButton } from "./PosComponents.jsx";
import SaveAttemptNotice from "./SaveAttemptNotice.jsx";
import { useSaveAttempt } from "./useSaveAttempt.js";
import { isSaveOutcomeUnknown } from "../lib/saveAttempt.js";
import { useBackBlock } from "./browserBack.js";

const NETWORKS = ["MTN", "Telecel", "AirtelTigo"];

function BackTitle({ title, onBack }) {
  return <div className="flex items-center gap-3"><PosBackButton onClick={onBack} /><h1 className="text-2xl font-extrabold">{title}</h1></div>;
}

// The tiles on 61 open the next screen; they are links, not toggles (E10: no aria-pressed).
function ChoiceTile({ icon: Icon, title, detail, disabled = false, highlighted = false, onClick, children }) {
  return <button type="button" disabled={disabled} onClick={onClick} className={`flex min-h-[92px] items-center gap-3 rounded-[20px] border-[3px] p-3 text-left disabled:cursor-not-allowed disabled:opacity-60 ${highlighted ? "border-emerald-900 bg-green-200" : "border-slate-900 bg-white"}`}>
    <Icon size={30} className="shrink-0 text-emerald-900" aria-hidden="true" />
    <span className="min-w-0 flex-1"><b className="block text-xl">{title}</b><span className="text-base text-slate-800">{detail}</span>{children}</span>
  </button>;
}

export function MoMoChoice({ params = {}, onBack, onNavigate, onReplace }) {
  const [settings, setSettings] = useState({ defaultMethod: "ask", lastUsed: "", phoneRequestAvailable: false });
  useEffect(() => { getMerchantMomoSettings().then(setSettings).catch((error) => console.error("Could not load MoMo settings.", error)); }, []);
  // "When I tap MoMo" on 63 can skip this screen (K12). Always: phone request falls back to Ask
  // (this screen) unless Phone request is available: flag on and a payout saved (getMerchantMomoSettings).
  useEffect(() => {
    if (settings.defaultMethod === "direct") onReplace("MoMoDirect", { ...params, momoMethod: "direct" });
    else if (settings.defaultMethod === "phone") onReplace("MoMoPayment", { ...params, momoMethod: "paystack", returnToMomo: true });
  }, [settings.defaultMethod]);
  // Only a method that was actually used before is tagged Last used (A5).
  const lastUsed = settings.lastUsed;
  const paymentAmountPesewas = getMomoAmountPesewas(params);
  return <PosPage className="flex flex-col gap-3">
    <BackTitle title="MoMo payment" onBack={onBack} />
    <p className="text-[22px] font-extrabold">Customer pays {formatGhs(paymentAmountPesewas)}</p>
    <h2 className="text-xl font-extrabold">How will they pay?</h2>
    <ChoiceTile icon={Send} title="Customer sends to my number" detail="Free. You check the MoMo message." highlighted={lastUsed === "direct"} onClick={() => { void recordMomoLastUsed("direct"); onNavigate("MoMoDirect", { ...params, momoMethod: "direct" }); }}>
      {lastUsed === "direct" && <PosStatusTag compact>Last used</PosStatusTag>}
    </ChoiceTile>
    <ChoiceTile icon={Smartphone} title="Phone request" detail={PHONE_REQUEST_ENABLED ? `Customer approves on their phone. Confirmed by itself.${MOMO_CONFIG.phoneRequestFeePesewas > 0 ? ` Fee ${formatGhs(MOMO_CONFIG.phoneRequestFeePesewas)}.` : ""}` : "Not available yet"} disabled={!PHONE_REQUEST_ENABLED} highlighted={lastUsed === "phone"} onClick={() => { void recordMomoLastUsed("phone"); onNavigate(settings.phoneRequestAvailable ? "MoMoPayment" : "MoMoSetup", { ...params, momoMethod: "paystack", returnToMomo: true }); }}>
      {lastUsed === "phone" && <PosStatusTag compact>Last used</PosStatusTag>}
    </ChoiceTile>
    <p className="text-sm font-medium text-slate-800">Change the usual choice in Settings.</p>
  </PosPage>;
}

export function MoMoDirect({ params = {}, onBack, onConfirm, onPick }) {
  const [settings, setSettings] = useState({ number: "", network: "" });
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  useBackBlock(saving);
  const [saveError, setSaveError] = useState("");
  const savingRef = useRef(false);
  const saveAttempt = useSaveAttempt();
  const paymentAmountPesewas = getMomoAmountPesewas(params);
  async function confirmReceived() {
    if (savingRef.current || !settings.number) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError("");
    const details = { ...params, momoMethod: "direct", verification: "merchant_confirmed" };
    try {
      // D11: only a real save (not a pick) gets an attempt key.
      await (params.pickOnly
        ? onPick(details)
        : saveAttempt.run(details, (attemptId) => onConfirm({ ...details, attemptId })));
    } catch (saveFailure) {
      // Release the guard only on failure; on success this screen is replaced.
      savingRef.current = false;
      setSaving(false);
      setSaveError(isSaveOutcomeUnknown(saveFailure) ? "" : "Could not save the payment. Check it was not saved, then try again.");
    }
  }
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
    <p className="text-base font-semibold">Wait for the MoMo message. Check the amount and the name before you tap. Check your MoMo balance, not only the SMS.</p>
    {saveError && <p role="alert" className="text-base font-bold text-rose-900">{saveError}</p>}
    <SaveAttemptNotice saveAttempt={saveAttempt} busy={saving} onTryAgain={() => void confirmReceived()} />
    {!settings.number && <p role="status" className="text-base font-bold text-rose-900">Set your MoMo number in Settings first: Menu › Settings › MoMo payments.</p>}
    <PosPrimaryButton type="button" disabled={saving || !settings.number} onClick={() => void confirmReceived()}><Check size={28} aria-hidden="true" />Money received</PosPrimaryButton>
    <p className="text-sm font-medium">Saved as MoMo · you confirmed.</p>
  </PosPage>;
}

export function PaymentSettings({ onBack, onNavigate }) {
  const [settings, setSettings] = useState({ number: "", network: MOMO_CONFIG.defaultNetwork, defaultMethod: "ask" });
  const [enabled, setEnabled] = useState(false);
  // The stored choice is only rewritten when the owner taps the radio group. An unavailable "phone"
  // shows as Ask on screen but stays stored when something else (number, network) is saved.
  const [tapChoiceChanged, setTapChoiceChanged] = useState(false);
  const [numberInput, setNumberInput] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const savingRef = useRef(false);
  useEffect(() => { getMerchantMomoSettings().then((value) => { setSettings(value); setEnabled(Boolean(value.number)); setNumberInput(value.number); }).catch((loadError) => console.error("Could not load payment settings.", loadError)); }, []);
  // The contract never shows a zero fee: the fee text needs Phone request on and a real fee above zero.
  const showPhoneFee = PHONE_REQUEST_ENABLED && MOMO_CONFIG.phoneRequestFeePesewas > 0;
  const normalizedNumber = enabled ? normalizeReceivingNumber(numberInput) : "";
  const numberChanged = enabled && normalizedNumber !== null && normalizedNumber !== settings.number;
  async function save() {
    if (savingRef.current) return;
    setError("");
    if (enabled && normalizedNumber === null) {
      setError("Enter a Ghana mobile number, like 024 123 4567.");
      return;
    }
    // A new or changed number is confirmed, masked, before it is saved.
    if (numberChanged && !confirming) {
      setConfirming(true);
      return;
    }
    savingRef.current = true;
    try {
      await saveReceivingNumber({ enabled, number: numberInput, network: settings.network });
      if (tapChoiceChanged) await setPreference("momoDefault", settings.defaultMethod);
      setSaved(true);
      onBack();
    } catch (saveError) {
      savingRef.current = false;
      setConfirming(false);
      setError(saveError instanceof TypeError ? saveError.message : "Could not save. Please try again.");
    }
  }
  const maskedLine = enabled && (normalizedNumber ?? settings.number) ? `Customers will send to ${maskPhoneNumber(normalizedNumber ?? settings.number)} · ${settings.network}` : "";
  const tapOptions = [["ask", "Ask me each time"], ["direct", "Always: customer sends to my number"], ...(PHONE_REQUEST_ENABLED ? [["phone", "Always: phone request"]] : [])];
  return <PosPage className="flex flex-col gap-3">
    <BackTitle title="MoMo payments" onBack={onBack} />
    <PosCard>
      <div className="flex min-h-12 items-center justify-between gap-3">
        <span className="min-w-0 text-lg font-extrabold">Customer sends to my number</span>
        <button type="button" role="switch" aria-checked={enabled} aria-label="Customer sends to my number" onClick={() => { setEnabled(!enabled); setConfirming(false); }} className={`relative h-8 w-14 shrink-0 rounded-full border-2 ${enabled ? "border-emerald-900 bg-emerald-900" : "border-slate-500 bg-slate-300"}`}>
          <span aria-hidden="true" className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow ${enabled ? "left-7" : "left-0.5"}`} />
        </button>
      </div>
      {enabled && <>
        <label className="mt-2 block font-bold">My MoMo number<input aria-label="My MoMo number" value={numberInput} onChange={(event) => { setNumberInput(event.target.value); setConfirming(false); }} type="tel" inputMode="tel" autoComplete="tel" placeholder="024 123 4567" className="mt-1 h-14 w-full rounded-xl border-[3px] border-slate-500 px-3 text-xl" /></label>
        <fieldset className="mt-2">
          <legend className="mb-2 text-lg font-extrabold">Network</legend>
          <div className="grid grid-cols-3 gap-2">{RECEIVING_NETWORKS.map((item) => <button key={item} type="button" aria-pressed={settings.network === item} onClick={() => { setSettings((current) => ({ ...current, network: item })); setConfirming(false); }} className={`min-h-14 min-w-0 rounded-xl border-[3px] px-1 text-sm font-bold ${settings.network === item ? "border-emerald-900 bg-green-200" : "border-slate-500 bg-white"}`}>{item}</button>)}</div>
        </fieldset>
        {maskedLine && <p className="mt-2 text-base font-bold text-emerald-900">{maskedLine}</p>}
      </>}
    </PosCard>
    {confirming && <PosCard className="border-amber-700 bg-amber-50">
      <p role="alert" className="text-lg font-extrabold">Customers will send money to {maskPhoneNumber(normalizedNumber)} ({settings.network}). Is this your number?</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <PosPrimaryButton type="button" onClick={() => void save()}><Check size={24} aria-hidden="true" />Yes, save</PosPrimaryButton>
        <PosSecondaryButton type="button" onClick={() => setConfirming(false)}>Change</PosSecondaryButton>
      </div>
    </PosCard>}
    {error && <p role="alert" className="text-base font-bold text-rose-900">{error}</p>}
    <PosCard>
      <div data-row="phone-request" className="flex min-h-12 items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-extrabold">Phone request</h2>
          <p className="text-base">Confirmed by itself.{showPhoneFee ? ` Fee ${formatGhs(MOMO_CONFIG.phoneRequestFeePesewas)} per payment.` : ""}</p>
        </div>
        {PHONE_REQUEST_ENABLED
          ? <button type="button" aria-label="Phone request: set up" onClick={() => onNavigate("MoMoSetup")} className="shrink-0 rounded-xl px-2 py-3 text-lg font-extrabold text-emerald-900">Set up ›</button>
          : <PosStatusTag>Coming soon</PosStatusTag>}
      </div>
    </PosCard>
    <h2 className="text-lg font-extrabold">When I tap MoMo</h2>
    <PosCard className="!p-0">
      <div role="radiogroup" aria-label="When I tap MoMo" className="divide-y divide-slate-200">
        {tapOptions.map(([value, label]) => {
          const chosen = settings.defaultMethod === value;
          const blocked = value === "phone" && !settings.phoneRequestAvailable;
          return <button key={value} type="button" role="radio" aria-checked={chosen} aria-disabled={blocked ? true : undefined} onClick={blocked ? undefined : () => { setTapChoiceChanged(true); setSettings((current) => ({ ...current, defaultMethod: value })); }} className={`flex min-h-20 w-full items-center gap-3 px-4 py-3 text-left text-lg font-extrabold first:rounded-t-2xl last:rounded-b-2xl ${blocked ? "cursor-not-allowed bg-slate-100 text-slate-500" : chosen ? "bg-green-100 text-slate-950" : "bg-white text-slate-950"}`}>
            <span aria-hidden="true" className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${chosen ? "border-emerald-900 bg-emerald-900" : "border-slate-500 bg-white"}`}>{chosen && <span className="h-2 w-2 rounded-full bg-white" />}</span>
            <span className="min-w-0"><span className="block">{label}</span>{blocked && <span className="block text-sm font-semibold">Set up phone request first</span>}</span>
          </button>;
        })}
      </div>
    </PosCard>
    {saved && <p role="status">Saved.</p>}
    <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t-[3px] border-slate-900 bg-white px-4 pt-3 lg:left-60">
      <div className="mx-auto max-w-3xl"><PosPrimaryButton type="button" onClick={() => void save()} className="h-[60px] min-h-0 rounded-[18px]"><Check size={28} aria-hidden="true" />Save</PosPrimaryButton></div>
    </div>
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
      <div className="flex flex-wrap gap-2">{NETWORKS.map((item) => <button key={item} type="button" aria-label={`Payout ${item}`} aria-pressed={network === item} onClick={() => setNetwork(item)} className={`min-h-14 min-w-[6.5rem] flex-1 rounded-2xl border-[3px] px-2 font-extrabold ${network === item ? "border-emerald-900 bg-green-200" : "border-slate-500 bg-white"}`}>{item}</button>)}</div>
    </fieldset>
    <label className="font-bold">Payout MoMo number<input value={number} onChange={(event) => setNumber(event.target.value)} type="tel" inputMode="tel" className="mt-1 h-14 w-full rounded-2xl border-[3px] border-slate-500 px-3 text-xl" /></label>
    <p className="text-base text-slate-800">Payouts come on Paystack&apos;s schedule, not the moment a customer pays.</p>
    <div className="flex-1" />
    <PosPrimaryButton type="button" onClick={async () => {
      // The payout account is separate from the number customers send to directly (62).
      await setPreference("paystackPayoutNumber", number);
      await setPreference("paystackPayoutNetwork", network);
      if (params.returnToMomo) onNavigate("MoMoPayment", { ...params, paystackSetUp: true });
      else onBack();
    }}><Check size={28} aria-hidden="true" />Save and verify</PosPrimaryButton>
  </PosPage>;
}

export function MoMoPayment({ params = {}, onBack, onNavigate }) {
  const [network, setNetwork] = useState("MTN");
  const [phone, setPhone] = useState(params.customer?.phone ?? params.phone ?? "");
  const paymentAmountPesewas = getMomoAmountPesewas(params);
  // The contract never shows a zero fee: the fee shows only with Phone request on and a fee above zero.
  const showFee = PHONE_REQUEST_ENABLED && MOMO_CONFIG.phoneRequestFeePesewas > 0;
  const feePesewas = showFee ? MOMO_CONFIG.phoneRequestFeePesewas : 0;
  const merchantReceivesPesewas = Math.max(0, paymentAmountPesewas - feePesewas);
  return <PosPage className="flex flex-col gap-3">
    <BackTitle title="MoMo payment" onBack={onBack} />
    <section className="rounded-[20px] bg-emerald-900 p-3 text-white">
      <p className="text-lg font-bold text-white">Customer pays</p>
      <p className="text-4xl font-extrabold text-white">{formatGhs(paymentAmountPesewas)}</p>
      <p className="text-base text-white">{showFee ? `Fee ${formatGhs(feePesewas)} · ` : ""}You receive {formatGhs(merchantReceivesPesewas)}</p>
    </section>
    <fieldset>
      <legend className="mb-2 text-lg font-extrabold">Customer&apos;s network</legend>
      <div className="flex flex-wrap gap-2">{NETWORKS.map((item) => <button key={item} type="button" aria-label={`Network ${item}`} aria-pressed={network === item} onClick={() => setNetwork(item)} className={`min-h-14 min-w-[6.5rem] flex-1 rounded-xl border-[3px] px-2 font-bold ${network === item ? "border-emerald-900 bg-green-200" : "border-slate-500 bg-white"}`}>{item}</button>)}</div>
    </fieldset>
    <label className="font-bold">Customer&apos;s MoMo number<input aria-label="Customer's MoMo number" value={phone} onChange={(event) => setPhone(event.target.value)} type="tel" inputMode="tel" className="mt-1 h-14 w-full rounded-xl border-[3px] border-slate-500 px-3 text-xl" /></label>
    <PosPrimaryButton type="button" disabled={!PHONE_REQUEST_ENABLED} onClick={() => onNavigate(network === "Telecel" ? "MoMoCode" : "MoMoWaiting", { ...params, network, phone })}><Smartphone size={24} aria-hidden="true" />Send request</PosPrimaryButton>
    <button type="button" onClick={() => onNavigate("MoMoDirect", params)} className="min-h-10 border-0 bg-transparent font-extrabold text-emerald-900 underline">Customer already paid me directly</button>
    <p className="-mt-2 text-center text-sm text-slate-700">Saved as MoMo · you confirmed.</p>
  </PosPage>;
}

// Wait before Resend request is allowed. The length is an open owner decision.
const MOMO_WAIT_SECONDS = 120;

export function MoMoWaiting({ params = {}, onCancel }) {
  const paymentAmountPesewas = getMomoAmountPesewas(params);
  // E5: the wait is an end time, recomputed from the clock on each tick, so it stays right
  // when the browser slows a background tab.
  const [expiresAt, setExpiresAt] = useState(() => Date.now() + MOMO_WAIT_SECONDS * 1000);
  const [now, setNow] = useState(() => Date.now());
  const secondsRemaining = secondsUntil(expiresAt, now);
  const expired = secondsRemaining <= 0;
  useEffect(() => {
    if (expired) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt, expired]);
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
      {/* E11: looks disabled only while disabled. Restarting the wait is all it can do until a
          backend sends the request again; it stays disabled while Phone request is off. */}
      <button type="button" disabled={secondsRemaining > 0 || !PHONE_REQUEST_ENABLED} onClick={() => { setExpiresAt(Date.now() + MOMO_WAIT_SECONDS * 1000); setNow(Date.now()); }} className="min-h-14 rounded-2xl border-2 border-emerald-900 bg-white px-2 font-extrabold text-emerald-900 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-100 disabled:text-slate-500">Resend request</button>
      <button type="button" onClick={onCancel} className="min-h-14 rounded-2xl border-2 border-rose-900 bg-white px-2 font-extrabold text-rose-900">Cancel request</button>
    </div>
    <p className="text-center text-base text-slate-700">Nothing is recorded until Paystack confirms the payment.</p>
  </PosPage>;
}

export function MoMoCode({ params = {}, onBack, onNavigate }) {
  const [code, setCode] = useState("");
  return <PosPage className="flex flex-col gap-3">
    <BackTitle title="Enter the code" onBack={onBack} />
    {/* 58 is reached only from a customer sale (56), so the customer wording applies (K15). */}
    <p className="text-lg font-semibold">The customer got a code by SMS. Ask them for it.</p>
    <label className="font-bold">Code<input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" className="mt-1 h-14 w-full rounded-xl border-2 border-slate-500 px-3 text-xl" /></label>
    {/* L3: the code stays in this screen's own state. It is not copied into the route params,
        where it would sit in the history. The backend call will send it from here. */}
    <PosPrimaryButton type="button" disabled={!code.trim()} onClick={() => onNavigate("MoMoWaiting", params)}>Submit code</PosPrimaryButton>
    <p className="text-base text-slate-700">Code not arriving? Go back and send the request again.</p>
  </PosPage>;
}

export function MoMoNotCompleted({ params = {}, onBack, onNavigate, onPayAnotherWay }) {
  return <PosPage className="flex flex-col gap-3"><BackTitle title="Payment not completed" onBack={onBack} /><p className="text-lg font-semibold">The phone request was not completed. Nothing was saved.</p><PosPrimaryButton type="button" onClick={() => onNavigate("MoMoPayment", params)}>Try again</PosPrimaryButton><PosSecondaryButton type="button" onClick={onPayAnotherWay}>Pay another way</PosSecondaryButton><PosSecondaryButton type="button" onClick={() => onNavigate("Home")}>Cancel sale</PosSecondaryButton></PosPage>;
}
