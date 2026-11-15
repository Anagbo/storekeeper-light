import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import {
  correctDebtBalance,
  DEBT_ADJUSTMENT_REASON_CODES,
  recalculateCustomerDebtBalance,
  resolveCustomer,
  updateCustomerProfile
} from "../src/db/debtLedger.js";
import * as debtLedger from "../src/db/debtLedger.js";
import { db } from "../src/db/db.js";
import { summarizeFinancialTransactions, summarizePosMoney } from "../src/utils/financials.js";

const tables = [db.debts, db.customers, db.transactions, db.payments];

test("does not expose the obsolete direct debt-edit compatibility helper", () => {
  assert.equal("updateDebtDetails" in debtLedger, false);
});

before(async () => {
  await db.open();
});

beforeEach(async () => {
  await Promise.all(tables.map((table) => table.clear()));
});

after(async () => {
  db.close();
  await db.delete();
});

async function addCustomer(overrides = {}) {
  const customer = {
    id: "customer-1",
    name: "Ama Mensah",
    nameLower: "ama mensah",
    phone: "0241234567",
    ghanaCardNumber: "GHA-123456789-0",
    totalDebtPesewas: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  };
  await db.customers.add(customer);
  return customer;
}

async function addDebt(overrides = {}) {
  const debt = {
    id: "debt-1",
    customerId: "customer-1",
    customerName: "Ama Mensah",
    customer_name: "Ama Mensah",
    phone: "0241234567",
    customer_phone: "0241234567",
    amountPesewas: 1000,
    total_owed: 1000,
    status: "unpaid",
    createdAt: 1,
    created_at: 1,
    updatedAt: 10,
    synced: false,
    syncStatus: "pending",
    ...overrides
  };
  await db.debts.add(debt);
  return debt;
}

test("resolves an existing customer by stable id or normalized legacy name", async () => {
  const customer = await addCustomer();
  assert.equal((await resolveCustomer({ customerId: customer.id, name: "Different Name" })).id, customer.id);
  assert.equal((await resolveCustomer({ name: " ama mensah " })).id, customer.id);
  assert.equal((await db.customers.count()), 1);
});

test("recalculates customer balance from all unpaid debts", async () => {
  await addCustomer();
  await addDebt({ id: "debt-1", amountPesewas: 1000, total_owed: 1000 });
  await addDebt({ id: "debt-2", amountPesewas: 2500, total_owed: 2500 });
  await db.debts.add({
    id: "paid-debt",
    customerId: "customer-1",
    customerName: "Ama Mensah",
    customer_name: "Ama Mensah",
    amountPesewas: 9000,
    total_owed: 9000,
    status: "paid",
    updatedAt: 1
  });

  const customer = await recalculateCustomerDebtBalance({ customerId: "customer-1", now: 20 });
  assert.equal(customer.totalDebtPesewas, 3500);
  assert.equal((await db.customers.get("customer-1")).totalDebtPesewas, 3500);
});

test("updates and explicitly clears customer profile fields and active debt snapshots", async () => {
  await addCustomer();
  await addDebt();
  await db.debts.add({
    id: "paid-debt",
    customerId: "customer-1",
    customerName: "Ama Mensah",
    customer_name: "Ama Mensah",
    phone: "0241234567",
    customer_phone: "0241234567",
    amountPesewas: 500,
    total_owed: 500,
    status: "paid",
    updatedAt: 1
  });

  await updateCustomerProfile({
    customerId: "customer-1",
    name: "Ama Mensah",
    phone: "",
    ghanaCardNumber: "",
    expectedUpdatedAt: 1,
    now: 30
  });

  assert.equal((await db.customers.get("customer-1")).phone, "");
  assert.equal((await db.customers.get("customer-1")).ghanaCardNumber, "");
  assert.equal((await db.debts.get("debt-1")).phone, "");
  assert.equal((await db.debts.get("debt-1")).ghanaCardNumber, "");
  assert.equal((await db.debts.get("paid-debt")).phone, "0241234567");
});

