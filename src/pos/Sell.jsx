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
import { getSellKeyAction } from "./sellKeyboard.js";
import { PHONE_LAYOUT } from "./layout.js";
import LastSaleBox from "./LastSaleBox.jsx";
import { loadLastSaleToday } from "./lastSale.js";

// Keypad keys on 15: 62px, shorter on short screens (never under 48px; the gaps stay 8px) so that Done
// fits above the bottom bar without scrolling where it can.
const KEY_HEIGHT_15 = "54px";
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
export default function Sell({ params = {}, onNavigate, onUpdateParams, recordSale = recordCashSale, layout = PHONE_LAYOUT, loadLastSale = loadLastSaleToday }) {
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
      const action = getSellKeyAction(event);
      if (!action) return;
      // Enter is never passed to a focused pad key: it is Done when Done is enabled, otherwise nothing.
      event.preventDefault();
      if (action.key) appendDigit(action.key);
      else if (action.done && canSave && !busy) void saveSale();
    }

    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [amount, canSave, busy, paymentMethod, largeAmount.open]);

  // One tap handler per tile, the same on every width.
  function choosePayment(value) {
    if (value === "credit") {
      if (amountErrors.check(["credit"]) && !busy) onNavigate("WhoOwesYou", { amountPesewas, saleItems, ...(typeof params.creditReason === "string" && { creditReason: params.creditReason }) });
    } else if (value === "momo") {
      // Brief 3.12: a large MoMo amount asks before 61 (before the customer is asked to pay).
      if (amountErrors.check(["momo"]) && !busy) {
        if (!largeAmount.guard(amountPesewas, () => onNavigate("MoMoChoice", { amountPesewas, saleItems }), { momo: true })) onNavigate("MoMoChoice", { amountPesewas, saleItems });
      }
    } else setPaymentMethod(value);
  }

  function openSplit() {
    if (!canSave || busy) return;
    // Wiring 16: the parts kept from the last Back on 16 come back if the total still
    // matches; the kept draft is dropped from 15 either way (16 hands it back on Back).
    const splitParams = getSplitPaymentParams(params, amountPesewas, saleItems);
    if (params.splitDraft) onUpdateParams?.({ splitDraft: undefined });
    onNavigate("SplitPayment", splitParams);
  }

  const notices = (
    <>
      {(amountErrors.message || error) && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 text-base font-semibold text-rose-950">{amountErrors.message || error}</p>}
      <SaveAttemptNotice saveAttempt={saveAttempt} busy={busy} onTryAgain={() => void saveSale(true)} />
    </>
  );

  if (layout.wide) {
    // Wide 15 (D2, D15; wide_layout.screens["15 Sell"]): left, the amount and a keypad that fills the
    // height; right, the Items row, How is it paid? as a 2x2 grid of tiles, the quiet Last sale box,
    // then Done pinned at the bottom with one line saying why it is disabled. The same controls,
    // labels, handlers and saved record as the phone; only the layout changes.
    const tileClass = "relative flex min-h-[92px] min-w-0 flex-col items-center justify-center gap-1.5 rounded-[18px] px-2 text-[19px] font-extrabold leading-tight disabled:cursor-not-allowed disabled:opacity-50";
    const doneDisabled = !canSave || busy;
    return (
      <PosPage wide rail={layout.mode === "rail"} className="flex flex-col gap-5 tabular-nums">
        <h1 className="text-[30px] font-extrabold leading-tight text-[#0F172A]">{t("sell.title")}</h1>
        <div data-sell-wide="" className="grid min-h-0 flex-1 gap-6" style={{ gridTemplateColumns: "minmax(0, 1fr) clamp(300px, 45%, 410px)" }}>
          <div className="flex min-h-0 min-w-0 flex-col gap-3">
            <section className="amount-fit-container rounded-[20px] border-2 border-slate-300 bg-white px-6 py-4 text-right">
              <p className="text-[17px] font-bold text-slate-600">{t("sell.customerPays")}</p>
              <output aria-live="polite" className="block min-w-0 whitespace-nowrap text-[#0F172A]" style={{ fontSize: "clamp(28px, 11.5cqi, 56px)", fontWeight: 700, lineHeight: 1.15 }}>{formatGhs(amountPesewas ?? 0)}</output>
            </section>
            <AmountKeypad label={t("sell.enterAmount")} disabled={hasSaleItems} onKey={appendDigit} fill maxKeyHeight={layout.mode === "rail" ? 80 : undefined} />
            {!hasSaleItems && <p className="mt-auto text-center text-[17px] text-slate-600">{t("sell.keyboardHint")}</p>}
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <section className="flex items-center justify-between gap-3 rounded-[20px] border-2 border-slate-300 bg-white px-4 py-3.5">
              <div className="min-w-0">
                <p className="text-[17px] font-bold text-slate-600">{t("sell.items")}</p>
                <p className="text-[17px] text-slate-600">{hasSaleItems ? t("sell.itemsAdded", { count: saleItems.length }) : t("sell.itemsNone")}</p>
              </div>
              <AddButton className="w-auto! shrink-0 whitespace-nowrap hover:bg-green-50" onClick={() => onNavigate("SellWithItems", { amountPesewas, saleItems })}>
                {t("sell.addItems")}
              </AddButton>
            </section>
            <p id="sell-how-paid" className="text-[17px] font-bold text-slate-600">{t("review.howPaid")}</p>
            <div role="group" aria-labelledby="sell-how-paid" className="grid grid-cols-2 gap-3">
              {paymentChoices.map(({ value, label, icon: Icon }) => {
                const selected = paymentMethod === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => choosePayment(value)}
                    disabled={value === "credit" && (!canSave || busy)}
                    className={`${tileClass} ${selected ? "border-[3px] border-emerald-900 bg-green-200 text-emerald-900" : "border-2 border-slate-500 bg-white text-slate-900 hover:border-slate-700 hover:bg-slate-50"}`}
                  >
                    {selected && <span aria-hidden="true" className="absolute right-2.5 top-2 grid h-[26px] w-[26px] place-items-center rounded-full bg-emerald-900 text-white"><Check size={16} strokeWidth={3} /></span>}
                    <Icon size={30} className="shrink-0" aria-hidden="true" />
                    <span className="w-full min-w-0 truncate text-center">{t(label)}</span>
                  </button>
                );
              })}
              <AddButton plus={false} size="tile" aria-label={t("sell.split")} disabled={!canSave || busy} onClick={openSplit} className={`${tileClass} px-2! text-[19px]! hover:bg-green-50`}>
                <SplitIcons withOwe size={24} />
                <span className="w-full min-w-0 text-center">{t("sell.split")}</span>
              </AddButton>
            </div>
            <LastSaleBox load={loadLastSale} />
            {notices}
            <div className="mt-auto flex flex-col gap-2 pt-2">
              <PosPrimaryButton type="button" onClick={() => void saveSale()} disabled={doneDisabled} aria-describedby={doneDisabled && !busy ? "sell-done-why" : undefined} className="h-[76px] min-h-0 rounded-[18px] border-0 text-[26px] enabled:hover:bg-emerald-950">
                <Check size={30} aria-hidden="true" /> {busy ? t("sell.saving") : t("sell.done")}
              </PosPrimaryButton>
              <p id="sell-done-why" className="min-h-[26px] text-center text-[17px] text-slate-600">{doneDisabled && !busy ? t("sell.doneWhy") : ""}</p>
            </div>
          </div>
        </div>
        {largeAmount.dialog}
      </PosPage>
    );
  }

  return (
    // Wiring 15 "Done on 15" (17 Nov 2026, second decision): Done is NOT pinned. It is the last thing in
    // the content, and the page keeps room below it so that, scrolled to the end, Done ends above the
    // fixed bottom bar (PosBottomNav, below lg: 3px border + 4px + 76px + its safe-bottom padding, and the
    // raised Sell circle 22px higher, so 103px) with 8px to spare. Nothing floats over the content.
    <PosPage style={{ paddingTop: 14 }} className="flex flex-col gap-3 pb-[calc(111px+max(0px,env(safe-area-inset-bottom)-1rem))]! lg:max-w-5xl lg:justify-center lg:pb-10!">
      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)] lg:items-start lg:gap-6">
        <div className="flex flex-col gap-3">
          <PosCard className="amount-fit-container rounded-[20px] px-4 py-3 text-right lg:px-6 lg:py-5">
            <p className="text-base font-bold text-slate-700 lg:text-lg">{t("sell.customerPays")}</p>
            <output aria-live="polite" className="amount-fit font-extrabold">{formatGhs(amountPesewas ?? 0)}</output>
          </PosCard>
          <AmountKeypad label={t("sell.enterAmount")} disabled={hasSaleItems} onKey={appendDigit} keyHeight={KEY_HEIGHT_15} />
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
                onClick={() => choosePayment(value)}
                disabled={value === "credit" && (!canSave || busy)}
                className={`flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-[14px] border-2 px-1 text-xs font-extrabold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 sm:h-20 sm:gap-1 sm:rounded-2xl sm:text-sm lg:h-24 lg:rounded-[18px] lg:border-[3px] lg:px-2 lg:text-[17px] ${
                  paymentMethod === value ? "border-emerald-900 bg-green-200 text-slate-950" : "border-slate-500 bg-white text-slate-900"
                }`}
              >
                <Icon size={18} className="shrink-0 sm:h-5 sm:w-5 lg:h-6 lg:w-6" aria-hidden="true" />
                <span className="w-full min-w-0 truncate text-center">{t(label)}</span>
              </button>
            ))}
            {/* split_payment_look (21 Nov 2026): Split is the add look (dashed 2px dark green), keeping its
                Cash + MoMo + Owe icon and the tile size of the row; "Split" on the four-tile row. */}
            <AddButton
              plus={false}
              aria-label={t("sell.split")}
              disabled={!canSave || busy}
              onClick={openSplit}
              className="h-14 min-h-0! min-w-0 flex-1 flex-col gap-0.5! overflow-hidden px-1! py-0! text-xs! sm:h-20 sm:gap-1! sm:rounded-2xl sm:text-sm! lg:h-24 lg:rounded-[18px] lg:px-2! lg:text-[17px]!"
            >
              <SplitIcons withOwe size={11} />
              <span className="w-full min-w-0 truncate text-center sm:hidden">Split</span>
              <span className="hidden w-full min-w-0 truncate text-center sm:inline">{t("sell.split")}</span>
            </AddButton>
          </div>
          {(amountErrors.message || error) && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 text-base font-semibold text-rose-950">{amountErrors.message || error}</p>}
          <SaveAttemptNotice saveAttempt={saveAttempt} busy={busy} onTryAgain={() => void saveSale(true)} />
          <PosPrimaryButton type="button" onClick={() => void saveSale()} disabled={!canSave || busy} className="h-[60px] min-h-0 rounded-[20px] border-0 text-[26px] lg:h-20 lg:text-3xl">
            <Check size={32} aria-hidden="true" /> {busy ? t("sell.saving") : t("sell.done")}
          </PosPrimaryButton>
        </div>
      </div>
      {largeAmount.dialog}
    </PosPage>
  );
}
