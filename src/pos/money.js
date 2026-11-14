import {
  getDebtBalancePesewas,
  getFinancialDateRange,
  getPreviousFinancialDateRange,
  getOutstandingDebtPesewas,
  summarizeFinancialTransactions,
  summarizePosMoney
} from "../lib/money.js";
import { formatDate } from "../lib/formatDate.js";
import { posText as t } from "./i18n.js";

function timestampOf(record) {
  const timestamp = record.createdAt ?? record.timestamp;
  const parsed = timestamp instanceof Date
    ? timestamp.getTime()
    : typeof timestamp === "number"
      ? timestamp
      : typeof timestamp === "string"
        ? Date.parse(timestamp)
        : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new RangeError(`Transaction ${record.id ?? "(unknown)"} has an invalid timestamp.`);
  }
  return parsed;
}

export function summarizeMoney(transactions) {
  return summarizePosMoney(transactions);
}

export function getMoneyPeriodRange(period, now = new Date()) {
  const range = getFinancialDateRange(period, "", "", now);
  if (!range) throw new TypeError("Choose a day, week, or month reporting period.");
  return range;
}

export function getPreviousMoneyPeriodRange(period, now = new Date()) {
  return getPreviousFinancialDateRange(period, now);
}

export { getOutstandingDebtPesewas };

// 22 Owed card: how many people owe (unpaid debts grouped by name, as getMostUrgentCustomerDebt
// groups them) and how many of them are late (an unpaid debt due before today).
export function summarizeOwedPeople(debts, today = new Date()) {
  const todayDate = new Date(today);
  todayDate.setHours(0, 0, 0, 0);
  const people = new Map();
  for (const debt of debts) {
    if (debt.status !== "unpaid" || getDebtBalancePesewas(debt) <= 0) continue;
    const name = (debt.customerName ?? debt.customer_name ?? "").trim();
    const key = name.toLowerCase() || `unnamed:${debt.id}`;
    const dueDate = debt.isInstallmentPlan ? debt.nextDueDate : debt.dueDate;
    const due = dueDate ? Date.parse(`${dueDate}T00:00:00`) : Number.NaN;
    people.set(key, people.get(key) === true || (Number.isFinite(due) && due < todayDate.getTime()));
  }
  return { people: people.size, late: [...people.values()].filter(Boolean).length };
}

export function getMostUrgentCustomerDebt(debts, today = new Date()) {
  const todayDate = new Date(today);
  todayDate.setHours(0, 0, 0, 0);
  const grouped = new Map();

  for (const debt of debts) {
    if (debt.status !== "unpaid") continue;
    // Wiring 22 "Nobody owes": only a balance above zero counts (older corrections to zero stayed unpaid; new ones are stored as paid).
    const balance = getDebtBalancePesewas(debt);
    if (balance <= 0) continue;
    const name = (debt.customerName ?? debt.customer_name ?? "").trim();
    const key = name.toLowerCase() || `unnamed:${debt.id}`;
    const item = grouped.get(key) ?? {
      customerName: name || t("home.unnamedCustomer"),
      phone: debt.phone ?? debt.customer_phone ?? "",
      amountPesewas: 0,
      dueDate: null,
      isInstallmentPlan: false,
      debtId: debt.id,
      selectedDueDate: null,
      selectedBalancePesewas: -1
    };
    item.amountPesewas += balance;
    if (!Number.isSafeInteger(item.amountPesewas)) {
      throw new RangeError("Customer debt total exceeds the safe integer range.");
    }
    item.phone ||= debt.phone ?? debt.customer_phone ?? "";
    const dueDate = debt.isInstallmentPlan ? debt.nextDueDate : debt.dueDate;
    if (dueDate) {
      if (!Number.isFinite(Date.parse(`${dueDate}T00:00:00`))) {
        throw new RangeError(`Debt ${debt.id ?? "(unknown)"} has an invalid due date.`);
      }
      if (!item.dueDate || dueDate < item.dueDate) item.dueDate = dueDate;
    }
    if (!item.debtId ||
      (dueDate && (!item.selectedDueDate || dueDate < item.selectedDueDate)) ||
      (dueDate === item.selectedDueDate && balance > item.selectedBalancePesewas) ||
      (!dueDate && !item.selectedDueDate && balance > item.selectedBalancePesewas)) {
      item.debtId = debt.id;
      item.selectedDueDate = dueDate ?? null;
      item.selectedBalancePesewas = balance;
    }
    item.isInstallmentPlan ||= Boolean(debt.isInstallmentPlan);
    grouped.set(key, item);
  }

  return [...grouped.values()].sort((left, right) => {
    const leftDue = left.dueDate ? Date.parse(`${left.dueDate}T00:00:00`) : Number.POSITIVE_INFINITY;
    const rightDue = right.dueDate ? Date.parse(`${right.dueDate}T00:00:00`) : Number.POSITIVE_INFINITY;
    const leftOverdue = leftDue < todayDate.getTime();
    const rightOverdue = rightDue < todayDate.getTime();
    if (leftOverdue !== rightOverdue) return leftOverdue ? -1 : 1;
    if (leftDue !== rightDue) return leftDue - rightDue;
    return right.amountPesewas - left.amountPesewas;
  })[0] ?? null;
}

export function getDebtDueLabel(dueDate, today = new Date()) {
  if (!dueDate) return t("debt.dueNotSet");
  const due = new Date(`${dueDate}T00:00:00`);
  if (!Number.isFinite(due.getTime())) throw new RangeError("The debt due date is invalid.");
  const current = new Date(today);
  due.setHours(0, 0, 0, 0);
  current.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - current.getTime()) / 86_400_000);
  if (days < 0) {
    const lateDays = Math.abs(days);
    return t("debt.lateDays", { days: lateDays, plural: lateDays === 1 ? "" : "s" });
  }
  if (days === 0) return t("debt.dueToday");
  return t("debt.inDays", { days, plural: days === 1 ? "" : "s" });
}

// 29 and 43: the line under the balance for a fixed due date with no plan, "Due 20/11/2026 · In 5 days"
// (the status is the existing wording: In N days, Late N days, Due today). Nothing without a date.
export function getDebtDueLine(dueDate, today = new Date()) {
  if (!dueDate) return "";
  return t("debt.dueLine", { date: formatDate(dueDate), status: getDebtDueLabel(dueDate, today) });
}

export function getTransactionTimestamp(transaction) {
  return timestampOf(transaction);
}

export { summarizeFinancialTransactions };
