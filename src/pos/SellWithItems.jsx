import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Minus, Plus, Search, Trash2 } from "lucide-react";
import { db } from "../db/db.js";
import { formatGhs, toPesewas } from "../lib/money.js";
import { normalizeSaleItems, totalSaleItemsPesewas } from "../lib/saleItems.js";
import { PosCard, PosPage, PosPrimaryButton, PosSecondaryButton } from "./PosComponents.jsx";
import { posText as t } from "./i18n.js";

function useSellableProducts() {
  return useLiveQuery(async () => {
    try {
      const products = await db.products.toArray();
      return {
        products: products
          .filter((product) => product.active !== false)
          .sort((left, right) => left.name.localeCompare(right.name)),
        error: ""
      };
    } catch (error) {
      console.error("Could not load items for a sale.", error);
      return { products: [], error: t("sellItems.loadFailed") };
    }
  }, [], undefined);
}

export default function SellWithItems({ params = {}, onBack, onNavigate, onUpdateParams }) {
  const result = useSellableProducts();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const cart = normalizeSaleItems(params.saleItems ?? []);
  const total = totalSaleItemsPesewas(cart);
  const normalizedQuery = query.trim().toLowerCase();
  const products = useMemo(() => (result?.products ?? []).filter((product) =>
    product.name.toLowerCase().includes(normalizedQuery)
  ), [normalizedQuery, result]);

  function updateCart(nextCart) {
    try {
      const normalized = normalizeSaleItems(nextCart);
      totalSaleItemsPesewas(normalized);
      onUpdateParams({ saleItems: normalized });
      setError("");
    } catch (cartError) {
      setError(cartError instanceof RangeError ? t("sellItems.totalTooLarge") : t("sellItems.updateFailed"));
    }
  }

  function addProduct(product, unitPricePesewas) {
    const existing = cart.find((line) => line.productId === product.id);
    const nextCart = existing
      ? cart.map((line) => line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line)
      : [...cart, { productId: product.id, name: product.name, quantity: 1, unitPricePesewas }];
    updateCart(nextCart);
  }

  function chooseProduct(product) {
    const unitPricePesewas = toPesewas(product.default_price);
    if (cart.some((line) => line.productId === product.id)) {
      addProduct(product, unitPricePesewas);
      return;
    }
    if (Number.isSafeInteger(unitPricePesewas) && unitPricePesewas > 0) {
      onNavigate("HowManyItem", { product, saleItems: cart });
      return;
    }
    onNavigate("HowMuchIsItem", { product, saleItems: cart });
  }

  return (
    <PosPage className="flex flex-col gap-3">
      <h1 className="text-2xl font-extrabold">{t("sellItems.title")}</h1>
      <label className="flex min-h-14 items-center gap-2 rounded-2xl border-[3px] border-slate-500 px-3">
        <Search size={24} aria-hidden="true" />
        <span className="sr-only">{t("sellItems.find")}</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("sellItems.find")} className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none" />
      </label>

      {result === undefined ? (
        <p role="status">{t("items.loading")}</p>
      ) : result.error ? (
        <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{result.error}</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {products.map((product) => (
            <button key={product.id} type="button" onClick={() => chooseProduct(product)} className="flex min-h-[72px] items-center gap-2 rounded-2xl border-2 border-slate-500 bg-white px-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800">
              <span className="min-w-0 flex-1">
                <strong className="block whitespace-normal break-words text-base">{product.name}</strong>
                <span className="block whitespace-normal break-words text-sm font-bold text-emerald-900">{product.default_price > 0 ? formatGhs(toPesewas(product.default_price)) : t("items.setPrice")}</span>
              </span>
              <Plus size={20} className="shrink-0 text-emerald-900" aria-hidden="true" />
            </button>
          ))}
          <button type="button" onClick={() => onNavigate("NewItem")} className="min-h-[72px] rounded-2xl border-[3px] border-dashed border-emerald-900 bg-white px-2 text-lg font-extrabold text-emerald-900">
            <Plus size={22} className="mr-1 inline" aria-hidden="true" />{t("sellItems.newItem")}
          </button>
          {!products.length && <p className="col-span-2 rounded-xl border-2 border-slate-300 bg-white p-3 font-semibold">{t("sellItems.noMatches")}</p>}
        </div>
      )}

      {cart.length > 0 && (
        <PosCard className="space-y-2 p-3">
          {cart.map((line) => (
            <div key={line.productId} className="flex flex-col gap-2 border-b border-slate-200 pb-2 last:border-b-0 last:pb-0">
              <div className="flex items-start justify-between gap-3">
                <strong className="min-w-0 flex-1 whitespace-normal break-words text-base">{line.name}</strong>
                <strong className="shrink-0 text-right">{formatGhs(line.total_amount)}</strong>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" aria-label={t("sellItems.remove", { name: line.name })} onClick={() => updateCart(cart.filter((item) => item.productId !== line.productId))} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border-2 border-slate-500 bg-white text-rose-900"><Trash2 size={20} aria-hidden="true" /></button>
                <button type="button" aria-label={t("sellItems.less", { name: line.name })} onClick={() => updateCart(cart.map((item) => item.productId === line.productId ? { ...item, quantity: Math.max(1, item.quantity - 1) } : item))} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border-2 border-slate-500 bg-white"><Minus size={20} aria-hidden="true" /></button>
                <span aria-label={t("sellItems.quantity", { name: line.name })} className="min-w-7 text-center text-lg font-extrabold">{line.quantity}</span>
                <button type="button" aria-label={t("sellItems.more", { name: line.name })} onClick={() => updateCart(cart.map((item) => item.productId === line.productId ? { ...item, quantity: item.quantity + 1 } : item))} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border-2 border-slate-500 bg-white"><Plus size={20} aria-hidden="true" /></button>
                <span className="min-w-0 flex-1 text-right text-sm font-semibold text-slate-700">{t("sellItems.each", { amount: formatGhs(line.unitPricePesewas) })}</span>
              </div>
            </div>
          ))}
        </PosCard>
      )}

      {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
      <div className="mt-auto grid grid-cols-2 gap-2">
        <PosSecondaryButton type="button" onClick={onBack}>{t("sellItems.back")}</PosSecondaryButton>
        <PosPrimaryButton type="button" disabled={!cart.length || result === undefined} onClick={() => onNavigate("Sell", { amountPesewas: total, saleItems: cart })}>
          {t("sellItems.next", { amount: formatGhs(total) })}
        </PosPrimaryButton>
      </div>
    </PosPage>
  );
}
