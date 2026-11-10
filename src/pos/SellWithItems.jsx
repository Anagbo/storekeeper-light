import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Minus, Plus, Search, Trash2 } from "lucide-react";
import { db } from "../db/db.js";
import { formatGhs, formatGhsCompactAmount, toPesewas } from "../lib/money.js";
import { normalizeSaleItems, totalSaleItemsPesewas } from "../lib/saleItems.js";
import { PosCard, PosPage, PosPrimaryButton, PosBackButton } from "./PosComponents.jsx";
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

function getCart(params) {
  const items = normalizeSaleItems(params.saleItems ?? []);
  if (items.length > 0 || !Number.isSafeInteger(params.amountPesewas) || params.amountPesewas <= 0) {
    return items;
  }
  return normalizeSaleItems([{
    productId: null,
    name: "Other amount",
    subtitle: "From Sell",
    quantity: 1,
    unitPricePesewas: params.amountPesewas
  }, ...items]);
}

export default function SellWithItems({ params = {}, onBack, onNavigate, onUpdateParams }) {
  const result = useSellableProducts();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const cart = getCart(params);
  const total = totalSaleItemsPesewas(cart);
  const normalizedQuery = query.trim().toLowerCase();
  const products = useMemo(() => (result?.products ?? []).filter((product) =>
    product.name.toLowerCase().includes(normalizedQuery)
  ), [normalizedQuery, result]);

  function updateCart(nextCart) {
    try {
      const normalized = normalizeSaleItems(nextCart);
      const nextTotal = totalSaleItemsPesewas(normalized);
      onUpdateParams({ amountPesewas: nextTotal, saleItems: normalized });
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
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {products.map((product) => {
            const unitPrice = toPesewas(product.default_price);
            const hasPrice = Number.isSafeInteger(unitPrice) && unitPrice > 0;
            return (
              <button
                key={product.id}
                type="button"
                onClick={() => chooseProduct(product)}
                className="flex min-h-[72px] items-center gap-2.5 rounded-[18px] border-2 border-slate-500 bg-white px-2.5 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-900 text-lg font-extrabold text-white">
                  {product.name.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-base font-extrabold text-slate-900">{product.name}</strong>
                  <span className="block whitespace-nowrap text-sm font-bold text-emerald-900">
                    {hasPrice ? formatGhsCompactAmount(unitPrice) : t("items.setPrice")}
                  </span>
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => onNavigate("NewItem")}
            className="min-h-[72px] rounded-[18px] border-[3px] border-dashed border-emerald-900 bg-white px-2 text-base font-extrabold text-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800"
          >
            + {t("sellItems.newItem")}
          </button>
          {!products.length && <p className="col-span-2 sm:col-span-3 rounded-xl border-2 border-slate-300 bg-white p-3 font-semibold">{t("sellItems.noMatches")}</p>}
        </div>
      )}

      {cart.length > 0 && (
        <section className="space-y-2 rounded-[18px] border-2 border-slate-500 bg-white p-3">
          {cart.map((line) => line.productId === null ? (
            <div key="other-amount" className="flex min-h-12 items-center gap-0.5 border-b border-slate-200 pb-2 last:border-b-0 last:pb-0 sm:gap-2">
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-base font-extrabold text-slate-900 sm:text-[19px]">{line.name}</strong>
                <span className="block text-sm text-slate-700">{line.subtitle}</span>
              </span>
              <b className="ml-auto w-20 shrink-0 text-right text-sm font-extrabold tabular-nums text-slate-900 sm:text-[19px]">
                {formatGhsCompactAmount(line.total_amount)}
              </b>
              <button
                type="button"
                aria-label={t("sellItems.remove", { name: line.name })}
                onClick={() => updateCart(cart.filter((item) => item.productId !== null))}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-[12px] border-2 border-slate-500 bg-white text-rose-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 sm:h-12 sm:w-12"
              >
                <Trash2 size={20} className="sm:h-[22px] sm:w-[22px]" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div key={line.productId} className="flex min-h-12 items-center gap-0.5 border-b border-slate-200 pb-2 last:border-b-0 last:pb-0 sm:gap-2">
              <strong className="min-w-0 flex-1 truncate text-base font-extrabold text-slate-900 sm:text-[19px]">{line.name}</strong>
              <button
                type="button"
                aria-label={t("sellItems.less", { name: line.name })}
                disabled={line.quantity === 1}
                onClick={() => updateCart(cart.map((item) => item.productId === line.productId ? { ...item, quantity: item.quantity - 1 } : item))}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-[12px] border-2 border-slate-500 bg-white text-xl font-extrabold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 disabled:cursor-not-allowed disabled:opacity-40 sm:h-12 sm:w-12"
              >
                −
              </button>
              <button
                type="button"
                aria-label={t("sellItems.quantity", { name: line.name })}
                onClick={() => onNavigate("HowManyItem", {
                  product: { id: line.productId, name: line.name, default_price: line.unitPricePesewas / 100 },
                  quantity: line.quantity,
                  saleItems: cart,
                  mode: "edit"
                })}
                className="flex h-9 min-w-8 shrink-0 items-center justify-center border-0 border-b-[3px] border-emerald-900 bg-transparent px-0 text-base font-extrabold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 sm:h-12 sm:min-w-11 sm:px-1 sm:text-[22px]"
              >
                {line.quantity}
              </button>
              <button
                type="button"
                aria-label={t("sellItems.more", { name: line.name })}
                onClick={() => updateCart(cart.map((item) => item.productId === line.productId ? { ...item, quantity: item.quantity + 1 } : item))}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-[12px] border-2 border-slate-500 bg-white text-xl font-extrabold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 sm:h-12 sm:w-12"
              >
                +
              </button>
              <b className="ml-auto w-20 shrink-0 text-right text-sm font-extrabold tabular-nums text-slate-900 sm:text-[19px]">
                {formatGhsCompactAmount(line.total_amount)}
              </b>
              <button
                type="button"
                aria-label={t("sellItems.remove", { name: line.name })}
                onClick={() => updateCart(cart.filter((item) => item.productId !== line.productId))}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-[12px] border-2 border-slate-500 bg-white text-rose-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 sm:h-12 sm:w-12"
              >
                <Trash2 size={20} className="sm:h-[22px] sm:w-[22px]" aria-hidden="true" />
              </button>
            </div>
          ))}
        </section>
      )}

      {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
      <div className="mt-auto mb-2 grid grid-cols-2 gap-2">
        <PosBackButton onClick={onBack} />
        <PosPrimaryButton type="button" disabled={!cart.length || result === undefined} onClick={() => onNavigate("ReviewAndPay", { amountPesewas: total, saleItems: cart })}>
          {t("sellItems.next", { amount: formatGhs(total) })}
        </PosPrimaryButton>
      </div>
    </PosPage>
  );
}
