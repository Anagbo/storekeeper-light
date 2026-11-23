import { formatGhs } from "../lib/money.js";
import { PosPage, PosPrimaryButton, PosBackButton } from "./PosComponents.jsx";
import { posText as t } from "./i18n.js";
import { ItemSearch, ItemTiles, SaleLines, useSellCart } from "./SellItemsParts.jsx";

export default function SellWithItems({ params = {}, onBack, onNavigate, onUpdateParams }) {
  const sale = useSellCart({ params, onNavigate, onUpdateParams });
  const { result, cart, total, error } = sale;

  return (
    <PosPage className="flex flex-col gap-3">
      <h1 className="text-2xl font-extrabold">{t("sellItems.title")}</h1>
      <ItemSearch query={sale.query} onChange={sale.setQuery} />

      <ItemTiles
        cart={cart}
        products={sale.products}
        result={result}
        normalizedQuery={sale.normalizedQuery}
        onChoose={sale.chooseProduct}
        onNewItem={() => onNavigate("NewItem")}
      />

      {cart.length > 0 && <SaleLines cart={cart} onUpdateCart={sale.updateCart} onQuantity={sale.openQuantity} />}

      {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
      <div className="mt-auto mb-2 grid grid-cols-[auto_minmax(0,1fr)] gap-2">
        <PosBackButton onClick={onBack} className="h-14!" />
        <PosPrimaryButton type="button" disabled={!cart.length || result === undefined} onClick={() => onNavigate("ReviewAndPay", { amountPesewas: total, saleItems: cart })}>
          {t("sellItems.next", { amount: formatGhs(total) })}
        </PosPrimaryButton>
      </div>
    </PosPage>
  );
}
