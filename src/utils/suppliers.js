import { localDateString } from "./installments.js";

export const SUPPLIER_CATEGORIES = ["stock", "transport", "rent", "utilities", "other"];

export function getSupplierBalances(transactions, suppliers, today = localDateString()) {
  const balances = new Map(suppliers.map((supplier) => [supplier.id, {
    ...supplier,
    balancePesewas: 0,
    nextDueDate: "",
    phone: supplier.phone ?? ""
  }]));
  const purchases = new Map();
  for (const transaction of transactions
    .filter((record) => record.type === "expense" && record.category === "stock")
    .sort((left, right) => (left.createdAt ?? left.timestamp) - (right.createdAt ?? right.timestamp))) {
    if (transaction.supplierId && balances.has(transaction.supplierId)) {
      const owed = transaction.owedAmountPesewas ?? Math.max(
        0,
        transaction.amountPesewas - (transaction.paidAmountPesewas ?? transaction.amountPesewas)
      );
      if (!Number.isSafeInteger(owed) || owed < 0) {
        throw new RangeError(`Stock purchase ${transaction.id} has an invalid payable amount.`);
      }
      if (owed > 0) {
        const supplierPurchases = purchases.get(transaction.supplierId) ?? [];
        supplierPurchases.push({ remainingPesewas: owed, payBy: transaction.payBy ?? "" });
        purchases.set(transaction.supplierId, supplierPurchases);
      }
    }
  }

  for (const transaction of transactions
    .filter((record) => record.type === "supplier_payment")
    .sort((left, right) => (left.createdAt ?? left.timestamp) - (right.createdAt ?? right.timestamp))) {
    if (!transaction.supplierId || !balances.has(transaction.supplierId)) continue;
    const amount = transaction.amountPesewas ?? transaction.total_amount;
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new RangeError(`Supplier payment ${transaction.id} has an invalid amount.`);
    }
    let remainingPayment = amount;
    const supplierPurchases = purchases.get(transaction.supplierId) ?? [];
    for (const purchase of supplierPurchases) {
      const applied = Math.min(remainingPayment, purchase.remainingPesewas);
      purchase.remainingPesewas -= applied;
      remainingPayment -= applied;
      if (remainingPayment === 0) break;
    }
    if (remainingPayment > 0) {
      throw new RangeError(`Supplier payments exceed recorded purchases for supplier ${transaction.supplierId}.`);
    }
  }

  for (const [supplierId, supplierPurchases] of purchases) {
    const supplier = balances.get(supplierId);
    const openPurchases = supplierPurchases.filter((purchase) => purchase.remainingPesewas > 0);
    supplier.balancePesewas = openPurchases.reduce((total, purchase) => {
      const next = total + purchase.remainingPesewas;
      if (!Number.isSafeInteger(next)) {
        throw new RangeError(`Supplier ${supplierId} has a balance outside the supported amount range.`);
      }
      return next;
    }, 0);
    const datedPurchases = openPurchases
      .filter((purchase) => /^\d{4}-\d{2}-\d{2}$/.test(purchase.payBy))
      .sort((left, right) => left.payBy.localeCompare(right.payBy));
    supplier.nextDueDate = datedPurchases[0]?.payBy ?? "";
    supplier.dueStatus = supplier.nextDueDate
      ? supplier.nextDueDate < today ? "late" : supplier.nextDueDate === today ? "today" : "upcoming"
      : "not_set";
  }
  return [...balances.values()]
    .filter((supplier) => supplier.balancePesewas > 0)
    .sort((left, right) => {
      const leftDate = left.nextDueDate || "9999-12-31";
      const rightDate = right.nextDueDate || "9999-12-31";
      return leftDate.localeCompare(rightDate) || left.name.localeCompare(right.name);
    });
}

export function validateSupplierExpense({ amountPesewas, paidAmountPesewas, category, supplierId }) {
  if (!Number.isSafeInteger(amountPesewas) || amountPesewas <= 0) {
    throw new TypeError("Enter a positive expense amount.");
  }
  if (!SUPPLIER_CATEGORIES.includes(category)) {
    throw new TypeError("Choose a valid expense category.");
  }
  if (!Number.isSafeInteger(paidAmountPesewas) || paidAmountPesewas < 0 || paidAmountPesewas > amountPesewas) {
    throw new TypeError("The amount paid must be between zero and the total expense.");
  }
  if (amountPesewas > paidAmountPesewas && !supplierId) {
    throw new TypeError("Choose a supplier when recording an unpaid balance.");
  }
}
