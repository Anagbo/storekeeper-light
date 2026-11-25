import { cleanItemName } from "./itemName.js";

export function normalizeSaleItems(items) {
  if (!Array.isArray(items)) throw new TypeError("Sale items must be a list.");

  return items.map((item) => {
    const name = cleanItemName(item?.name);
    const productId = item?.productId;
    const isOtherAmount = productId === null;
    const quantity = item?.quantity;
    const unitPricePesewas = item?.unitPricePesewas;
    if (!name || name.length > 80 || (!isOtherAmount && (!Number.isSafeInteger(productId) || productId <= 0))) {
      throw new TypeError("Choose a valid item for this sale.");
    }
    if (isOtherAmount && (name !== "Other amount" || item?.subtitle !== "From Sell" || quantity !== 1)) {
      throw new TypeError("The carried sale amount is invalid.");
    }
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new TypeError("Item quantities must be positive whole numbers.");
    }
    if (!Number.isSafeInteger(unitPricePesewas) || unitPricePesewas <= 0) {
      throw new TypeError("Item prices must be positive amounts.");
    }

    const total_amount = quantity * unitPricePesewas;
    if (!Number.isSafeInteger(total_amount)) {
      throw new RangeError("The item total is too large.");
    }
    // The cost snapshot (wiring COST IS PRIVATE) is passed through when present: integer pesewas or null.
    const cost = item?.cost_at_sale_pesewas;
    if (cost !== undefined && cost !== null && (!Number.isSafeInteger(cost) || cost < 0)) {
      throw new TypeError("The item cost snapshot is invalid.");
    }
    return {
      productId, name, ...(isOtherAmount ? { subtitle: item.subtitle } : {}), quantity, unitPricePesewas, total_amount,
      ...(cost !== undefined && { cost_at_sale_pesewas: cost })
    };
  });
}

export function totalSaleItemsPesewas(items) {
  const total = normalizeSaleItems(items).reduce((sum, item) => sum + item.total_amount, 0);
  if (!Number.isSafeInteger(total)) throw new RangeError("The sale total is too large.");
  return total;
}
