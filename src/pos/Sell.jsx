import { useEffect, useRef, useState } from "react";
import { Banknote, Check, Smartphone, UserRound } from "lucide-react";
import { recordCashSale } from "../db/sales.js";
import { isSaveOutcomeUnknown, isSaveTimeout } from "../lib/saveAttempt.js";
import { formatGhs, toPesewas } from "../lib/money.js";
import { normalizeSaleItems, totalSaleItemsPesewas } from "../lib/saleItems.js";
import { requestBackgroundSync } from "../lib/syncRegistration.js";
import { AddButton, PosCard, SplitIcons, PosPage, PosPrimaryButton } from "./PosComponents.jsx";
import { posText as t } from "./i18n.js";
import { useLargeAmountConfirm } from "./LargeAmountConfirm.jsx";
import SaveAttemptNotice from "./SaveAttemptNotice.jsx";
import { useSaveAttempt } from "./useSaveAttempt.js";
import { useBackBlock } from "./browserBack.js";
import { useFormErrors } from "./formErrors.js";
import { getSplitPaymentParams } from "./routes.js";
import AmountKeypad from "./AmountKeypad.jsx";
import { pesewasToAmountText, pressAmountKey } from "./amountKeypad.js";

const paymentChoices = [
  { value: "cash", label: "sell.cash", icon: Banknote },
  { value: "momo", label: "sell.momo", icon: Smartphone },
  { value: "credit", label: "sell.owe", icon: UserRound }
];