test("links legacy name-only debts to the resolved customer during profile updates", async () => {
  await addCustomer();
  await db.debts.add({
    id: "legacy-debt",
    customerName: " ama mensah ",
    customer_name: " ama mensah ",
    phone: "0241234567",
    customer_phone: "0241234567",
    amountPesewas: 900,
    total_owed: 900,
    status: "unpaid",
    updatedAt: 1
  });

  await updateCustomerProfile({
    name: "Ama Mensah",
    phone: "024 555 6677",
    ghanaCardNumber: "GHA-987654321-0",
    expectedUpdatedAt: 1,
    now: 30
  });

  const debt = await db.debts.get("legacy-debt");
  assert.equal(debt.customerId, "customer-1");
  assert.equal(debt.phone, "+233245556677");
  assert.equal(debt.ghanaCardNumber, "GHA-987654321-0");
});

test("corrects a balance atomically and creates a non-cash adjustment", async () => {
  await addCustomer();
  const debt = await addDebt();
  await recalculateCustomerDebtBalance({ customerId: "customer-1", now: 2 });

  const result = await correctDebtBalance({
    debtId: debt.id,
    expectedUpdatedAt: debt.updatedAt,
    newBalancePesewas: 500,
    reasonCode: "wrong_amount",
    now: 40
  });

  assert.equal(result.adjustment.type, "debt_adjustment");
  assert.equal(result.adjustment.previousBalancePesewas, 1000);
  assert.equal(result.adjustment.newBalancePesewas, 500);
  assert.equal(result.adjustment.deltaPesewas, -500);
  assert.equal(result.adjustment.debtBefore.amountPesewas, 1000);
  assert.equal(result.adjustment.debtAfter.amountPesewas, 500);
  assert.equal(result.adjustment.amountPesewas, 0);
  assert.equal((await db.debts.get(debt.id)).amountPesewas, 500);
  assert.equal((await db.customers.get("customer-1")).totalDebtPesewas, 500);
});

test("supports a downward correction without recording cash or income", async () => {
  await addCustomer();
  const debt = await addDebt({ amountPesewas: 2500, total_owed: 2500 });
  await recalculateCustomerDebtBalance({ customerId: "customer-1", now: 2 });
  await db.transactions.bulkAdd([
    { id: "cash-sale", type: "sale", paymentType: "cash", amountPesewas: 5000 },
    { id: "paid-expense", type: "expense", amountPesewas: 1000, paidAmountPesewas: 1000 },
    { id: "debt-payment", type: "debt_payment", amountPesewas: 500, payment_method: "cash" }
  ]);
  const before = summarizeFinancialTransactions(await db.transactions.toArray());
  const beforePosMoney = summarizePosMoney(await db.transactions.toArray());

  const result = await correctDebtBalance({
    debtId: debt.id,
    expectedUpdatedAt: debt.updatedAt,
    newBalancePesewas: 1200,
    reasonCode: "returned_goods",
    now: 40
  });

  const after = summarizeFinancialTransactions(await db.transactions.toArray());
  const afterPosMoney = summarizePosMoney(await db.transactions.toArray());
  assert.equal(result.adjustment.deltaPesewas, -1300);
  assert.deepEqual(after, before);
  assert.deepEqual(afterPosMoney, beforePosMoney);
  assert.equal(after.cashInflow, 5500);
  assert.equal(after.expenses, 1000);
  assert.equal(after.realCashProfit, 4500);
  assert.equal(after.accruedProfit, 4500);
  assert.equal((await db.customers.get("customer-1")).totalDebtPesewas, 1200);
});

test("rejects a correction that increases the balance", async () => {
  await addCustomer();
  const debt = await addDebt();
  await recalculateCustomerDebtBalance({ customerId: "customer-1", now: 2 });

  await assert.rejects(
    correctDebtBalance({
      debtId: debt.id,
      expectedUpdatedAt: debt.updatedAt,
      newBalancePesewas: 1200,
      reasonCode: "wrong_amount",
      now: 40
    }),
    /cannot increase the balance/
  );

  assert.equal((await db.debts.get(debt.id)).amountPesewas, 1000);
  assert.equal((await db.transactions.toArray()).length, 0);
});

