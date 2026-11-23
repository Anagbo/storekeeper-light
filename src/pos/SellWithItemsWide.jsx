import { useEffect } from "react";
import { Banknote, Check, Smartphone, UserRound } from "lucide-react";
import { formatGhs } from "../lib/money.js";
import { AddButton, PosBackButton, PosPage, PosPrimaryButton, SplitIcons } from "./PosComponents.jsx";
import { posText as t } from "./i18n.js";
import { ItemSearch, ItemTiles, SaleLines, useSellCart } from "./SellItemsParts.jsx";
import { useItemsSaleSave } from "./useItemsSaleSave.js";
import { isDoneEnter } from "./sellKeyboard.js";

// Wide D9 (wide_layout.screens["20 and 55 Sell with items"], same_as_phone (d)): 20 and 55 on one screen.
// Left: Find item, the item tiles, + New item and the Other amount tile. Right: "This sale" with the
// lines exactly as on phone 20, Total, How is it paid? as four tiles and Done. The tiles, lines and cart
// are phone 20's parts; the payment choice and Done are phone 55's hook, so Done saves exactly what 55
// saves through the same onSaveSale. Next is not shown: Done replaces it.

const paymentChoices = [
  { value: "cash", label: "sell.cash", icon: Banknote },
  { value: "momo", label: "sell.momo", icon: Smartphone },
  { value: "owe", label: "sell.owe", icon: UserRound }
];

// What 55 holds in its params (20's Next hands it amountPesewas and saleItems; Back from 16 and 18 adds
// splitDraft and creditReason). Only these travel to 16, 17 and 61, as from 55.
const SALE_PARAM_KEYS = ["splitDraft", "creditReason", "paymentChoice"];
function saleParams(params, cart, total) {
  const picked = { amountPesewas: total, saleItems: cart };
  for (const key of SALE_PARAM_KEYS) if (params[key] !== undefined) picked[key] = params[key];
  return picked;
}

const TILE_CLASS = "relative flex min-h-[92px] min-w-0 flex-col items-center justify-center gap-1.5 rounded-[18px] px-2 text-[19px] font-extrabold leading-tight disabled:cursor-not-allowed disabled:opacity-50";

