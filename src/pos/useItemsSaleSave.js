import { useState } from "react";
import { isSaveOutcomeUnknown, isSaveTimeout } from "../lib/saveAttempt.js";
import { posText as t } from "./i18n.js";
import { useLargeAmountConfirm } from "./LargeAmountConfirm.jsx";
import { useSaveAttempt } from "./useSaveAttempt.js";
import { useBackBlock } from "./browserBack.js";
import { getSplitPaymentParams } from "./routes.js";

// Review and pay (55): the payment choice and the save, shared by phone 55 and the wide D9 screen.
// params are the screen's route params (on D9 only the ones 55 would hold); saleItems and totalPesewas
// are the cart and its total (totalSaleItemsPesewas). Done saves through onSaveSale exactly what 55
// saves; MoMo, Owe and Split open the same screens with the same params.
export function useItemsSaleSave({ params = {}, saleItems, totalPesewas, onNavigate, onUpdateParams, onSaveSale }) {
  // Only Cash is chosen in place (MoMo and Owe leave the screen) and it is also the starting choice, so a
  // return always shows the right one. The choice is still written to the route params like the other
  // drafts; nothing is read back for MoMo, so a stray value can never pre-select an unconfirmed MoMo save.
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [busy, setBusy] = useState(false);
  useBackBlock(busy);
  const [error, setError] = useState("");
  const saveAttempt = useSaveAttempt();
  const largeAmount = useLargeAmountConfirm();

  function continueToCredit() {
    onNavigate("WhoOwesYou", {
      ...params,
      amountPesewas: totalPesewas,
      saleItems
    });
  }

  function choosePayment(value) {
    if (value === "owe") continueToCredit();
    else if (value === "momo") {
      // Brief 3.12: a large MoMo amount asks before 61 (before the customer is asked to pay).
      const toMomo = () => onNavigate("MoMoChoice", { ...params, amountPesewas: totalPesewas, saleItems });
      if (!largeAmount.guard(totalPesewas, toMomo, { momo: true })) toMomo();
    }
    else { setPaymentMethod(value); onUpdateParams?.({ paymentChoice: value }); }
  }

  function openSplit() {
    // MOMO16: the parts kept from the last Back on 16 come back while the total is unchanged.
    const splitParams = getSplitPaymentParams(params, totalPesewas, saleItems, params);
    if (params.splitDraft) onUpdateParams?.({ splitDraft: undefined });
    onNavigate("SplitPayment", splitParams);
  }

  async function saveSale(confirmed = false) {
    if (busy) return;
    // Brief 3.12: a large sale asks first, before the save starts and before the attempt key is used.
    if (!confirmed && largeAmount.guard(totalPesewas, () => void saveSale(true))) return;
    setBusy(true);
    setError("");
    try {
      const content = {
        amountPesewas: totalPesewas,
        cashReceivedPesewas: paymentMethod === "cash" ? totalPesewas : 0,
        momoReceivedPesewas: paymentMethod === "momo" ? totalPesewas : 0,
        saleItems
      };
      await saveAttempt.run(content, (attemptId) => onSaveSale({ ...content, attemptId }));
    } catch (saveError) {
      console.error("Could not save the reviewed sale.", saveError);
      setError(isSaveOutcomeUnknown(saveError)
        ? ""
        : isSaveTimeout(saveError)
        ? t("sell.saveTimedOut")
        : saveError?.name === "QuotaExceededError"
          ? t("sell.storageFull")
          : t("sell.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return { paymentMethod, choosePayment, openSplit, saveSale, busy, error, largeAmount, saveAttempt };
}
