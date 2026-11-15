export function getDefaultCollectionSplit(targetAmountPesewas, cashAmountPesewas) {
  if (!Number.isSafeInteger(targetAmountPesewas) || targetAmountPesewas <= 1) {
    throw new TypeError("The collection target must be at least two pesewas.");
  }
  if (!Number.isSafeInteger(cashAmountPesewas) || cashAmountPesewas <= 0 || cashAmountPesewas >= targetAmountPesewas) {
    return [];
  }
  return [
    { paymentMethod: "cash", amountPesewas: cashAmountPesewas },
    { paymentMethod: "momo", amountPesewas: targetAmountPesewas - cashAmountPesewas }
  ];
}

export function appendCollectionAmountDigit(current, digit) {
  if (digit === "backspace") return current.slice(0, -1);
  if (digit === "00" && current.length === 0) return "0";
  if (digit === "." && current.includes(".")) return current;
  const next = `${current}${digit}`;
  const [whole, fraction] = next.split(".");
  return fraction?.length > 2 || whole.length > 8 ? current : next;
}

export function normalizeCollectionAmountInput(value, current = "") {
  const next = String(value).replace(/[^\d.,]/g, "").replace(",", ".");
  if ((next.match(/\./g) ?? []).length > 1) return current;
  const [whole, fraction] = next.split(".");
  return whole.length > 8 || fraction?.length > 2 ? current : next;
}