// background: 37 or 38 is open as a dialog over this screen; it takes no keys then.
export default function SellWithItemsWide({ params = {}, layout, onBack, onOtherAmount, onNavigate, onUpdateParams, onSaveSale, background = false }) {
  const sale = useSellCart({ params, onNavigate, onUpdateParams });
  const { result, cart, total } = sale;
  const pay = useItemsSaleSave({ params: saleParams(params, cart, total), saleItems: cart, totalPesewas: total, onNavigate, onUpdateParams, onSaveSale });
  const { paymentMethod, busy, largeAmount } = pay;
  const hasCart = cart.length > 0 && result !== undefined;
  const doneDisabled = !hasCart || busy;

  useEffect(() => {
    if (background) return undefined;
    function handleKeyboard(event) {
      if (largeAmount.open || !isDoneEnter(event) || doneDisabled) return;
      event.preventDefault();
      void pay.saveSale();
    }
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [background, doneDisabled, paymentMethod, total, largeAmount.open]);

  const error = sale.error || pay.error;
  return (
    <PosPage wide rail={layout?.mode === "rail"} className="flex flex-col gap-5 tabular-nums">
      <div className="flex items-center gap-3">
        <PosBackButton onClick={onBack} disabled={busy} />
        <h1 className="text-[30px] font-extrabold leading-tight text-[#0F172A]">{t("sellItems.title")}</h1>
      </div>
      <div data-sell-items-wide="" className="grid min-h-0 flex-1 items-start gap-6" style={{ gridTemplateColumns: "minmax(0, 1fr) clamp(380px, 45%, 450px)" }}>
        <div className="flex min-w-0 flex-col gap-3">
          <ItemSearch query={sale.query} onChange={sale.setQuery} />
          <ItemTiles
            cart={cart}
            products={sale.products}
            result={result}
            normalizedQuery={sale.normalizedQuery}
            onChoose={sale.chooseProduct}
            onNewItem={() => onNavigate("NewItem")}
            gridClassName="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3"
            newItemClassName="hover:bg-green-50"
            emptyClassName="col-span-full rounded-xl border-2 border-slate-300 bg-white p-3 text-[17px]"
            tileClassName="hover:brightness-95 [&_[data-tile-name]]:text-[17px] [&_[data-tile-price]]:text-[17px] [&_[data-count-badge]]:text-[15px]"
          >
            {/* Wiring 20 "Wide Other amount tile": what Back does on phone 20 (opens 15, the cart is kept). */}
            <AddButton size="tile" data-other-amount="" aria-label={t("sellItems.otherAmount")} onClick={onOtherAmount} className="hover:bg-green-50">
              {t("sellItems.otherAmount")}
            </AddButton>
          </ItemTiles>
          <p className="text-[17px] text-slate-600">{t("sellItems.tapToAdd")}</p>
        </div>

        <section aria-labelledby="this-sale" className="flex min-w-0 flex-col gap-3 rounded-[20px] border-2 border-slate-300 bg-white p-4">
          <h2 id="this-sale" className="text-[17px] font-bold text-slate-600">{t("sellItems.thisSale")}</h2>
          {cart.length > 0
            ? <SaleLines cart={cart} onUpdateCart={sale.updateCart} onQuantity={sale.openQuantity} className="space-y-2 [&_.text-sm]:text-[17px]" />
            : <p className="text-[17px] text-slate-600">{t("sellItems.emptySale")}</p>}
          <div className="flex items-baseline justify-between gap-3 border-t-2 border-slate-200 pt-3">
            <strong className="text-[21px] font-bold text-[#0F172A]">{t("review.total")}</strong>
            <output aria-live="polite" className="whitespace-nowrap text-[#0F172A]" style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.15 }}>{formatGhs(total)}</output>
          </div>
          <p id="items-how-paid" className="text-[17px] font-bold text-slate-600">{t("review.howPaid")}</p>
          <div role="group" aria-labelledby="items-how-paid" className="grid grid-cols-2 gap-3">
            {paymentChoices.map(({ value, label, icon: Icon }) => {
              const selected = paymentMethod === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => pay.choosePayment(value)}
                  disabled={value !== "cash" && (!hasCart || busy)}
                  className={`${TILE_CLASS} ${selected ? "border-[3px] border-emerald-900 bg-green-200 text-emerald-900" : "border-2 border-slate-500 bg-white text-slate-900 hover:border-slate-700 hover:bg-slate-50"}`}
                >
                  {selected && <span aria-hidden="true" className="absolute right-2.5 top-2 grid h-[26px] w-[26px] place-items-center rounded-full bg-emerald-900 text-white"><Check size={16} strokeWidth={3} /></span>}
                  <Icon size={30} className="shrink-0" aria-hidden="true" />
                  <span className="w-full min-w-0 truncate text-center">{t(label)}</span>
                </button>
              );
            })}
            <AddButton plus={false} size="tile" aria-label={t("review.split")} data-split-55="" disabled={!hasCart || busy} onClick={pay.openSplit} className={`${TILE_CLASS} px-2! text-[19px]! hover:bg-green-50`}>
              <SplitIcons withOwe size={24} />
              <span className="w-full min-w-0 text-center">{t("review.split")}</span>
            </AddButton>
          </div>
          {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 text-[17px] font-semibold text-rose-950">{error}</p>}
          <div className="flex flex-col gap-2 pt-2">
            <PosPrimaryButton type="button" onClick={() => void pay.saveSale()} disabled={doneDisabled} aria-describedby={doneDisabled && !busy ? "items-done-why" : undefined} className="h-[76px] min-h-0 rounded-[18px] border-0 text-[26px] enabled:hover:bg-emerald-950">
              {busy ? t("sell.saving") : <><Check size={30} aria-hidden="true" /> {t("sell.done")}</>}
            </PosPrimaryButton>
            <p id="items-done-why" className="min-h-[26px] text-center text-[17px] text-slate-600">{doneDisabled && !busy ? t("sellItems.doneWhy") : ""}</p>
          </div>
        </section>
      </div>
      {largeAmount.dialog}
    </PosPage>
  );
}
