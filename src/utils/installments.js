import { normalizeWhatsAppPhone } from "./whatsapp.js";

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
  startToday = false
}) {
  const plan = createInstallmentPlan({
    amountPesewas,
    installmentAmountPesewas,
    frequency,
    nextDueDate
  });
  if (!startToday) return { plan, initialPaymentPesewas: 0 };

  const initialPaymentPesewas = Math.min(amountPesewas, installmentAmountPesewas);
  const remainingAmountPesewas = amountPesewas - initialPaymentPesewas;
  const installmentsRemaining = Math.ceil(remainingAmountPesewas / installmentAmountPesewas);
  return {
    initialPaymentPesewas,
    plan: {
      ...plan,
      isInstallmentPlan: installmentsRemaining > 0,
      nextDueDate: installmentsRemaining > 0
        ? addDueCycles(nextDueDate, frequency, 1)
        : "",
      installmentsRemaining
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
  date.setUTCDate(date.getUTCDate() + cycles * daysPerCycle);
  return date.toISOString().slice(0, 10);
}

export function reconcileInstallmentPayment(debt, paymentPesewas, remainingPesewas) {
  if (!debt.isInstallmentPlan || remainingPesewas <= 0) {
    return {
      isInstallmentPlan: false,
      installmentsRemaining: 0,
      nextDueDate: ""
    };
  }

  const installmentAmountPesewas = debt.installmentAmount;
  if (!Number.isSafeInteger(installmentAmountPesewas) || installmentAmountPesewas <= 0) {
    throw new TypeError("This installment plan has an invalid installment amount.");
  }
  if (!isPaymentFrequency(debt.frequency) || !isValidDateString(debt.nextDueDate)) {
    throw new TypeError("This installment plan has invalid schedule details.");
  }

  const remainingInstallments = Number.isSafeInteger(debt.installmentsRemaining)
    ? Math.max(0, debt.installmentsRemaining)
    : Math.ceil(debt.amountPesewas / installmentAmountPesewas);
  const completedCycles = Math.min(
    remainingInstallments,
    Math.floor(paymentPesewas / installmentAmountPesewas)
  );
  const nextInstallmentsRemaining = remainingInstallments - completedCycles;

  return {
    isInstallmentPlan: nextInstallmentsRemaining > 0,
    installmentsRemaining: nextInstallmentsRemaining,
    nextDueDate: nextInstallmentsRemaining > 0 && completedCycles > 0
      ? addDueCycles(debt.nextDueDate, debt.frequency, completedCycles)
      : debt.nextDueDate
  };
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
  const message = `Hi ${name}, gentle reminder that your installment of GHS ${(installmentAmountPesewas / 100).toFixed(2)} ${duePhrase}. Thank you!`;
  return `https://wa.me/${normalizedPhone.slice(1)}?text=${encodeURIComponent(message)}`;
}
