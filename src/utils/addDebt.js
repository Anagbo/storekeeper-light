import { recordCreditSale } from "../db/debts.js";
import { normalizeGhanaCardNumber, isValidGhanaCardNumber } from "../lib/ghanaCardNumber.js";
import { formatGhs, toPesewas } from "../lib/money.js";
import {
  getCreditBalanceAfterSale,
  getNextCycleDate,
  localDateString,
  prepareInstallmentPlan
} from "./installments.js";

export function prepareAddDebt({
  customerName,
  amount,
  phone = "",
  ghanaCardNumber = "",
  isInstallmentPlan = false,
  installmentAmount = "",
  installmentFrequency = "weekly",
  installmentStartMode = "next-cycle",
  nextDueDate = getNextCycleDate(localDateString(), installmentFrequency),
  installmentPaymentMethod = "cash",
  note = "",
  existingDebtPesewas = 0,
  now = Date.now()
}) {
  const cleanCustomerName = customerName.trim();
  const amountPesewas = Number.isSafeInteger(amount) ? amount : toPesewas(amount);
  if (!cleanCustomerName) throw new TypeError("A customer name is required.");
  if (!Number.isSafeInteger(amountPesewas) || amountPesewas <= 0) {
    throw new TypeError(`Enter a debt amount greater than ${formatGhs(0)}.`);
  }
  if (!isValidGhanaCardNumber(ghanaCardNumber)) {
    throw new TypeError("Enter a Ghana Card number like GHA-123456789-0 or 1234567890.");
  }

  let installmentPlan = null;
  let initialPaymentPesewas = 0;
  if (isInstallmentPlan) {
    const preparedPlan = prepareInstallmentPlan({
      amountPesewas: getCreditBalanceAfterSale(existingDebtPesewas, amountPesewas),
      installmentAmountPesewas: toPesewas(installmentAmount),
      frequency: installmentFrequency,
      nextDueDate: installmentStartMode === "today" ? localDateString() : nextDueDate,
      startToday: installmentStartMode === "today",
      initialPaymentLimitPesewas: amountPesewas
    });
    installmentPlan = preparedPlan.plan;
    if (installmentStartMode === "today" && !installmentPlan.nextDueDate) {
      installmentPlan = {
        ...installmentPlan,
        nextDueDate: getNextCycleDate(localDateString(), installmentFrequency)
      };
    }
    initialPaymentPesewas = preparedPlan.initialPaymentPesewas;
  }

  const cleanNote = note.trim() || "Debt added";
  return {
    amountPesewas,
    name: cleanCustomerName,
    phone: phone.trim(),
    ghanaCardNumber: normalizeGhanaCardNumber(ghanaCardNumber),
    installmentPlan,
    initialPaymentPesewas,
    paymentMethod: installmentPaymentMethod,
    note: cleanNote,
    itemDescription: cleanNote,
    transactionNote: `${cleanNote} · ${cleanCustomerName}`,
    now
  };
}

export async function saveAddedDebt(input) {
  return recordCreditSale(prepareAddDebt(input));
}
