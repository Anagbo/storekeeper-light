import Dexie from "dexie";
import { db } from "../db/db.js";
import { matchesSearch } from "../lib/searchMatch.js";

export const OWED_PAGE_SIZE = 25;

function getDebtName(debt) {
  return (debt.customerName ?? debt.customer_name ?? "").trim();
}

function getDebtBalance(debt) {
  return debt.amountPesewas ?? debt.total_owed ?? 0;
}

// Search on 32 (the same rule as 17, src/lib/searchMatch.js): name or phone.
export function matchesOwedSearch(customer, query) {
  return matchesSearch(query, customer?.customerName, customer?.phone);
}

// Every open debt, largest balance first (the order of the normal list). Used while the search
// field has text, so a person on a later page is found. Reads the phone's own database only.
export async function loadAllUnpaidDebts(database = db) {
  const debts = await database.debts.where("status").equals("unpaid").toArray();
  return debts.sort((left, right) => getDebtBalance(right) - getDebtBalance(left) ||
    String(right.id).localeCompare(String(left.id)));
}

export function getDebtDueDate(debt) {
  if (!debt) return "";
  return debt.isInstallmentPlan ? debt.nextDueDate ?? "" : debt.dueDate ?? "";
}

function daysUntilDue(dueDate, today = new Date()) {
  if (!dueDate) return null;
  const due = new Date(`${dueDate}T00:00:00`);
  const current = new Date(today);
  if (!Number.isFinite(due.getTime()) || !Number.isFinite(current.getTime())) return null;
  due.setHours(0, 0, 0, 0);
  current.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - current.getTime()) / 86_400_000);
}

export function isDebtLate(debt, today = new Date()) {
  const days = daysUntilDue(getDebtDueDate(debt), today);
  return days !== null && days < 0;
}

export function isDebtDueSoon(debt, today = new Date()) {
  const days = daysUntilDue(getDebtDueDate(debt), today);
  return days !== null && days >= 0 && days <= 7;
}

export function getOwedCursor(debt) {
  const amountPesewas = getDebtBalance(debt);
  if (!Number.isSafeInteger(amountPesewas) || amountPesewas < 0 || debt?.id === undefined) {
    throw new TypeError("An unpaid debt cursor requires a valid amount and ID.");
  }
  return { amountPesewas, id: debt.id };
}

function assertOwedPageSize(pageSize) {
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0 || pageSize > 100) {
    throw new RangeError("The Owed page size must be an integer between 1 and 100.");
  }
}

function assertOwedCursor(cursor) {
  if (cursor === null || cursor === undefined) return;
  if (!Number.isSafeInteger(cursor.amountPesewas) || cursor.amountPesewas < 0 || cursor.id === undefined) {
    throw new TypeError("The Owed cursor is invalid.");
  }
}

export async function loadUnpaidDebtPage({
  after = null,
  pageSize = OWED_PAGE_SIZE
} = {}, database = db) {
  assertOwedPageSize(pageSize);
  assertOwedCursor(after);
  const indexedDebts = database.debts.where("[status+amountPesewas+id]");
  const records = after
    ? await indexedDebts
        .below(["unpaid", after.amountPesewas, after.id])
        .filter((debt) => debt.status === "unpaid")
        .reverse()
        .limit(pageSize + 1)
        .toArray()
    : await indexedDebts
        .above(["unpaid", 0, 0])
        .filter((debt) => debt.status === "unpaid")
        .reverse()
        .limit(pageSize + 1)
        .toArray();
  const hasMore = records.length > pageSize;
  const debts = hasMore ? records.slice(0, pageSize) : records;
  return {
    debts,
    hasMore,
    nextCursor: hasMore ? getOwedCursor(debts[debts.length - 1]) : null
  };
}

export function groupUnpaidDebts(debts, customers = []) {
  const customersById = new Map(customers.map((customer) => [customer.id, customer]));
  const grouped = new Map();
  for (const debt of debts) {
    const name = getDebtName(debt);
    const normalizedName = name.toLowerCase();
    const key = debt.customerId || normalizedName || `unnamed:${debt.id}`;
    const customer = debt.customerId ? customersById.get(debt.customerId) : null;
    const existing = grouped.get(key);
    if (existing) {
      existing.balancePesewas += getDebtBalance(debt);
      existing.debtIds.push(debt.id);
      if (!existing.debt || (
        getDebtDueDate(debt) &&
        (!getDebtDueDate(existing.debt) ||
          getDebtDueDate(debt) < getDebtDueDate(existing.debt))
      )) existing.debt = debt;
      existing.phone ||= customer?.phone || debt.phone || debt.customer_phone || "";
      existing.ghanaCardNumber ||= customer?.ghanaCardNumber || debt.ghanaCardNumber || "";
      continue;
    }
    grouped.set(key, {
      id: key,
      customerId: debt.customerId ?? customer?.id ?? "",
      customerName: customer?.name || name || "Unnamed customer",
      phone: customer?.phone || debt.phone || debt.customer_phone || "",
      ghanaCardNumber: customer?.ghanaCardNumber || debt.ghanaCardNumber || "",
      balancePesewas: getDebtBalance(debt),
      debtIds: [debt.id],
      debt,
      representativeDebtId: debt.id
    });
  }
  return [...grouped.values()].sort((left, right) =>
    right.balancePesewas - left.balancePesewas ||
    left.customerName.localeCompare(right.customerName) ||
    left.id.localeCompare(right.id)
  );
}