// Wiring 15: the draft (what is typed, Cash or MoMo, the added items) lives in the route parameters, like the
// split screen, so it is still there when the owner comes back with Back. amountText is the pad as typed.
export default function Sell({ params = {}, onNavigate, onUpdateParams, recordSale = recordCashSale }) {
  const [amount, setAmount] = useState(typeof params.amountText === "string"
    ? params.amountText
    : Number.isSafeInteger(params.amountPesewas) && params.amountPesewas > 0
      ? pesewasToAmountText(params.amountPesewas)
      : "");
  const [paymentMethod, setPaymentMethod] = useState(params.paymentMethod === "momo" ? "momo" : "cash");
  const [busy, setBusy] = useState(false);
  useBackBlock(busy);
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
  // rules_global.form_errors: shown after MoMo or Owe with no amount, gone once there is one.
  // The message names what the tap needed: credit (Owe) or MoMo (decided 16 Nov 2026).
  const amountErrors = useFormErrors([
    ["credit", canSave ? "" : t("sell.enterAmountFirst")],
    ["momo", canSave ? "" : t("sell.enterAmountBeforeMomo")]
  ]);

  // An amount that arrives from outside (not the one typed here) replaces what is on the pad.
  useEffect(() => {
    if (Number.isSafeInteger(params.amountPesewas) && params.amountPesewas !== (toPesewas(amount) ?? 0)) {
      setAmount(pesewasToAmountText(params.amountPesewas));
    }
  }, [params.amountPesewas]);

  // Keep the draft in the route parameters (never the save attempt key: a restored screen starts a new one).
  useEffect(() => {
    const pesewas = Number.isSafeInteger(amountPesewas) && amountPesewas > 0 ? amountPesewas : 0;
    if (!onUpdateParams) return;
    if (params.amountText === amount && params.paymentMethod === paymentMethod && params.amountPesewas === pesewas) return;
    onUpdateParams({ amountText: amount, paymentMethod, amountPesewas: pesewas });
  }, [amount, paymentMethod]);

  function appendDigit(digit) {
    if (hasSaleItems) return;
    setError("");
    setAmount((current) => pressAmountKey(current, digit));
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
        appendDigit("Delete");
      } else if (event.key === "Enter" && canSave && !busy) {
        event.preventDefault();
        void saveSale();
      }
    }

    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [amount, canSave, busy, paymentMethod, largeAmount.open]);

  return (
    <PosPage style={{ paddingTop: 14 }} className="flex flex-col gap-3 overflow-visible! pb-0! lg:max-w-5xl lg:justify-center lg:pb-10!">
      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)] lg:items-start lg:gap-6">
        <div className="flex flex-col gap-3">
          <PosCard className="amount-fit-container rounded-[20px] px-4 py-3 text-right lg:px-6 lg:py-5">
            <p className="text-base font-bold text-slate-700 lg:text-lg">{t("sell.customerPays")}</p>
            <output aria-live="polite" className="amount-fit font-extrabold">{formatGhs(amountPesewas ?? 0)}</output>
          </PosCard>
          <AmountKeypad label={t("sell.enterAmount")} disabled={hasSaleItems} onKey={appendDigit} />
        </div>
        <div className="flex flex-col gap-3 lg:pt-1">
          {/* Wiring 15 "Done on 15" (17 Nov 2026): "+ Add items" is the add look at the compact 44px, the
              one allowed use of the compact size. */}
          <AddButton size="compact" onClick={() => onNavigate("SellWithItems", { amountPesewas, saleItems })}>
            {t("sell.addItems")}
          </AddButton>
          <div className="grid grid-cols-4 gap-1 sm:gap-2 lg:gap-3">
            {paymentChoices.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                aria-pressed={paymentMethod === value}
                onClick={() => {
                  if (value === "credit") {
                    if (amountErrors.check(["credit"]) && !busy) onNavigate("WhoOwesYou", { amountPesewas, saleItems, ...(typeof params.creditReason === "string" && { creditReason: params.creditReason }) });
                  } else if (value === "momo") {
                    // Brief 3.12: a large MoMo amount asks before 61 (before the customer is asked to pay).
                    if (amountErrors.check(["momo"]) && !busy) {
                      if (!largeAmount.guard(amountPesewas, () => onNavigate("MoMoChoice", { amountPesewas, saleItems }), { momo: true })) onNavigate("MoMoChoice", { amountPesewas, saleItems });
                    }
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
                // Wiring 16: the parts kept from the last Back on 16 come back if the total still
                // matches; the kept draft is dropped from 15 either way (16 hands it back on Back).
                const splitParams = getSplitPaymentParams(params, amountPesewas, saleItems);
                if (params.splitDraft) onUpdateParams?.({ splitDraft: undefined });
                onNavigate("SplitPayment", splitParams);
              }}
              className="flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-[14px] border-2 border-emerald-900 bg-white px-1 text-xs font-extrabold text-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 sm:h-20 sm:gap-1 sm:rounded-2xl sm:text-sm lg:h-24 lg:rounded-[18px] lg:border-[3px] lg:px-2 lg:text-[17px]"
            >
              <SplitIcons withOwe size={11} />
              <span className="w-full min-w-0 truncate text-center text-xs sm:hidden">Split</span>
              <span className="hidden w-full min-w-0 truncate text-center sm:inline">{t("sell.split")}</span>
            </button>
          </div>
          {(amountErrors.message || error) && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 text-base font-semibold text-rose-950">{amountErrors.message || error}</p>}
          <SaveAttemptNotice saveAttempt={saveAttempt} busy={busy} onTryAgain={() => void saveSale(true)} />
          {/* Wiring 15 "Done on 15" (17 Nov 2026): Done is pinned at the bottom of the screen (60px, solid
              green) and the content above it scrolls under it, so Done is fully visible at 340x667, 340x640
              and 360x667. On the wide layout it stays in the right column. */}
          <div data-bottom-row="" className="sticky bottom-0 z-10 -mx-4 bg-white px-4 pb-3 pt-2 sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:p-0">
            <PosPrimaryButton type="button" onClick={() => void saveSale()} disabled={!canSave || busy} className="h-[60px] min-h-0 rounded-[20px] border-0 text-[26px] lg:h-20 lg:text-3xl">
              <Check size={32} aria-hidden="true" /> {busy ? t("sell.saving") : t("sell.done")}
            </PosPrimaryButton>
          </div>
        </div>
      </div>
      {largeAmount.dialog}
    </PosPage>
  );
}