for (const reasonCode of DEBT_ADJUSTMENT_REASON_CODES) {
  test(`accepts the required correction reason: ${reasonCode}`, async () => {
    await addCustomer();
    const debt = await addDebt();
    const result = await correctDebtBalance({
      debtId: debt.id,
      expectedUpdatedAt: debt.updatedAt,
      newBalancePesewas: 500,
      reasonCode,
      reasonNote: reasonCode === "other" ? "Verified with the customer." : "",
      now: 40
    });

    assert.equal(result.adjustment.reasonCode, reasonCode);
    assert.equal(result.adjustment.newBalancePesewas, 500);
  });
}

for (const invalidBalance of [-1, 1000.5, Number.NaN, Number.POSITIVE_INFINITY]) {
  test(`rejects invalid corrected balance: ${String(invalidBalance)}`, async () => {
    await addCustomer();
    const debt = await addDebt();

    await assert.rejects(
      correctDebtBalance({
        debtId: debt.id,
        expectedUpdatedAt: debt.updatedAt,
        newBalancePesewas: invalidBalance,
        reasonCode: "wrong_amount",
        now: 40
      }),
      /corrected balance/
    );
    assert.equal(await db.transactions.count(), 0);
  });
}

test("allows a zero balance for a forgiven debt without recording cash", async () => {
  await addCustomer();
  const debt = await addDebt();
  await recalculateCustomerDebtBalance({ customerId: "customer-1", now: 2 });
  const before = summarizeFinancialTransactions(await db.transactions.toArray());

  const result = await correctDebtBalance({
    debtId: debt.id,
    expectedUpdatedAt: debt.updatedAt,
    newBalancePesewas: 0,
    reasonCode: "debt_forgiven",
    now: 40
  });

  const after = summarizeFinancialTransactions(await db.transactions.toArray());
  assert.equal(result.adjustment.deltaPesewas, -1000);
  assert.equal((await db.debts.get(debt.id)).amountPesewas, 0);
  assert.equal((await db.customers.get("customer-1")).totalDebtPesewas, 0);
  assert.deepEqual(after, before);
});

test("allows zero forgiveness after a consistent payment and prior correction history", async () => {
  await addCustomer();
  const debt = await addDebt({ amountPesewas: 1000, total_owed: 1000 });
  await db.transactions.add({
    id: "original-credit",
    type: "manual_debt",
    debtId: debt.id,
    customerId: "customer-1",
    creditExtendedPesewas: 1500,
    amountPesewas: 0,
    createdAt: 1
  });
  await db.payments.add({
    id: "payment-1",
    debtId: debt.id,
    customerId: "customer-1",
    amountPesewas: 500,
    paymentMethod: "cash",
    createdAt: 2
  });

  const firstCorrection = await correctDebtBalance({
    debtId: debt.id,
    expectedUpdatedAt: debt.updatedAt,
    newBalancePesewas: 500,
    reasonCode: "customer_dispute",
    now: 40
  });
  const secondCorrection = await correctDebtBalance({
    debtId: debt.id,
    expectedUpdatedAt: firstCorrection.debt.updatedAt,
    newBalancePesewas: 0,
    reasonCode: "debt_forgiven",
    now: 50
  });

  assert.equal(secondCorrection.adjustment.previousBalancePesewas, 500);
  assert.equal(secondCorrection.adjustment.newBalancePesewas, 0);
  assert.equal((await db.debts.get(debt.id)).amountPesewas, 0);
});

test("rejects zero forgiveness when recorded payments leave an unreconciled balance", async () => {
  await addCustomer();
  const debt = await addDebt({ amountPesewas: 1000, total_owed: 1000 });
  await db.transactions.add({
    id: "original-credit",
    type: "manual_debt",
    debtId: debt.id,
    customerId: "customer-1",
    creditExtendedPesewas: 1000,
    amountPesewas: 0,
    createdAt: 1
  });
  await db.payments.add({
    id: "overstated-payment",
    debtId: debt.id,
    customerId: "customer-1",
    amountPesewas: 100,
    paymentMethod: "cash",
    createdAt: 2
  });

  await assert.rejects(
    correctDebtBalance({
      debtId: debt.id,
      expectedUpdatedAt: debt.updatedAt,
      newBalancePesewas: 0,
      reasonCode: "debt_forgiven",
      now: 40
    }),
    /do not reconcile/
  );

  assert.equal((await db.debts.get(debt.id)).amountPesewas, 1000);
  assert.equal(await db.transactions.count(), 1);
  assert.equal(await db.payments.count(), 1);
});

