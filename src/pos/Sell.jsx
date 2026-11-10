import { useEffect, useRef, useState } from "react";
import { Banknote, Check, Delete, Plus, Smartphone, UserRound } from "lucide-react";
import { recordCashSale } from "../db/sales.js";
import { isSaveOutcomeUnknown, isSaveTimeout } from "../lib/saveAttempt.js";
import { formatGhs, toPesewas } from "../lib/money.js";
import { normalizeSaleItems, totalSaleItemsPesewas } from "../lib/saleItems.js";
import { requestBackgroundSync } from "../lib/syncRegistration.js";
import { PosCard, SplitIcons, PosPage, PosPrimaryButton } from "./PosComponents.jsx";
import { posText as t } from "./i18n.js";
import { useLargeAmountConfirm } from "./LargeAmountConfirm.jsx";
import SaveAttemptNotice from "./SaveAttemptNotice.jsx";
import { useSaveAttempt } from "./useSaveAttempt.js";

const paymentChoices = [
  { value: "cash", label: "sell.cash", icon: Banknote },
  { value: "momo", label: "sell.momo", icon: Smartphone },
  { value: "credit", label: "sell.owe", icon: UserRound }
];

export default function Sell({ params = {}, onNavigate, recordSale = recordCashSale }) {
  const [amount, setAmount] = useState(Number.isSafeInteger(params.amountPesewas) && params.amountPesewas > 0
    ? (params.amountPesewas / 100).toFixed(2)
    : "");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitLock = useRef(false);
  const saveAttempt = useSaveAttempt();
  const largeAmount = useLargeAmountConfirm();
  const saleItems = normalizeSaleItems(params.saleItems ?? []);
  const amountPesewas = toPesewas(amount);
  const itemTotalPesewas = totalSaleItemsPesewas(saleItems);
  const hasSaleItems = saleItems.length > 0;
  const canSave = Number.isSafeInteger(amountPesewas) && amountPesewas > 0 &&
    (!hasSaleItems || amountPesewas === itemTotalPesewas);

  useEffect(() => {
    if (Number.isSafeInteger(params.amountPesewas)) {
      setAmount(params.amountPesewas > 0 ? (params.amountPesewas / 100).toFixed(2) : "");
    }
  }, [params.amountPesewas]);

  function appendDigit(digit) {
    if (hasSaleItems) return;
    setError("");
    setAmount((current) => {
      if (digit === "backspace") return current.slice(0, -1);
      if (digit === "00" && !current) return "0";
      if (digit === "." && current.includes(".")) return current;
      const next = `${current}${digit}`;
      const [whole, fraction] = next.split(".");
      return fraction?.length > 2 ? current : whole.length > 8 ? current : next;
    });
  }

  async function saveSale(confirmed = false) {
    if (submitLock.current || !canSave) return;
    // Brief 3.12: a large sale asks first, before the save starts and before the attempt key is used.
    if (!confirmed && largeAmount.guard(amountPesewas, () => void saveSale(true))) return;
    submitLock.current = true;
    setBusy(true);
    setError("");
    try {
      // D11: the attempt key follows this content; Try again with the same sale reuses it.
      const content = {
        amountPesewas,
        cashReceivedPesewas: paymentMethod === "cash" ? amountPesewas : 0,
        momoReceivedPesewas: paymentMethod === "momo" ? amountPesewas : 0,
        saleItems
      };
      const transaction = await saveAttempt.run(content, (attemptId) => recordSale({ ...content, attemptId }));
      void requestBackgroundSync();
      onNavigate("SaleRecorded", { transaction });
    } catch (saveError) {
      console.error("Could not save the sale.", saveError);
      setError(isSaveOutcomeUnknown(saveError)
        ? ""
        : isSaveTimeout(saveError)
        ? t("sell.saveTimedOut")
        : saveError?.name === "QuotaExceededError"
          ? t("sell.storageFull")
          : t("sell.saveFailed"));
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    function handleKeyboard(event) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (largeAmount.open) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select, button"))) return;
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        appendDigit(event.key);
      } else if (event.key === "." || event.key === ",") {
        event.preventDefault();
        appendDigit(".");
      } else if (event.key === "Backspace") {
        event.preventDefault();
        appendDigit("backspace");
      } else if (event.key === "Enter" && canSave && !busy) {
        event.preventDefault();
        void saveSale();
      }
    }

    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [amount, canSave, busy, paymentMethod, largeAmount.open]);

  return (
    <PosPage style={{ minHeight: "calc(100dvh - 75px)", paddingTop: 14, paddingBottom: 96 }} className="flex flex-col gap-3 pb-32 lg:max-w-5xl lg:justify-center lg:pb-10">
      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)] lg:items-start lg:gap-6">
        <div className="flex flex-col gap-3">
          <PosCard className="amount-fit-container rounded-[20px] px-4 py-3 text-right lg:px-6 lg:py-5">
            <p className="text-base font-bold text-slate-700 lg:text-lg">{t("sell.customerPays")}</p>
            <output aria-live="polite" className="amount-fit font-extrabold">{formatGhs(amountPesewas ?? 0)}</output>
          </PosCard>
          <div className="grid grid-cols-3 gap-2 lg:gap-3" aria-label={t("sell.enterAmount")}>
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0"].map((digit) => (
              <button key={digit} type="button" disabled={hasSaleItems} onClick={() => appendDigit(digit)} style={{ fontSize: 28, fontWeight: 800 }} className="h-[62px] rounded-2xl border-2 border-slate-500 bg-white disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 lg:h-[76px]">{digit}</button>
            ))}
            <button type="button" disabled={hasSaleItems} onClick={() => appendDigit("backspace")} aria-label={t("sell.deleteLastDigit")} className="flex h-[62px] items-center justify-center rounded-2xl bg-slate-300 text-slate-950 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 lg:h-[76px]">
              <Delete size={28} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-3 lg:pt-1">
          <button
            type="button"
            onClick={() => onNavigate("SellWithItems", { amountPesewas, saleItems })}
            className="inline-flex h-12 items-center justify-center gap-1 self-center rounded-xl px-3 py-2 text-base font-bold text-emerald-900 underline decoration-2 underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800"
          >
            <Plus size={20} aria-hidden="true" /> {t("sell.addItems")}
          </button>
          <div className="grid grid-cols-4 gap-1 sm:gap-2 lg:gap-3">
            {paymentChoices.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                aria-pressed={paymentMethod === value}
                onClick={() => {
                  if (value === "credit") {
                    if (canSave && !busy) onNavigate("WhoOwesYou", { amountPesewas, saleItems });
                    else setError(t("sell.enterAmountFirst"));
                  } else if (value === "momo") {
                    if (canSave && !busy) onNavigate("MoMoChoice", { amountPesewas, saleItems });
                    else setError(t("sell.enterAmountFirst"));
                  } else setPaymentMethod(value);
                }}
                disabled={value === "credit" && (!canSave || busy)}
                className={`flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-[14px] border-2 px-1 text-xs font-extrabold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 sm:h-20 sm:gap-1 sm:rounded-2xl sm:text-sm lg:h-24 lg:rounded-[18px] lg:border-[3px] lg:px-2 lg:text-[17px] ${
                  paymentMethod === value ? "border-emerald-900 bg-green-200 text-slate-950" : "border-slate-500 bg-white text-slate-900"
                }`}
              >
                <Icon size={18} className="shrink-0 sm:h-5 sm:w-5 lg:h-6 lg:w-6" aria-hidden="true" />
                <span className="w-full min-w-0 truncate text-center">{t(label)}</span>
              </button>
            ))}
            <button
              type="button"
              aria-label={t("sell.split")}
              disabled={!canSave || busy}
              onClick={() => {
                if (!canSave || busy) return;
                onNavigate("SplitPayment", { amountPesewas, saleItems });
              }}
              className="flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-[14px] border-2 border-emerald-900 bg-white px-1 text-xs font-extrabold text-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 sm:h-20 sm:gap-1 sm:rounded-2xl sm:text-sm lg:h-24 lg:rounded-[18px] lg:border-[3px] lg:px-2 lg:text-[17px]"
            >
              <SplitIcons withOwe size={11} />
              <span className="w-full min-w-0 truncate text-center sm:hidden">Split</span>
              <span className="hidden w-full min-w-0 truncate text-center sm:inline">{t("sell.split")}</span>
            </button>
          </div>
          {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 text-base font-semibold text-rose-950">{error}</p>}
          <SaveAttemptNotice saveAttempt={saveAttempt} busy={busy} onTryAgain={() => void saveSale(true)} />
          <PosPrimaryButton type="button" onClick={() => void saveSale()} disabled={!canSave || busy} className="mb-4 h-[68px] min-h-0 rounded-[20px] border-0 text-[26px] lg:mb-0 lg:h-20 lg:text-3xl">
            <Check size={32} aria-hidden="true" /> {busy ? t("sell.saving") : t("sell.done")}
          </PosPrimaryButton>
        </div>
      </div>
      {largeAmount.dialog}
    </PosPage>
  );
}
