export function getLargestUnpaidBalances(debts) {
  const balancesByCustomer = new Map();

  for (const debt of debts) {
    const customerName = (debt.customerName ?? debt.customer_name ?? "").trim();
    const normalizedName = customerName.toLowerCase();
    const key = normalizedName || `unnamed:${debt.id}`;
    const balance = balancesByCustomer.get(key);

    if (balance) {
      balance.amountPesewas += debt.amountPesewas ?? debt.total_owed ?? 0;
      balance.phone ||= debt.phone || debt.customer_phone || "";
    } else {
      balancesByCustomer.set(key, {
        id: key,
        customerName: customerName || "Unnamed customer",
        phone: debt.phone || debt.customer_phone || "",
        amountPesewas: debt.amountPesewas ?? debt.total_owed ?? 0
      });
    }
  }

  return [...balancesByCustomer.values()]
    .sort((a, b) => b.amountPesewas - a.amountPesewas)
    .slice(0, 3);
}