test("closes an installment plan when a correction forgives the full balance", async () => {
  await addCustomer();
  const debt = await addDebt({
    amountPesewas: 10000,
    total_owed: 10000,
    isInstallmentPlan: true,
    installmentAmount: 2500,
    frequency: "weekly",
    nextDueDate: "2026-05-10",
    installmentsRemaining: 4,
    totalInstallments: 6,
    installmentPaymentCarryPesewas: 0
  });

  const result = await correctDebtBalance({
    debtId: debt.id,
    expectedUpdatedAt: debt.updatedAt,
    newBalancePesewas: 0,
    reasonCode: "debt_forgiven",
    now: 40
  });

  assert.equal(result.debt.isInstallmentPlan, false);
  assert.equal(result.debt.installmentsRemaining, 0);
  assert.equal(result.debt.totalInstallments, 0);
  assert.equal(result.debt.nextDueDate, "");
  assert.equal(result.debt.installmentPaymentCarryPesewas, 0);
});

test("closes an event-backed installment plan at zero after reconciliation", async () => {
  await addCustomer();
  const debt = await addDebt({
    amountPesewas: 10000,
    total_owed: 10000,
    isInstallmentPlan: true,
    installmentAmount: 2500,
    frequency: "weekly",
    nextDueDate: "2026-05-10",
    installmentsRemaining: 4,
    totalInstallments: 4,
    installmentPaymentCarryPesewas: 0
  });
  await db.transactions.add({
    id: "installment-credit",
    type: "manual_debt",
    debtId: debt.id,
    customerId: "customer-1",
    creditExtendedPesewas: 10000,
    amountPesewas: 0,
    createdAt: 1
  });

  const result = await correctDebtBalance({
    debtId: debt.id,
    expectedUpdatedAt: debt.updatedAt,
    newBalancePesewas: 0,
    reasonCode: "debt_forgiven",
    now: 40
  });

  assert.equal(result.debt.isInstallmentPlan, false);
  assert.equal(result.debt.installmentsRemaining, 0);
  assert.equal(result.debt.totalInstallments, 0);
  assert.equal(result.debt.nextDueDate, "");
  assert.equal(result.debt.installmentPaymentCarryPesewas, 0);
});

test("stores correction actor metadata and reconciles event-backed balances", async () => {
  await addCustomer();
  const debt = await addDebt();
  await db.transactions.add({
    id: "credit-event",
    type: "manual_debt",
    debtId: debt.id,
    customerId: "customer-1",
    creditExtendedPesewas: 1000,
    amountPesewas: 0,
    createdAt: 1
  });

  const result = await correctDebtBalance({
    debtId: debt.id,
    expectedUpdatedAt: debt.updatedAt,
    newBalancePesewas: 500,
    reasonCode: "wrong_amount",
    actorId: "user-1",
    now: 40
  });

  assert.equal(result.adjustment.actorId, "user-1");
  assert.equal(result.adjustment.deltaPesewas, -500);
});

