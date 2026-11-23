import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Search, Trash2 } from "lucide-react";
import { db } from "../db/db.js";
import { formatGhs, toPesewas } from "../lib/money.js";
import { normalizeSaleItems, totalSaleItemsPesewas } from "../lib/saleItems.js";
import { AddButton } from "./PosComponents.jsx";
import { posText as t } from "./i18n.js";

// The parts of Sell with items (20) shared by the phone screen and the wide D9 screen: the cart, the
// item tiles with Find item, and the sale lines. Same markup, labels and handlers on every width.

const STEP_CLASS = "grid h-11 w-11 shrink-0 place-items-center rounded-[12px] border-2 border-slate-500 bg-white text-xl font-extrabold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800";
const BIN_CLASS = "grid h-11 w-11 shrink-0 place-items-center rounded-[12px] border-2 border-slate-500 bg-white text-rose-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800";

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

export function getCart(params) {
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

// The cart of 20 in its route params, the item list and Find item. Every change goes through
// onUpdateParams (amountPesewas is the cart total), as on the phone.
export function useSellCart({ params = {}, onNavigate, onUpdateParams }) {
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

  function openQuantity(line) {
    onNavigate("HowManyItem", {
      product: { id: line.productId, name: line.name, default_price: line.unitPricePesewas / 100 },
      quantity: line.quantity,
      saleItems: cart,
      mode: "edit"
    });
  }

  return { result, query, setQuery, normalizedQuery, products, cart, total, error, updateCart, chooseProduct, openQuantity };
}

export function ItemSearch({ query, onChange }) {
  return (
    <label className="flex min-h-14 items-center gap-2 rounded-2xl border-[3px] border-slate-500 px-3">
      <Search size={24} aria-hidden="true" />
      <span className="sr-only">{t("sellItems.find")}</span>
      <input value={query} onChange={(event) => onChange(event.target.value)} placeholder={t("sellItems.find")} className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none" />
    </label>
  );
}

// The tiles, + New item and the empty and search states (wiring 20 "Item tiles", "Empty and search
// states"). gridClassName, newItemClassName and emptyClassName let D9 set its own columns; children
// come after + New item (the wide Other amount tile).
export function ItemTiles({ cart, products, result, normalizedQuery, onChoose, onNewItem, gridClassName, newItemClassName, emptyClassName, tileClassName = "", children }) {
  if (result === undefined) return <p role="status">{t("items.loading")}</p>;
  if (result.error) return <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{result.error}</p>;
  return (
    <div className={gridClassName ?? "grid grid-cols-2 gap-2 sm:grid-cols-3"}>
      {products.map((product) => {
        const unitPrice = toPesewas(product.default_price);
        const hasPrice = Number.isSafeInteger(unitPrice) && unitPrice > 0;
        const priceText = hasPrice ? formatGhs(unitPrice) : t("items.setPrice");
        // Wiring 20 "Item tiles": a tile whose item is in the sale is selected (light green, 3px
        // green border) with a ×n badge, never colour alone; the name says it too.
        const inSale = cart.find((line) => line.productId === product.id)?.quantity ?? 0;
        return (
          <button
            key={product.id}
            type="button"
            data-item-tile={product.name}
            aria-label={inSale > 0
              ? t("sellItems.tileNameInSale", { name: product.name, price: priceText, count: inSale })
              : t("sellItems.tileName", { name: product.name, price: priceText })}
            onClick={() => onChoose(product)}
            className={`relative flex min-h-[72px] flex-col justify-center gap-1 rounded-[18px] px-2.5 pb-2 pt-5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 ${inSale > 0 ? "border-[3px] border-emerald-900 bg-green-100" : "border-2 border-slate-500 bg-white"}${tileClassName ? ` ${tileClassName}` : ""}`}
          >
            {/* Row 1: the letter and the name (the name wraps to two lines rather than squeeze the
                price). Row 2: the price on one line across the whole tile (a four-digit price fits at 340px). */}
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-900 text-lg font-extrabold text-white">
                {product.name.charAt(0).toUpperCase()}
              </span>
              <strong data-tile-name="" className="line-clamp-2 min-w-0 flex-1 break-words text-base font-extrabold leading-tight text-slate-900">{product.name}</strong>
            </span>
            <span data-tile-price="" className="block whitespace-nowrap text-sm font-bold tabular-nums text-emerald-900">{priceText}</span>
            {/* The badge sits on the top-right corner, over the edge, so it never covers the name
                or the price (the tile's top padding keeps the name below it). */}
            {inSale > 0 && (
              <span data-count-badge="" className="absolute -right-1.5 -top-1.5 grid h-6 min-w-6 place-items-center rounded-full bg-emerald-900 px-1.5 text-sm font-bold leading-none tabular-nums text-white ring-2 ring-white">×{inSale}</span>
            )}
          </button>
        );
      })}
      {/* "+ New item" never sits alone in a half-width row: with an even number of item tiles
          (zero included, and a search that matches nothing) it spans the whole row; with an odd
          number it is the last tile, beside the last item. One rule on the tile count. */}
      {/* rules_global.button_system.add: the shared AddButton as the 72px grid tile. */}
      <AddButton size="tile" onClick={onNewItem} className={newItemClassName ?? (products.length % 2 === 0 ? "col-span-full" : "")}>
        {t("sellItems.newItem")}
      </AddButton>
      {children}
      {/* Wiring 20 "Empty and search states": no items at all and nothing typed says how to add
          the first one; "No items match that search." only when something typed matches nothing.
          "+ New item" is a <strong> in the tile label's dark green; the rest is regular weight. */}
      {!products.length && (
        <p className={emptyClassName ?? "col-span-2 sm:col-span-3 rounded-xl border-2 border-slate-300 bg-white p-3"}>
          {normalizedQuery ? t("sellItems.noMatches") : (
            <>
              {t("sellItems.noItemsYetStart")}{" "}
              <strong className="font-extrabold text-emerald-900">+ {t("sellItems.newItem")}</strong>{" "}
              {t("sellItems.noItemsYetEnd")}
            </>
          )}
        </p>
      )}
    </div>
  );
}

// The lines of the sale with their controls (wiring 20 "Line controls and amounts"): below 640px an item
// line has two rows; from 640px (and so on every wide layout) one row: name, Less, quantity, More, the
// amount, the bin. The Other amount line has no stepper.
export function SaleLines({ cart, onUpdateCart, onQuantity, className = "space-y-2 rounded-[18px] border-2 border-slate-500 bg-white p-3" }) {
  return (
    <section className={className}>
      {cart.map((line) => line.productId === null ? (
        <div key="other-amount" className="flex min-h-12 items-center gap-2 border-b border-slate-200 pb-2 last:border-b-0 last:pb-0">
          <span className="min-w-0 flex-1">
            <strong className="block truncate text-base font-extrabold text-slate-900 sm:text-[19px]">{line.name}</strong>
            <span className="block text-sm text-slate-700">{line.subtitle}</span>
          </span>
          <b className="ml-auto shrink-0 whitespace-nowrap text-right text-base font-extrabold tabular-nums text-slate-900 sm:text-[19px]">
            {formatGhs(line.total_amount)}
          </b>
          <button
            type="button"
            aria-label={t("sellItems.remove", { name: line.name })}
            onClick={() => onUpdateCart(cart.filter((item) => item.productId !== null))}
            className={BIN_CLASS}
          >
            <Trash2 size={22} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div key={line.productId} className="flex flex-col gap-2 border-b border-slate-200 pb-2 last:border-b-0 last:pb-0 sm:flex-row sm:items-center">
          <div className="flex items-start justify-between gap-2 sm:contents">
            <strong className="min-w-0 flex-1 break-words text-base font-extrabold leading-tight text-slate-900 sm:order-1 sm:text-[19px]">{line.name}</strong>
            <b className="shrink-0 whitespace-nowrap text-right text-base font-extrabold tabular-nums text-slate-900 sm:order-5 sm:ml-auto sm:min-w-20 sm:text-[19px]">
              {formatGhs(line.total_amount)}
            </b>
          </div>
          <div className="flex items-center justify-between gap-2 sm:contents">
            <div className="flex items-center gap-1 sm:contents">
              <button
                type="button"
                aria-label={t("sellItems.less", { name: line.name })}
                disabled={line.quantity === 1}
                onClick={() => onUpdateCart(cart.map((item) => item.productId === line.productId ? { ...item, quantity: item.quantity - 1 } : item))}
                className={STEP_CLASS + " sm:order-2 disabled:cursor-not-allowed disabled:opacity-40"}
              >
                −
              </button>
              <button
                type="button"
                aria-label={t("sellItems.quantity", { name: line.name })}
                onClick={() => onQuantity(line)}
                className="flex h-11 min-w-11 shrink-0 items-center justify-center border-0 border-b-[3px] border-emerald-900 bg-transparent px-1 text-lg font-extrabold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 sm:order-3 sm:text-[22px]"
              >
                {line.quantity}
              </button>
              <button
                type="button"
                aria-label={t("sellItems.more", { name: line.name })}
                onClick={() => onUpdateCart(cart.map((item) => item.productId === line.productId ? { ...item, quantity: item.quantity + 1 } : item))}
                className={STEP_CLASS + " sm:order-4"}
              >
                +
              </button>
            </div>
            <button
              type="button"
              aria-label={t("sellItems.remove", { name: line.name })}
              onClick={() => onUpdateCart(cart.filter((item) => item.productId !== line.productId))}
              className={BIN_CLASS + " sm:order-6"}
            >
              <Trash2 size={22} strokeWidth={2.2} aria-hidden="true" />
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
