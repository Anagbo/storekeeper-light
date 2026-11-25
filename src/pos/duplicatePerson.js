import { db } from "../db/db.js";
import { nationalNumber } from "../lib/phoneSearch.js";
import { getSupplierBalances } from "../utils/suppliers.js";

// rules_global.duplicate_person (25 Nov 2026): before a new person (customer or supplier) is saved,
// the name (trimmed, ignoring case) and the phone are checked against everyone already known,
// including people who owe 0 and are hidden from the lists. Never a silent duplicate.

// The name as compared: spaces at the ends and runs of spaces inside do not count, nor does case.
export function personNameKey(name) {
  return String(name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

// The first person with the same name, otherwise the first with the same phone (a full number only,
// compared through the phone_search rule, so 024…, +233 24… and 233 24… are the same). Null when none.
export function findDuplicatePerson(people, { name = "", phone = "" } = {}) {
  const key = personNameKey(name);
  if (key) {
    const person = people.find((candidate) => personNameKey(candidate.name) === key);
    if (person) return { person, by: "name" };
  }
  const number = nationalNumber(phone);
  if (number.length >= 9) {
    const person = people.find((candidate) => nationalNumber(candidate.phone) === number);
    if (person) return { person, by: "phone" };
  }
  return null;
}

// Every customer the app knows: the customers table and every debt's name (paid ones too), with what
// they owe now (unpaid debts only) and their largest unpaid debt, the same shape 17 passes on.
export async function loadKnownCustomers() {
  const [customers, debts] = await Promise.all([db.customers.toArray(), db.debts.toArray()]);
  const byName = new Map(customers.map((customer) => [personNameKey(customer.name), { ...customer, totalDebtPesewas: 0 }]));
  for (const debt of debts) {
    const name = (debt.customerName ?? debt.customer_name ?? "").trim();
    const key = personNameKey(name);
    if (!key) continue;
    const person = byName.get(key) ?? {
      id: debt.customerId ?? "",
      name,
      nameLower: name.toLowerCase(),
      phone: debt.phone ?? debt.customer_phone ?? "",
      ghanaCardNumber: debt.ghanaCardNumber ?? "",
      totalDebtPesewas: 0
    };
    if (debt.status === "unpaid") {
      const amount = debt.amountPesewas ?? debt.total_owed ?? 0;
      person.totalDebtPesewas += amount;
      if (!person.debt || amount > (person.debt.amountPesewas ?? 0)) person.debt = debt;
    }
    byName.set(key, person);
  }
  return [...byName.values()];
}

// Every supplier, with what the owner owes them now (0 when nothing is open).
export function suppliersWithBalances(suppliers, transactions) {
  let open = [];
  try {
    open = getSupplierBalances(transactions, suppliers);
  } catch (error) {
    console.error("Could not work out what is owed to suppliers.", error);
  }
  const owed = new Map(open.map((supplier) => [supplier.id, supplier.balancePesewas]));
  return suppliers.map((supplier) => ({ ...supplier, balancePesewas: owed.get(supplier.id) ?? 0 }));
}