test("reconciles a correction across customer events allocated to different debts", async () => {
  const customer = await addCustomer({ totalDebtPesewas: 9000 });
  const firstDebt = await addDebt({ id: "debt-1", amountPesewas: 6000, total_owed: 6000 });
  await addDebt({ id: "debt-2", amountPesewas: 3000, total_owed: 3000 });
  await db.transactions.bulkAdd([
    {
      id: "sale-1",
      type: "credit_sale",
      amountPesewas: 10000,
      creditSaleGrossPesewas: 10000,
      creditExtendedPesewas: 10000,
      debtId: firstDebt.id,
      customerId: customer.id
    },
    {
      id: "sale-2",
      type: "credit_sale",
      amountPesewas: 5000,
      creditSaleGrossPesewas: 5000,
      creditExtendedPesewas: 5000,
      debtId: "debt-2",
      customerId: customer.id
    }
  ]);
  await db.payments.bulkAdd([
    { id: "payment-1", debtId: "debt-2", customerId: customer.id, amountPesewas: 4000, transactionId: "sale-1" },
    { id: "payment-2", debtId: firstDebt.id, customerId: customer.id, amountPesewas: 2000, transactionId: "sale-2" }
  ]);

  const result = await correctDebtBalance({
    debtId: firstDebt.id,
    expectedUpdatedAt: firstDebt.updatedAt,
    newBalancePesewas: 5000,
    reasonCode: "returned_goods",
    now: 40
  });

  assert.equal(result.debt.amountPesewas, 5000);
  assert.equal(result.customer.totalDebtPesewas, 8000);
  assert.equal((await db.debts.get("debt-2")).amountPesewas, 3000);
});

test("correction failures at each database write boundary roll back all affected tables", async () => {
  const cases = [
    { table: db.transactions, method: "add" },
    { table: db.debts, method: "update" },
    { table: db.customers, method: "update" }
  ];

  for (const [index, failure] of cases.entries()) {
    await Promise.all(tables.map((table) => table.clear()));
    await addCustomer({ totalDebtPesewas: 1000 });
    const debt = await addDebt();
    await db.transactions.add({
      id: "credit-event",
      type: "manual_debt",
      debtId: debt.id,
      customerId: "customer-1",
      creditExtendedPesewas: 1000,
      amountPesewas: 0,
      createdAt: 1
    });
    const before = await Promise.all(tables.map((table) => table.toArray()));
    const original = failure.table[failure.method];
    failure.table[failure.method] = async () => {
      throw new Error("forced correction write failure");
    };

    try {
      await assert.rejects(correctDebtBalance({
        debtId: debt.id,
        expectedUpdatedAt: debt.updatedAt,
        newBalancePesewas: 500,
        reasonCode: "wrong_amount",
        now: 40 + index
      }), /forced correction write failure/);
    } finally {
      failure.table[failure.method] = original;
    }

    assert.deepEqual(await Promise.all(tables.map((table) => table.toArray())), before);
  }
});

test("rejects a correction when linked events do not reconcile", async () => {
  await addCustomer();
  const debt = await addDebt();
  await db.transactions.add({
    id: "inconsistent-credit-event",
    type: "manual_debt",
    debtId: debt.id,
    customerId: "customer-1",
    creditExtendedPesewas: 1200,
    amountPesewas: 0,
    createdAt: 1
  });

  await assert.rejects(
    correctDebtBalance({
      debtId: debt.id,
      expectedUpdatedAt: debt.updatedAt,
      newBalancePesewas: 500,
      reasonCode: "wrong_amount",
      now: 40
    }),
    /do not reconcile/
  );

  assert.equal((await db.debts.get(debt.id)).amountPesewas, 1000);
  assert.equal((await db.transactions.toArray()).length, 1);
});

test("corrects an installment balance while preserving completed payments and schedule", async () => {
  await addCustomer();
  const debt = await addDebt({
    amountPesewas: 10000,
    total_owed: 10000,
    isInstallmentPlan: true,
    installmentAmount: 2500,
    frequency: "weekly",
    nextDueDate: "2020-05-10",
    installmentsRemaining: 4,
    totalInstallments: 6,
    installmentPaymentCarryPesewas: 0
  });

  const result = await correctDebtBalance({
    debtId: debt.id,
    expectedUpdatedAt: debt.updatedAt,
    newBalancePesewas: 6000,
    reasonCode: "returned_goods",
    now: 40
  });

  assert.equal(result.debt.installmentsRemaining, 3);
  // Stored total = paid + left from money (owner rule, 11 Nov 2026): no payment rows, so 0 + 3.
  assert.equal(result.debt.totalInstallments, 3);
  assert.equal(result.debt.nextDueDate, "2020-05-10");
  assert.equal(result.debt.installmentPaymentCarryPesewas, 0);
});

