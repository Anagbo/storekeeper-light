import { useEffect, useState } from "react";
import { Calculator, Check, List, Search } from "lucide-react";
import { getPreference, saveSellMode } from "../db/preferences.js";
import { updateProduct } from "../db/products.js";
import { getMoreCategoryGroups, getPopularCategories, isSomethingElseOnly, searchStarterCategories, shouldGroupStarterList, STARTER_CATEGORIES } from "../db/starterItems.js";
import { formatGhs, toPesewas } from "../lib/money.js";
import { normalizeSaleItems, totalSaleItemsPesewas } from "../lib/saleItems.js";
import { requestBackgroundSync } from "../lib/syncRegistration.js";
import { amountTextToPesewas, COUNT_KEYPAD, countFromKeypadText, MONEY_KEYPAD, pressAmountKey } from "./amountKeypad.js";
import { posText as t } from "./i18n.js";
import AmountKeypad from "./AmountKeypad.jsx";
import { PosCard, PosPage, PosPrimaryButton, PosSecondaryButton, PosBackButton } from "./PosComponents.jsx";
import { useBackBlock } from "./browserBack.js";

export function HowDoYouWantToSell({ onNavigate, onCompleteSetup }) {
  const [sellMode, setSellMode] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  useBackBlock(saving);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getPreference("sellMode", "numbers")
      .then((savedMode) => {
        if (savedMode !== "numbers" && savedMode !== "items") {
          throw new TypeError("The saved sell mode is invalid.");
        }
        if (active) setSellMode(savedMode);
      })
      .catch((loadError) => {
        console.error("Could not load the saved sell mode.", loadError);
        if (active) setError(t("setup.loadFailed"));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function continueSetup() {
    if (saving || loading || !sellMode) return;
    setSaving(true);
    setError("");
    try {
      await saveSellMode(sellMode);
      if (sellMode === "items") onNavigate("WhatDoYouSell");
      else await onCompleteSetup();
    } catch (saveError) {
      console.error("Could not save the selected sell mode.", saveError);
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
        aria-pressed={sellMode === "numbers"}
        disabled={saving || loading || Boolean(error)}
        onClick={() => setSellMode("numbers")}
        className={`flex min-h-[110px] items-center gap-4 rounded-[22px] border-[3px] px-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 ${sellMode === "numbers" ? "border-emerald-900 bg-green-200" : "border-slate-500 bg-white"}`}
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
        disabled={saving || loading || Boolean(error)}
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
      {loading && <p role="status">{t("app.loadingScreen")}</p>}
      <PosPrimaryButton type="button" disabled={saving || loading || !sellMode || Boolean(error)} onClick={() => void continueSetup()} className="mt-auto h-[68px] rounded-[20px] text-2xl">
        {saving ? t("sell.saving") : t("setup.continue")}
      </PosPrimaryButton>
    </main>
  );
}

function CategoryTile({ category, checked, disabled, onToggle }) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      disabled={disabled}
      onClick={() => onToggle(category.id)}
      className={`flex min-h-[76px] items-center gap-2 rounded-2xl border-[3px] px-3 text-left text-base font-extrabold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 ${checked ? "border-emerald-900 bg-green-200" : "border-slate-500 bg-white"}`}
    >
      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg border-2 ${checked ? "border-emerald-900 bg-emerald-900 text-white" : "border-slate-500"}`}>
        {checked && <Check size={19} aria-hidden="true" />}
      </span>
      {category.name}
    </button>
  );
}

function toggleId(ids, id) {
  return ids.includes(id) ? ids.filter((current) => current !== id) : [...ids, id];
}

export function WhatDoYouSell({ selected, onSelectedChange, onBack, onNavigate, onCompleteSetup }) {
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  useBackBlock(saving);
  const [error, setError] = useState("");
  const searchText = query.trim();
  const found = searchText ? searchStarterCategories(searchText) : [];

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

  const toggleCategory = (id) => onSelectedChange(toggleId(selected, id));
  const tile = (category) => (
    <CategoryTile key={category.id} category={category} checked={selected.includes(category.id)} disabled={saving} onToggle={toggleCategory} />
  );

  function continueToItems() {
    if (isSomethingElseOnly(selected)) onNavigate("NewItem", { setupFlow: true });
    else onNavigate(shouldGroupStarterList(selected) ? "YourStarterListGrouped" : "YourStarterList", { setupFlow: true, starterCategories: [...selected] });
  }

  return (
    <PosPage className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <PosBackButton onClick={onBack} />
        <h1 className="text-2xl font-extrabold">{t("setup.itemsTitle")}</h1>
      </div>
      <label className="flex min-h-14 items-center gap-2 rounded-2xl border-[3px] border-slate-500 px-3">
        <Search size={24} aria-hidden="true" />
        <span className="sr-only">{t("setup.findBusiness")}</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("setup.findBusiness")} className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none" />
      </label>
      <p className="text-base text-slate-700">{t("setup.itemsHint")}</p>
      {searchText ? (
        found.length
          ? <div className="grid grid-cols-2 gap-2">{found.map(tile)}</div>
          : <p className="rounded-xl border-2 border-slate-300 bg-white p-4 font-semibold">{t("setup.noCategoryMatch")}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">{getPopularCategories().map(tile)}</div>
          <PosSecondaryButton type="button" disabled={saving} onClick={() => onNavigate("MoreCategories")}>{t("setup.moreCategoriesLink")}</PosSecondaryButton>
          {tile(STARTER_CATEGORIES.at(-1))}
        </>
      )}
      {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
      <div className="mt-auto grid grid-cols-2 gap-2">
        <PosSecondaryButton type="button" disabled={saving} onClick={() => void skipSetup()}>{t("setup.skip")}</PosSecondaryButton>
        <PosPrimaryButton type="button" disabled={saving || selected.length === 0} onClick={continueToItems}>
          {t("setup.continueItems")}
        </PosPrimaryButton>
      </div>
    </PosPage>
  );
}

export function MoreCategories({ selected, onSelectedChange, onBack, onDone }) {
  return (
    <PosPage className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <PosBackButton onClick={onBack} />
        <h1 className="text-2xl font-extrabold">{t("setup.moreCategories")}</h1>
      </div>
      <p className="text-base text-slate-700">{t("setup.tapAll")}</p>
      {getMoreCategoryGroups().map(({ group, categories }) => (
        <section key={group} aria-label={group} className="flex flex-col gap-2">
          <h2 className="text-sm font-extrabold uppercase text-slate-700">{group}</h2>
          <div className="flex flex-wrap gap-2">
            {categories.map(({ id, name }) => {
              const checked = selected.includes(id);
              return (
                <button key={id} type="button" aria-pressed={checked} onClick={() => onSelectedChange(toggleId(selected, id))}
                  className={`min-h-12 rounded-full border-2 px-4 text-base font-bold ${checked ? "border-emerald-900 bg-green-200" : "border-slate-500 bg-white"}`}>
                  {checked && <Check size={16} className="mr-1 inline" aria-hidden="true" />}{name}
                </button>
              );
            })}
          </div>
        </section>
      ))}
      <PosPrimaryButton type="button" onClick={onDone} className="mt-auto">{t("setup.done")}</PosPrimaryButton>
    </PosPage>
  );
}

export function HowMuchIsItem({ params, onBack, onReturnTo }) {
  const product = params.product;
  // The shared amount keypad (wiring rules_global.amount_entry): 4 . 5 is GH₵4.50, read by integer math.
  const [priceText, setPriceText] = useState("");
  const [saving, setSaving] = useState(false);
  useBackBlock(saving);
  const [error, setError] = useState("");
  const pricePesewas = amountTextToPesewas(priceText);

  async function savePrice() {
    if (!product || saving) return;
    if (!Number.isSafeInteger(pricePesewas) || pricePesewas <= 0) {
      setError(t("sellItems.invalidPrice", { zero: formatGhs(0) }));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const updatedProduct = await updateProduct(product.id, { name: product.name, pricePesewas });
      void requestBackgroundSync();
      // Save price returns to 20 (contract 37) with the item in the sale, as a tap on a
      // priced tile does: one more of it.
      const currentItems = normalizeSaleItems(params.saleItems ?? []);
      const saleItems = currentItems.some((item) => item.productId === product.id)
        ? currentItems.map((item) => item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item)
        : [...currentItems, { productId: product.id, name: updatedProduct?.name ?? product.name, quantity: 1, unitPricePesewas: pricePesewas }];
      onReturnTo("SellWithItems", { saleItems, amountPesewas: totalSaleItemsPesewas(saleItems) });
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
        <PosBackButton onClick={onBack} />
        <h1 className="text-2xl font-extrabold">{t("setup.priceTitle", { name: product?.name ?? "" })}</h1>
      </div>
      <PosCard className="rounded-[20px] px-4 py-2.5 text-right">
        <p className="text-[17px] font-bold text-slate-800">{t("setup.priceFor")}</p>
        <output aria-live="polite" className="block text-5xl font-extrabold">{formatGhs(pricePesewas)}</output>
      </PosCard>
      <AmountKeypad disabled={saving} onKey={(key) => { setPriceText((current) => pressAmountKey(current, key, MONEY_KEYPAD)); setError(""); }} />
      {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
      <PosPrimaryButton type="button" disabled={saving || !product} onClick={() => void savePrice()} className="mt-auto">{saving ? t("items.saving") : t("sellItems.savePrice")}</PosPrimaryButton>
    </PosPage>
  );
}

export function HowManyItem({ params, onBack, onReturnTo }) {
  const product = params.product;
  const unitPricePesewas = params.unitPricePesewas ??
    (product ? toPesewas(product.default_price) : null);
  const isEditingExisting = params.mode === "edit" || params.setQuantity === true;
  // The count is typed on the shared keypad (whole numbers, "." does nothing); the first digit
  // replaces the starting number, Delete edits it.
  const [pad, setPad] = useState(() => ({
    text: String(Number.isSafeInteger(params.quantity) && params.quantity > 0 ? params.quantity : 1),
    fresh: true
  }));
  const [error, setError] = useState("");
  const quantity = countFromKeypadText(pad.text);
  const pressCount = (key) => setPad((current) => ({
    text: pressAmountKey(current.fresh && key !== "Delete" && key !== "." ? "" : current.text, key, COUNT_KEYPAD),
    fresh: key === "." ? current.fresh : false
  }));

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
          ? { ...item, quantity: isEditingExisting ? quantity : item.quantity + quantity }
          : item)
        : [...currentItems, {
          productId: product.id,
          name: product.name,
          quantity,
          unitPricePesewas
        }];
      totalSaleItemsPesewas(nextItems);
      // Back to the 20 that opened 38 (pop to it), never a second 20 on top of it.
      onReturnTo("SellWithItems", { saleItems: nextItems, amountPesewas: totalSaleItemsPesewas(nextItems) });
    } catch (addError) {
      setError(addError instanceof RangeError ? t("sellItems.totalTooLarge") : t("sellItems.updateFailed"));
    }
  }

  return (
    <PosPage className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <PosBackButton onClick={onBack} />
        <h1 className="text-2xl font-extrabold">{t("setup.quantityTitle", { name: product?.name ?? "" })}</h1>
      </div>
      {product && <p className="text-lg font-bold">{t("sellItems.each", { amount: formatGhs(unitPricePesewas) })}</p>}
      <PosCard className="rounded-[20px] px-4 py-2.5 text-right">
        <p className="text-[17px] font-bold text-slate-800">{t("setup.quantityFor", { name: product?.name ?? "" })}</p>
        <output aria-live="polite" className="block text-5xl font-extrabold">{quantity}</output>
      </PosCard>
      <AmountKeypad decimalDisabled onKey={(key) => { pressCount(key); setError(""); }} />
      {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
      <PosPrimaryButton type="button" disabled={!product} onClick={addToSale} className="mt-auto">{t("setup.addQuantity", { quantity })}</PosPrimaryButton>
    </PosPage>
  );
}
