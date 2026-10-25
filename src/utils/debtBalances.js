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
      balance.ghanaCardNumber ||= debt.ghanaCardNumber || "";
      if (!balance.isInstallmentPlan && debt.isInstallmentPlan) {
        Object.assign(balance, {
          isInstallmentPlan: true,
          installmentAmount: debt.installmentAmount,
          frequency: debt.frequency,
          nextDueDate: debt.nextDueDate,
          installmentsRemaining: debt.installmentsRemaining,
          totalInstallments: debt.totalInstallments
        });
      }
    } else {
      balancesByCustomer.set(key, {
        id: key,
        customerName: customerName || "Unnamed customer",
        phone: debt.phone || debt.customer_phone || "",
        ghanaCardNumber: debt.ghanaCardNumber || "",
        amountPesewas: debt.amountPesewas ?? debt.total_owed ?? 0,
        ...(debt.isInstallmentPlan && {
          isInstallmentPlan: true,
          installmentAmount: debt.installmentAmount,
          frequency: debt.frequency,
          nextDueDate: debt.nextDueDate,
          installmentsRemaining: debt.installmentsRemaining,
          totalInstallments: debt.totalInstallments
        })
      });
    }
  }

  return [...balancesByCustomer.values()]
    .sort((a, b) => b.amountPesewas - a.amountPesewas)
    .slice(0, 3);
}
