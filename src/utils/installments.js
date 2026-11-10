import { normalizeWhatsAppPhone } from "./whatsapp.js";
import { formatGhs } from "../lib/formatGhs.js";
import { PLAN_ERROR, planError } from "../lib/planErrors.js";

export function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isValidDateString(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const PAYMENT_FREQUENCIES = [
  { value: "weekly", label: "Weekly", daysPerCycle: 7 },
  { value: "bi-weekly", label: "Bi-weekly", daysPerCycle: 14 },
  { value: "monthly", label: "Monthly", daysPerCycle: 30 }
];

function isPaymentFrequency(value) {
  return PAYMENT_FREQUENCIES.some((frequency) => frequency.value === value);
}

export function getCreditBalanceAfterSale(currentDebtPesewas, saleAmountPesewas) {
  if (!Number.isSafeInteger(currentDebtPesewas) || currentDebtPesewas < 0 ||
    !Number.isSafeInteger(saleAmountPesewas) || saleAmountPesewas <= 0) {
    throw new TypeError("Current debt and sale amounts must be valid whole-pesewa amounts.");
  }
  const balance = currentDebtPesewas + saleAmountPesewas;
  if (!Number.isSafeInteger(balance)) throw new RangeError("The customer's credit balance exceeds the supported amount.");
  return balance;
}

export function getMaximumInstallmentAmountPesewas(currentDebtPesewas, saleAmountPesewas, startToday = false) {
  return getCreditBalanceAfterSale(currentDebtPesewas, saleAmountPesewas);
}

export function assertInstallmentAmountWithinBalance(installmentAmountPesewas, maximumCreditPesewas) {
  if (!Number.isSafeInteger(installmentAmountPesewas) || installmentAmountPesewas <= 0 ||
    !Number.isSafeInteger(maximumCreditPesewas) || maximumCreditPesewas <= 0) {
    throw new TypeError("Installment and credit amounts must be positive whole-pesewa amounts.");
  }
  if (installmentAmountPesewas > maximumCreditPesewas) {
    throw planError(PLAN_ERROR.eachTimeTooHigh, "Installment amount cannot exceed the customer's total credit balance.");
  }
}

export function isValidInstallmentPlanForBalance(plan, balancePesewas) {
  return Boolean(
    plan?.isInstallmentPlan &&
    Number.isSafeInteger(balancePesewas) &&
    balancePesewas > 0 &&
    Number.isSafeInteger(plan.installmentAmount) &&
    plan.installmentAmount > 0 &&
    plan.installmentAmount <= balancePesewas &&
    isPaymentFrequency(plan.frequency) &&
    isValidDateString(plan.nextDueDate)
  );
}

// The calendar day after a YYYY-MM-DD date.
export function dayAfter(dateString) {
  if (!isValidDateString(dateString)) throw new TypeError("A valid date is required.");
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function getNextCycleDate(today, frequency) {
  if (!isValidDateString(today) || !isPaymentFrequency(frequency)) {
    throw new TypeError("A valid date and installment frequency are required.");
  }
  return addDueCycles(today, frequency, 1);
}

export function createInstallmentPlan({ amountPesewas, installmentAmountPesewas, frequency, nextDueDate }) {
  if (!Number.isSafeInteger(amountPesewas) || amountPesewas <= 0) {
    throw new TypeError("Debt amount must be a positive integer number of pesewas.");
  }
  if (!Number.isSafeInteger(installmentAmountPesewas) || installmentAmountPesewas <= 0) {
    throw new TypeError("Installment amount must be a positive integer number of pesewas.");
  }
  if (installmentAmountPesewas > amountPesewas) {
    throw planError(PLAN_ERROR.eachTimeTooHigh, "Installment amount cannot exceed the debt amount.");
  }
  if (!isPaymentFrequency(frequency)) {
    throw new TypeError("Installment frequency must be weekly, bi-weekly, or monthly.");
  }
  if (!isValidDateString(nextDueDate)) {
    throw new TypeError("Choose a valid next installment due date.");
  }

  const totalInstallments = Math.ceil(amountPesewas / installmentAmountPesewas);
  return {
    isInstallmentPlan: true,
    installmentAmount: installmentAmountPesewas,
    frequency,
    nextDueDate,
    installmentsRemaining: totalInstallments,
    totalInstallments
  };
}

export function prepareInstallmentPlan({
  amountPesewas,
  installmentAmountPesewas,
  frequency,
  nextDueDate,
  startToday = false,
  initialPaymentLimitPesewas = installmentAmountPesewas
}) {
  if (!Number.isSafeInteger(amountPesewas) || amountPesewas <= 0) {
    throw new TypeError("Debt amount must be a positive integer number of pesewas.");
  }
  if (!isPaymentFrequency(frequency) || !isValidDateString(nextDueDate)) {
    throw new TypeError("A valid installment frequency and due date are required.");
  }
  if (!Number.isSafeInteger(initialPaymentLimitPesewas) || initialPaymentLimitPesewas < 0) {
    throw new TypeError("The initial payment limit must be a non-negative integer number of pesewas.");
  }
  if (!Number.isSafeInteger(installmentAmountPesewas) || installmentAmountPesewas <= 0) {
    throw new TypeError("Installment amount must be a positive integer number of pesewas.");
  }
  if (!startToday) {
    return {
      plan: createInstallmentPlan({ amountPesewas, installmentAmountPesewas, frequency, nextDueDate }),
      initialPaymentPesewas: 0
    };
  }

  const initialPaymentPesewas = Math.min(
    amountPesewas,
    initialPaymentLimitPesewas
  );
  const remainingAmountPesewas = amountPesewas - initialPaymentPesewas;
  if (remainingAmountPesewas === 0) {
    return {
      initialPaymentPesewas,
      plan: {
        isInstallmentPlan: false,
        installmentAmount: initialPaymentPesewas,
        frequency,
        nextDueDate: "",
        installmentsRemaining: 0,
        totalInstallments: 1
      }
    };
  }

  const preparedInstallmentAmountPesewas = Math.min(installmentAmountPesewas, remainingAmountPesewas);
  const installmentsRemaining = Math.ceil(remainingAmountPesewas / preparedInstallmentAmountPesewas);
  return {
    initialPaymentPesewas,
    plan: {
      isInstallmentPlan: true,
      installmentAmount: preparedInstallmentAmountPesewas,
      frequency,
      nextDueDate: addDueCycles(nextDueDate, frequency, 1),
      installmentsRemaining,
      totalInstallments: installmentsRemaining + 1
    }
  };
}

export function addDueCycles(dateString, frequency, cycles) {
  if (!isValidDateString(dateString) || !isPaymentFrequency(frequency)) {
    throw new TypeError("A valid due date and installment frequency are required.");
  }
  if (!Number.isSafeInteger(cycles) || cycles < 0) {
    throw new TypeError("Installment cycles must be a non-negative integer.");
  }

  const date = new Date(`${dateString}T00:00:00.000Z`);
  const { daysPerCycle } = PAYMENT_FREQUENCIES.find((option) => option.value === frequency);
  const dayOffset = cycles * daysPerCycle;
  const updatedTime = date.getTime() + dayOffset * 86_400_000;
  if (!Number.isSafeInteger(dayOffset) || !Number.isFinite(updatedTime) || Math.abs(updatedTime) > 8.64e15) {
    throw new RangeError("The installment date exceeds the supported range.");
  }
  date.setTime(updatedTime);
  const result = date.toISOString().slice(0, 10);
  if (!isValidDateString(result)) throw new RangeError("The installment date exceeds the supported range.");
  return result;
}

export function reconcileInstallmentPayment(debt, paymentPesewas, remainingPesewas) {
  const debtAmountPesewas = debt?.amountPesewas ?? debt?.total_owed;
  const reconciledBalancePesewas = paymentPesewas + remainingPesewas;
  if (!debt || !Number.isSafeInteger(reconciledBalancePesewas) ||
    !Number.isSafeInteger(paymentPesewas) || paymentPesewas <= 0 ||
    !Number.isSafeInteger(remainingPesewas) || remainingPesewas < 0 ||
    (debtAmountPesewas !== undefined &&
      (!Number.isSafeInteger(debtAmountPesewas) || debtAmountPesewas < 0 ||
        reconciledBalancePesewas !== debtAmountPesewas))) {
    throw new TypeError("Installment reconciliation requires a valid payment and matching debt balance.");
  }
  if (!debt.isInstallmentPlan || remainingPesewas <= 0) {
    return {
      isInstallmentPlan: false,
      installmentsRemaining: 0,
      nextDueDate: "",
      installmentPaymentCarryPesewas: 0
    };
  }

  const installmentAmountPesewas = debt.installmentAmount;
  if (!Number.isSafeInteger(installmentAmountPesewas) || installmentAmountPesewas <= 0) {
    throw new TypeError("This installment plan has an invalid installment amount.");
  }
  if (!isPaymentFrequency(debt.frequency) || !isValidDateString(debt.nextDueDate)) {
    throw new TypeError("This installment plan has invalid schedule details.");
  }
  // Payments left come from the balance (DRIFT-1/2/4), never from the stored counter, so a
  // counter that drifted on an older version cannot block a collection.
  if (!Number.isSafeInteger(reconciledBalancePesewas) || reconciledBalancePesewas <= 0) {
    throw new TypeError("This installment plan has no valid remaining balance.");
  }
  const carryPesewas = debt.installmentPaymentCarryPesewas ?? 0;
  if (!Number.isSafeInteger(carryPesewas) || carryPesewas < 0 || carryPesewas >= installmentAmountPesewas) {
    throw new TypeError("This installment plan has an invalid partial payment balance.");
  }
  const paidTowardInstallmentsPesewas = carryPesewas + paymentPesewas;
  if (!Number.isSafeInteger(paidTowardInstallmentsPesewas)) {
    throw new RangeError("The installment payment total exceeds the supported amount.");
  }

  // The carry and the due date still follow whole installments paid (display and schedule).
  const completedCycles = Math.floor(paidTowardInstallmentsPesewas / installmentAmountPesewas);
  const nextInstallmentsRemaining = Math.ceil(remainingPesewas / installmentAmountPesewas);

  return {
    isInstallmentPlan: nextInstallmentsRemaining > 0,
    installmentsRemaining: nextInstallmentsRemaining,
    nextDueDate: nextInstallmentsRemaining > 0 && completedCycles > 0
      ? addDueCycles(debt.nextDueDate, debt.frequency, completedCycles)
      : debt.nextDueDate,
    installmentPaymentCarryPesewas: nextInstallmentsRemaining > 0
      ? paidTowardInstallmentsPesewas % installmentAmountPesewas
      : 0
  };
}

export function reconcileInstallmentPlanChange(
  debt,
  nextBalancePesewas,
  replacementPlan,
  additionalPaymentPesewas = 0
) {
  if (replacementPlan?.isInstallmentPlan && Number.isSafeInteger(replacementPlan.installmentAmount) &&
    Number.isSafeInteger(nextBalancePesewas) && nextBalancePesewas > 0 &&
    replacementPlan.installmentAmount > nextBalancePesewas) {
    throw planError(PLAN_ERROR.eachTimeTooHigh, "The replacement installment plan is invalid.");
  }
  if (!Number.isSafeInteger(nextBalancePesewas) || nextBalancePesewas <= 0 ||
    !replacementPlan?.isInstallmentPlan ||
    !Number.isSafeInteger(replacementPlan.installmentAmount) ||
    replacementPlan.installmentAmount <= 0 ||
    replacementPlan.installmentAmount > nextBalancePesewas ||
    !isPaymentFrequency(replacementPlan.frequency) ||
    !isValidDateString(replacementPlan.nextDueDate)) {
    throw new TypeError("The replacement installment plan is invalid.");
  }
  if (!Number.isSafeInteger(additionalPaymentPesewas) || additionalPaymentPesewas < 0) {
    throw new TypeError("Additional installment payment must be a non-negative integer.");
  }

  const hasPreviousPlan = Boolean(debt?.isInstallmentPlan);
  const previousBalancePesewas = hasPreviousPlan ? debt.amountPesewas ?? debt.total_owed : 0;
  const previousRemaining = hasPreviousPlan
    ? debt.installmentsRemaining ?? Math.ceil(previousBalancePesewas / debt.installmentAmount)
    : 0;
  const previousTotal = hasPreviousPlan ? debt.totalInstallments ?? previousRemaining : 0;
  const previousCarry = hasPreviousPlan ? debt.installmentPaymentCarryPesewas ?? 0 : 0;
  if ((hasPreviousPlan && (
    !Number.isSafeInteger(previousBalancePesewas) || previousBalancePesewas < 0 ||
    !Number.isSafeInteger(previousRemaining) || previousRemaining < 0 ||
    !Number.isSafeInteger(previousTotal) || previousTotal < previousRemaining ||
    !Number.isSafeInteger(previousCarry) || previousCarry < 0 ||
    previousCarry >= debt.installmentAmount
  ))) {
    throw new TypeError("The existing installment plan is invalid.");
  }

  const historicalCompleted = previousTotal - previousRemaining;
  const progressPesewas = previousCarry + additionalPaymentPesewas;
  if (!Number.isSafeInteger(progressPesewas)) {
    throw new RangeError("The installment payment progress exceeds the supported amount.");
  }
  const completedCycles = Math.floor(progressPesewas / replacementPlan.installmentAmount);
  const nextCarry = progressPesewas % replacementPlan.installmentAmount;
  const nextRemaining = Math.ceil(nextBalancePesewas / replacementPlan.installmentAmount);
  const plannedRemaining = Number.isSafeInteger(replacementPlan.totalInstallments) &&
    replacementPlan.totalInstallments >= nextRemaining
    ? replacementPlan.totalInstallments
    : nextRemaining;
  const nextTotal = historicalCompleted + completedCycles + plannedRemaining;
  if (!Number.isSafeInteger(nextTotal) || nextTotal < nextRemaining) {
    throw new RangeError("The replacement installment schedule exceeds the supported range.");
  }

  return {
    ...replacementPlan,
    installmentsRemaining: nextRemaining,
    totalInstallments: nextTotal,
    nextDueDate: completedCycles > 0
      ? addDueCycles(replacementPlan.nextDueDate, replacementPlan.frequency, completedCycles)
      : replacementPlan.nextDueDate,
    installmentPaymentCarryPesewas: nextCarry
  };
}

export function reconcileInstallmentBalanceCorrection(debt, nextBalancePesewas) {
  if (!debt?.isInstallmentPlan) return {};
  if (!Number.isSafeInteger(nextBalancePesewas) || nextBalancePesewas < 0) {
    throw new TypeError("An installment correction needs a non-negative remaining balance.");
  }
  if (nextBalancePesewas === 0) {
    return {
      isInstallmentPlan: false,
      installmentsRemaining: 0,
      totalInstallments: 0,
      nextDueDate: "",
      installmentPaymentCarryPesewas: 0
    };
  }
  if (!Number.isSafeInteger(debt.installmentAmount) || debt.installmentAmount <= 0 ||
    !isPaymentFrequency(debt.frequency) || !isValidDateString(debt.nextDueDate)) {
    throw new TypeError("This installment plan has an invalid schedule.");
  }

  const carryPesewas = debt.installmentPaymentCarryPesewas ?? 0;
  if (!Number.isSafeInteger(carryPesewas) || carryPesewas < 0 ||
    carryPesewas >= debt.installmentAmount || carryPesewas > nextBalancePesewas) {
    throw new TypeError("This installment plan has an invalid partial payment balance.");
  }

  const previousRemaining = debt.installmentsRemaining ??
    Math.ceil((debt.amountPesewas ?? debt.total_owed) / debt.installmentAmount);
  const previousTotal = debt.totalInstallments ?? previousRemaining;
  if (!Number.isSafeInteger(previousRemaining) || previousRemaining <= 0 ||
    !Number.isSafeInteger(previousTotal) || previousTotal < previousRemaining) {
    throw new TypeError("This installment plan has invalid payment counts.");
  }

  const completedInstallments = previousTotal - previousRemaining;
  const nextRemaining = Math.ceil(nextBalancePesewas / debt.installmentAmount);
  const nextTotal = completedInstallments + nextRemaining;
  if (!Number.isSafeInteger(nextTotal) || nextTotal < nextRemaining) {
    throw new RangeError("The installment schedule exceeds the supported range.");
  }

  return {
    isInstallmentPlan: true,
    installmentsRemaining: nextRemaining,
    totalInstallments: nextTotal,
    nextDueDate: debt.nextDueDate,
    installmentPaymentCarryPesewas: carryPesewas
  };
}

// Payments left on a plan: balance ÷ installment amount, rounded up (owner rule, Batch 13).
// The stored installmentsRemaining is only a cache of this value.
export function getInstallmentsLeft(debt) {
  const balance = debt?.amountPesewas ?? debt?.total_owed;
  if (!debt?.isInstallmentPlan || debt.status === "paid" ||
    !Number.isSafeInteger(balance) || balance <= 0 ||
    !Number.isSafeInteger(debt.installmentAmount) || debt.installmentAmount <= 0) {
    return 0;
  }
  return Math.ceil(balance / debt.installmentAmount);
}

export function isInstallmentDue(debt, today = localDateString()) {
  return debt.isInstallmentPlan &&
    isValidDateString(debt.nextDueDate) &&
    debt.nextDueDate <= today;
}

export function getInstallmentAlertStatus(nextDueDate, frequency, today = localDateString()) {
  if (!isValidDateString(nextDueDate) || !isValidDateString(today)) {
    return { showAlert: false, type: "upcoming", days: 0 };
  }

  const thresholdMap = { weekly: 1, "bi-weekly": 3, monthly: 5 };
  const threshold = thresholdMap[frequency] ?? 1;
  const dueDay = Date.parse(`${nextDueDate}T00:00:00.000Z`);
  const todayDay = Date.parse(`${today}T00:00:00.000Z`);
  const daysUntilDue = Math.round((dueDay - todayDay) / 86_400_000);

  if (daysUntilDue < 0) {
    return { showAlert: true, type: "overdue", days: Math.abs(daysUntilDue) };
  }
  if (daysUntilDue === 0) return { showAlert: true, type: "due_today", days: 0 };
  if (daysUntilDue <= threshold) return { showAlert: true, type: "due_soon", days: daysUntilDue };
  return { showAlert: false, type: "upcoming", days: daysUntilDue };
}

export function createInstallmentReminderLink(phone, customerName, installmentAmountPesewas, alertStatus) {
  const normalizedPhone = normalizeWhatsAppPhone(phone);
  if (!normalizedPhone) return null;
  const name = typeof customerName === "string" ? customerName.trim() : "";
  if (!name || !Number.isSafeInteger(installmentAmountPesewas) || installmentAmountPesewas <= 0) return null;

  const duePhrase = alertStatus?.type === "overdue"
    ? `was due ${alertStatus.days} day${alertStatus.days === 1 ? "" : "s"} ago`
    : alertStatus?.type === "due_soon"
      ? `is due in ${alertStatus.days} day${alertStatus.days === 1 ? "" : "s"}`
      : "is due today";
  const message = `Hi ${name}, gentle reminder that your installment of ${formatGhs(installmentAmountPesewas)} ${duePhrase}. Thank you!`;
  return `https://wa.me/${normalizedPhone.slice(1)}?text=${encodeURIComponent(message)}`;
}
