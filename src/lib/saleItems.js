export function normalizeSaleItems(items) {
  if (!Array.isArray(items)) throw new TypeError("Sale items must be a list.");

  return items.map((item) => {
    const name = typeof item?.name === "string" ? item.name.trim() : "";
    const productId = item?.productId;
    const quantity = item?.quantity;
    const unitPricePesewas = item?.unitPricePesewas;
    if (!name || name.length > 80 || !Number.isSafeInteger(productId) || productId <= 0) {
      throw new TypeError("Choose a valid item for this sale.");
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
    return { productId, name, quantity, unitPricePesewas, total_amount };
  });
}

export function totalSaleItemsPesewas(items) {
  const total = normalizeSaleItems(items).reduce((sum, item) => sum + item.total_amount, 0);
  if (!Number.isSafeInteger(total)) throw new RangeError("The sale total is too large.");
  return total;
}