test("preserves a valid partial-installment carry during a correction", async () => {
  await addCustomer();
  const debt = await addDebt({
    amountPesewas: 8000,
    total_owed: 8000,
    isInstallmentPlan: true,
    installmentAmount: 2500,
    frequency: "weekly",
    nextDueDate: "2026-05-10",
    installmentsRemaining: 4,
    totalInstallments: 5,
    installmentPaymentCarryPesewas: 500
  });

  const result = await correctDebtBalance({
    debtId: debt.id,
    expectedUpdatedAt: debt.updatedAt,
    newBalancePesewas: 3000,
    reasonCode: "customer_dispute",
    now: 40
  });

  assert.equal(result.debt.installmentsRemaining, 2);
  // Stored total = paid + left from money (owner rule, 11 Nov 2026): no payment rows, so 0 + 2.
  assert.equal(result.debt.totalInstallments, 2);
  assert.equal(result.debt.installmentPaymentCarryPesewas, 500);
});

test("rejects a non-zero correction below the recorded partial-installment carry", async () => {
  await addCustomer();
  const debt = await addDebt({
    amountPesewas: 8000,
    total_owed: 8000,
    isInstallmentPlan: true,
    installmentAmount: 2500,
    frequency: "weekly",
    nextDueDate: "2026-05-10",
    installmentsRemaining: 4,
    totalInstallments: 5,
    installmentPaymentCarryPesewas: 600
  });

  await assert.rejects(
    correctDebtBalance({
      debtId: debt.id,
      expectedUpdatedAt: debt.updatedAt,
      newBalancePesewas: 500,
      reasonCode: "wrong_amount",
      now: 40
    }),
    /invalid partial payment balance/
  );

  assert.equal((await db.debts.get(debt.id)).amountPesewas, 8000);
  assert.equal(await db.transactions.count(), 0);
});

test("rejects an installment correction with an invalid schedule", async () => {
  await addCustomer();
  const debt = await addDebt({
    isInstallmentPlan: true,
    installmentAmount: 0,
    frequency: "weekly",
    nextDueDate: "2026-05-10",
    installmentsRemaining: 4,
    totalInstallments: 4
  });

  await assert.rejects(
    correctDebtBalance({
      debtId: debt.id,
      expectedUpdatedAt: debt.updatedAt,
      newBalancePesewas: 500,
      reasonCode: "wrong_amount",
      now: 40
    }),
    /invalid schedule/
  );
  assert.equal((await db.debts.get(debt.id)).amountPesewas, 1000);
  assert.equal(await db.transactions.count(), 0);
});

test("rejects stale corrections and leaves all records unchanged", async () => {
  await addCustomer();
  const debt = await addDebt();
  await assert.rejects(
    correctDebtBalance({
      debtId: debt.id,
      expectedUpdatedAt: 9,
      newBalancePesewas: 1500,
      reasonCode: "other",
      reasonNote: "Correction",
      now: 40
    }),
    /changed before/
  );
  assert.equal((await db.debts.get(debt.id)).amountPesewas, 1000);
  assert.equal(await db.transactions.count(), 0);
});

test("rejects a correction that does not change the balance", async () => {
  await addCustomer();
  const debt = await addDebt();
  await assert.rejects(
    correctDebtBalance({
      debtId: debt.id,
      expectedUpdatedAt: debt.updatedAt,
      newBalancePesewas: 1000,
      reasonCode: "customer_dispute",
      now: 40
    }),
    /different from the current balance/
  );
  assert.equal((await db.debts.get(debt.id)).amountPesewas, 1000);
  assert.equal(await db.transactions.count(), 0);
});

test("rejects Other corrections without a note before opening a transaction", async () => {
  await addCustomer();
  const debt = await addDebt();
  await assert.rejects(
    correctDebtBalance({
      debtId: debt.id,
      expectedUpdatedAt: debt.updatedAt,
      newBalancePesewas: 1500,
      reasonCode: "other",
      now: 40
    }),
    /note/
  );
  assert.equal((await db.debts.get(debt.id)).amountPesewas, 1000);
  assert.equal(await db.transactions.count(), 0);
});
