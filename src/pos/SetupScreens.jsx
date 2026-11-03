import { useState } from "react";
import { Calculator, List, Plus } from "lucide-react";
import { createProduct, updateProduct } from "../db/products.js";
import { formatGhs, toPesewas } from "../lib/money.js";
import { normalizeSaleItems, totalSaleItemsPesewas } from "../lib/saleItems.js";
import { requestBackgroundSync } from "../lib/syncRegistration.js";
import { posText as t } from "./i18n.js";
import { PosPage, PosPrimaryButton, PosSecondaryButton } from "./PosComponents.jsx";

export function HowDoYouWantToSell({ onNavigate, onCompleteSetup }) {
  const [sellMode, setSellMode] = useState("amount");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function continueSetup() {
    if (saving) return;
    if (sellMode === "items") {
      onNavigate("WhatDoYouSell");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onCompleteSetup();
    } catch (saveError) {
      console.error("Could not finish POS setup.", saveError);
      setError(t("setup.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-[28rem] flex-col gap-3 px-5 py-4">
      <h1 className="text-[26px] font-extrabold">{t("setup.sellTitle")}</h1>
      <button
        type="button"
        aria-pressed={sellMode === "amount"}
        disabled={saving}
        onClick={() => setSellMode("amount")}
        className={`flex min-h-[110px] items-center gap-4 rounded-[22px] border-[3px] px-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 ${sellMode === "amount" ? "border-emerald-900 bg-green-200" : "border-slate-500 bg-white"}`}
      >
        <Calculator size={36} className="shrink-0 text-emerald-900" aria-hidden="true" />
        <span>
          <strong className="block text-[22px]">{t("setup.amountMode")}</strong>
          <span className="text-[17px] text-slate-800">{t("setup.amountModeHint")}</span>
        </span>
      </button>
      <button
        type="button"
        aria-pressed={sellMode === "items"}
        disabled={saving}
        onClick={() => setSellMode("items")}
        className={`flex min-h-[110px] items-center gap-4 rounded-[22px] border-[3px] px-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 ${sellMode === "items" ? "border-emerald-900 bg-green-200" : "border-slate-500 bg-white"}`}
      >
        <List size={36} className="shrink-0 text-emerald-900" aria-hidden="true" />
        <span>
          <strong className="block text-[22px]">{t("setup.itemsMode")}</strong>
          <span className="text-[17px] text-slate-800">{t("setup.itemsModeHint")}</span>
        </span>
      </button>
      <p className="text-[17px] text-slate-800">{t("setup.laterHint")}</p>
      {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
      <PosPrimaryButton type="button" disabled={saving} onClick={() => void continueSetup()} className="mt-auto h-[68px] rounded-[20px] text-2xl">
        {saving ? t("sell.saving") : t("setup.continue")}
      </PosPrimaryButton>
    </main>
  );
}

export function WhatDoYouSell({ onBack, onNavigate, onCompleteSetup }) {
  const [name, setName] = useState("");
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function skipSetup() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await onCompleteSetup();
    } catch (saveError) {
      console.error("Could not finish POS setup.", saveError);
      setError(t("setup.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function addItem() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const product = await createProduct({ name });
      setItems((current) => [...current, product.name]);
      setName("");
      void requestBackgroundSync();
    } catch (saveError) {
      console.error("Could not add a setup item.", saveError);
      setError(saveError instanceof TypeError ? saveError.message : t("setup.itemSaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PosPage className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <PosSecondaryButton type="button" onClick={onBack}>{t("items.back")}</PosSecondaryButton>
        <h1 className="text-2xl font-extrabold">{t("setup.itemsTitle")}</h1>
      </div>
      <p className="text-base text-slate-700">{t("setup.itemsHint")}</p>
      <form onSubmit={(event) => { event.preventDefault(); void addItem(); }} className="flex flex-col gap-2">
        <label className="block">
          <span className="mb-1 block font-extrabold">{t("items.name")}</span>
          <input value={name} onChange={(event) => { setName(event.target.value); setError(""); }} maxLength={80} autoComplete="off" className="h-14 w-full rounded-2xl border-[3px] border-slate-500 px-3 text-lg" />
        </label>
        <PosSecondaryButton type="submit" disabled={saving || !name.trim()}>
          <Plus size={22} aria-hidden="true" />{saving ? t("items.saving") : t("setup.addItem")}
        </PosSecondaryButton>
      </form>
      {items.length > 0 && (
        <ul className="space-y-1 rounded-xl bg-emerald-50 p-3 font-semibold">
          {items.map((item, index) => <li key={`${item}-${index}`}>✓ {item}</li>)}
        </ul>
      )}
      {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
      <div className="mt-auto grid grid-cols-2 gap-2">
        <PosSecondaryButton type="button" disabled={saving} onClick={() => void skipSetup()}>{t("setup.skip")}</PosSecondaryButton>
        <PosPrimaryButton type="button" disabled={saving} onClick={() => onNavigate("YourStarterList", { setupFlow: true })}>{t("setup.continueItems")}</PosPrimaryButton>
      </div>
    </PosPage>
  );
}

export function HowMuchIsItem({ params, onBack, onNavigate }) {
  const product = params.product;
  const [price, setPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function savePrice(event) {
    event.preventDefault();
    if (!product || saving) return;
    const pricePesewas = toPesewas(price);
    if (!Number.isSafeInteger(pricePesewas) || pricePesewas <= 0) {
      setError(t("sellItems.invalidPrice"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const updatedProduct = await updateProduct(product.id, { name: product.name, price });
      void requestBackgroundSync();
      onNavigate("HowManyItem", { ...params, product: updatedProduct, unitPricePesewas: pricePesewas });
    } catch (saveError) {
      console.error("Could not save this item's price.", saveError);
      setError(saveError instanceof TypeError ? saveError.message : t("sellItems.priceSaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PosPage className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <PosSecondaryButton type="button" onClick={onBack}>{t("items.back")}</PosSecondaryButton>
        <h1 className="text-2xl font-extrabold">{t("setup.priceTitle", { name: product?.name ?? "" })}</h1>
      </div>
      <form onSubmit={(event) => void savePrice(event)} className="flex flex-1 flex-col gap-3">
        <label className="block">
          <span className="mb-1 block font-extrabold">{t("items.price")}</span>
          <input type="text" inputMode="decimal" value={price} onChange={(event) => { setPrice(event.target.value); setError(""); }} placeholder="0.00" className="h-16 w-full rounded-2xl border-[3px] border-slate-500 px-3 text-right text-2xl font-extrabold" />
        </label>
        {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
        <PosPrimaryButton type="submit" disabled={saving || !product}>{saving ? t("items.saving") : t("sellItems.savePrice")}</PosPrimaryButton>
      </form>
    </PosPage>
  );
}

export function HowManyItem({ params, onBack, onReplace }) {
  const product = params.product;
  const unitPricePesewas = params.unitPricePesewas ??
    (product ? toPesewas(product.default_price) : null);
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState("");

  function addToSale() {
    if (!product || !Number.isSafeInteger(product.id) ||
      !Number.isSafeInteger(unitPricePesewas) || unitPricePesewas <= 0 ||
      !Number.isSafeInteger(quantity) || quantity <= 0) {
      setError(t("sellItems.updateFailed"));
      return;
    }
    try {
      const currentItems = normalizeSaleItems(params.saleItems ?? []);
      const existing = currentItems.find((item) => item.productId === product.id);
      const nextItems = existing
        ? currentItems.map((item) => item.productId === product.id
          ? { ...item, quantity: item.quantity + quantity }
          : item)
        : [...currentItems, {
          productId: product.id,
          name: product.name,
          quantity,
          unitPricePesewas
        }];
      totalSaleItemsPesewas(nextItems);
      onReplace("SellWithItems", { saleItems: nextItems });
    } catch (addError) {
      setError(addError instanceof RangeError ? t("sellItems.totalTooLarge") : t("sellItems.updateFailed"));
    }
  }

  return (
    <PosPage className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <PosSecondaryButton type="button" onClick={onBack}>{t("items.back")}</PosSecondaryButton>
        <h1 className="text-2xl font-extrabold">{t("setup.quantityTitle", { name: product?.name ?? "" })}</h1>
      </div>
      {product && <p className="text-lg font-bold">{t("sellItems.each", { amount: formatGhs(unitPricePesewas) })}</p>}
      <div className="flex items-center justify-center gap-5">
        <PosSecondaryButton type="button" aria-label={t("setup.quantityLess")} disabled={quantity <= 1} onClick={() => setQuantity((current) => Math.max(1, current - 1))}>−</PosSecondaryButton>
        <output aria-live="polite" className="min-w-16 text-center text-4xl font-extrabold">{quantity}</output>
        <PosSecondaryButton type="button" aria-label={t("setup.quantityMore")} onClick={() => setQuantity((current) => current + 1)}>+</PosSecondaryButton>
      </div>
      {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
      <PosPrimaryButton type="button" disabled={!product} onClick={addToSale} className="mt-auto">{t("setup.addToSale")}</PosPrimaryButton>
    </PosPage>
  );
}
