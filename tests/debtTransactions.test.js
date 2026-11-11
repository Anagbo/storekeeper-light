import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { addDebtToCustomer, recordCreditSale, recordDebtCollection, undoDebtCollection } from "../src/db/debts.js";
import { correctDebtBalance } from "../src/db/debtLedger.js";
import { db } from "../src/db/db.js";
import { summarizeFinancialTransactions } from "../src/utils/financials.js";
import { prepareInstallmentPlan } from "../src/utils/installments.js";

const tables = [db.debts, db.customers, db.transactions, db.payments];

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

async function addCustomer({ id = "customer-1", name = "Ama Mensah", totalDebtPesewas = 0 } = {}) {
  await db.customers.add({
    id,
    name,
    nameLower: name.trim().toLowerCase(),
    phone: "0241234567",
    ghanaCardNumber: "",
    totalDebtPesewas,
    createdAt: 1,
    updatedAt: 1
  });
  return id;
}

async function addDebt({
  id = "debt-1",
  customerId = "customer-1",
  name = "Ama Mensah",
  amountPesewas = 1000,
  installmentAmount = 0,
  installmentsRemaining = 0,
  isInstallmentPlan = false,
  nextDueDate = "2026-05-01",
  installmentPaymentCarryPesewas = 0
} = {}) {
  await db.debts.add({
    id,
    customerId,
    customerName: name,
    customer_name: name,
    phone: "0241234567",
    customer_phone: "0241234567",
    amountPesewas,
    total_owed: amountPesewas,
    status: "unpaid",
    isInstallmentPlan,
    installmentAmount,
    frequency: isInstallmentPlan ? "weekly" : "",
    nextDueDate: isInstallmentPlan ? nextDueDate : "",
    installmentsRemaining,
    totalInstallments: installmentsRemaining,
    installmentPaymentCarryPesewas,
    createdAt: 1,
    created_at: 1,
    updatedAt: 1,
    synced: false,
    syncStatus: "pending"
  });
}

function installmentPlan(balancePesewas, installmentAmount) {
  return {
    isInstallmentPlan: true,
    installmentAmount,
    frequency: "weekly",
    nextDueDate: "2026-05-01",
    installmentsRemaining: Math.ceil(balancePesewas / installmentAmount),
    totalInstallments: Math.ceil(balancePesewas / installmentAmount)
  };
}

test("credit sale stores only the unpaid portion and links the initial payment", async () => {
  const result = await recordCreditSale({
    amountPesewas: 1000,
    initialPaymentPesewas: 300,
    installmentPlan: installmentPlan(700, 350),
    name: "Ama Mensah",
    now: 100
  });

  const [debt] = await db.debts.toArray();
  const [payment] = await db.payments.toArray();
  const [transaction] = await db.transactions.toArray();
  const customer = await db.customers.get(result.customerId);

  assert.equal(debt.amountPesewas, 700);
  assert.equal(debt.installmentsRemaining, 2);
  assert.equal(payment.amountPesewas, 300);
  assert.equal(payment.debtId, debt.id);
  assert.equal(payment.transactionId, transaction.id);
  assert.equal(transaction.creditExtendedPesewas, 700);
  assert.equal(customer.totalDebtPesewas, 700);
  assert.equal(result.totalDebtPesewas, 700);
  assert.equal(result.debtAfter.nextDueDate, "2026-05-01");
  assert.equal(result.debtAfter.installmentsRemaining, 2);
});

test("split credit sale and later collection preserve one consistent ledger", async () => {
  const customerId = await addCustomer();

  const sale = await recordCreditSale({
    amountPesewas: 10000,
    initialPaymentPesewas: 7000,
    initialPaymentParts: [
      { paymentMethod: "cash", amountPesewas: 5000 },
      { paymentMethod: "momo", amountPesewas: 2000 }
    ],
    name: "Ama Mensah",
    now: 100
  });

  const collection = await recordDebtCollection({
    debtId: sale.debtId,
    parts: [{ paymentMethod: "cash", amountPesewas: 2500 }],
    now: 101
  });

  const debt = await db.debts.get(sale.debtId);
  const transactions = await db.transactions.toArray();
  const payments = await db.payments.toArray();
  const saleTransaction = transactions.find((transaction) => transaction.id === sale.transactionId);

  assert.equal(debt.amountPesewas, 500);
  assert.equal(collection.remainingPesewas, 500);
  assert.equal(saleTransaction.amountPesewas, 10000);
  assert.equal(saleTransaction.payment_method, "split");
  assert.equal(saleTransaction.creditSaleGrossPesewas, 10000);
  assert.equal(saleTransaction.creditExtendedPesewas, 3000);
  assert.equal(payments.reduce((total, payment) => total + payment.amountPesewas, 0), 9500);
  assert.equal(transactions
    .filter((transaction) => transaction.type === "income")
    .reduce((total, transaction) => total + transaction.amountPesewas, 0), 2500);

  await correctDebtBalance({
    debtId: sale.debtId,
    expectedUpdatedAt: 101,
    newBalancePesewas: 0,
    reasonCode: "customer_dispute",
    now: 102
  });
});

test("Start Today reduces a new GHS 100 installment debt by the GHS 20 paid today", async () => {
  const sale = await recordCreditSale({
    amountPesewas: 10000,
    initialPaymentPesewas: 2000,
    initialPaymentParts: [{ paymentMethod: "cash", amountPesewas: 2000 }],
    installmentPlan: {
      isInstallmentPlan: true,
      installmentAmount: 2000,
      frequency: "weekly",
      nextDueDate: "2026-11-12",
      installmentsRemaining: 4,
      totalInstallments: 5
    },
    name: "Ama Mensah",
    now: 110
  });

  const debt = await db.debts.get(sale.debtId);
  const customer = await db.customers.get(sale.customerId);
  const [payment] = await db.payments.toArray();

  assert.equal(debt.amountPesewas, 8000);
  assert.equal(debt.total_owed, 8000);
  assert.equal(debt.installmentsRemaining, 4);
  // Stored total = paid + left from money (owner rule, 11 Nov 2026): the GH₵20.00 pays the sale,
  // not the debt, so 0 + 4.
  assert.equal(debt.totalInstallments, 4);
  assert.equal(payment.amountPesewas, 2000);
  assert.equal(customer.totalDebtPesewas, 8000);
});

test("credit sale returns the final active installment schedule after several cycles are paid", async () => {
  const customerId = await addCustomer({ totalDebtPesewas: 22000 });
  await addDebt({
    customerId,
    amountPesewas: 22000,
    installmentAmount: 2000,
    installmentsRemaining: 11,
    isInstallmentPlan: true,
    nextDueDate: "2026-11-10"
  });

  const result = await recordCreditSale({
    amountPesewas: 8000,
    initialPaymentPesewas: 20000,
    initialPaymentParts: [
      { paymentMethod: "cash", amountPesewas: 9000 },
      { paymentMethod: "momo", amountPesewas: 11000 }
    ],
    installmentPlan: {
      isInstallmentPlan: true,
      installmentAmount: 2000,
      frequency: "weekly",
      nextDueDate: "2026-11-10",
      installmentsRemaining: 5,
      totalInstallments: 5
    },
    name: "Ama Mensah",
    now: 100
  });

  assert.equal(result.totalDebtPesewas, 10000);
  // The date chosen on 19 is the date saved (was moved 6 weeks, to 22/12, by the cycles paid today).
  assert.equal(result.debtAfter.nextDueDate, "2026-11-10");
  assert.equal(result.debtAfter.installmentAmount, 2000);
  assert.equal(result.debtAfter.installmentsRemaining, 5);
});

test("quick-sale credit entries preserve the item description and entered quantity", async () => {
  const result = await recordCreditSale({
    amountPesewas: 1250,
    name: "Ama Mensah",
    note: "Rice",
    itemDescription: "Rice",
    quantity: 2.5,
    transactionNote: "Rice · Ama Mensah · delivered",
    now: 100
  });

  const [transaction] = await db.transactions.toArray();
  assert.equal(transaction.customerId, result.customerId);
  assert.equal(transaction.itemDescription, "Rice");
  assert.equal(transaction.quantity, 2.5);
  assert.equal(transaction.note, "Rice · Ama Mensah · delivered");
  assert.deepEqual(JSON.parse(transaction.items_json), [{
    name: "Rice",
    quantity: 2.5,
    total_amount: 1250
  }]);
});

test("Debt Ledger credit entries use the shared sale transaction for existing debt and initial payment", async () => {
  const customerId = await addCustomer({ totalDebtPesewas: 1000 });
  await addDebt({
    customerId,
    amountPesewas: 1000,
    installmentAmount: 500,
    installmentsRemaining: 2,
    isInstallmentPlan: true
  });
  const plan = installmentPlan(1000, 500);
  await recordCreditSale({
    amountPesewas: 500,
    initialPaymentPesewas: 500,
    installmentPlan: plan,
    name: "Ama Mensah",
    note: "Debt added",
    itemDescription: "Debt added",
    transactionNote: "Debt added · Ama Mensah",
    now: 101
  });

  const debt = await db.debts.get("debt-1");
  const customer = await db.customers.get(customerId);
  const [payment] = await db.payments.toArray();
  const [transaction] = await db.transactions.toArray();
  assert.equal(debt.amountPesewas, 1000);
  assert.equal(debt.installmentAmount, 500);
  assert.equal(customer.totalDebtPesewas, 1000);
  assert.equal(payment.amountPesewas, 500);
  assert.equal(payment.debtId, debt.id);
  assert.equal(payment.transactionId, transaction.id);
  assert.equal(transaction.itemDescription, "Debt added");
  assert.equal(transaction.note, "Debt added · Ama Mensah");
});

test("concurrent credit sales serialize into one customer's balance without lost updates", async () => {
  const results = await Promise.all([
    recordCreditSale({ amountPesewas: 1000, name: "Ama Mensah", now: 101 }),
    recordCreditSale({ amountPesewas: 1500, name: " ama mensah ", now: 102 })
  ]);

  assert.equal(await db.customers.count(), 1);
  assert.equal(await db.debts.count(), 1);
  assert.equal((await db.debts.get(results[0].debtId)).amountPesewas, 2500);
  assert.equal((await db.customers.get(results[0].customerId)).totalDebtPesewas, 2500);
  assert.equal(await db.transactions.count(), 2);
});

test("credit add-ons use persisted debt, preserve the merged balance, and repair stale customer totals", async () => {
  const customerId = await addCustomer({ totalDebtPesewas: 9000 });
  await addDebt({ customerId, amountPesewas: 1000 });

  const result = await recordCreditSale({
    amountPesewas: 500,
    name: " ama mensah ",
    installmentPlan: installmentPlan(1500, 750),
    now: 200
  });

  const [debt] = await db.debts.toArray();
  const customer = await db.customers.get(customerId);
  assert.equal(result.previousDebtPesewas, 1000);
  assert.equal(result.addedDebtPesewas, 500);
  assert.equal(debt.amountPesewas, 1500);
  assert.equal(debt.installmentsRemaining, 2);
  assert.equal(customer.totalDebtPesewas, 1500);
});

test("direct add-on writes reject installments above the merged debt and repair customer totals", async () => {
  const customerId = await addCustomer({ totalDebtPesewas: 0 });
  await addDebt({ customerId, amountPesewas: 1000 });

  await assert.rejects(addDebtToCustomer({
    name: "Ama Mensah",
    customerId,
    amountPesewas: 400,
    installmentPlan: installmentPlan(1400, 1401),
    now: 250
  }), /does not fit/);
  assert.equal((await db.debts.get("debt-1")).amountPesewas, 1000);

  await addDebtToCustomer({
    name: "Ama Mensah",
    customerId,
    amountPesewas: 400,
    installmentPlan: installmentPlan(1400, 1000),
    now: 251
  });
  assert.equal((await db.debts.get("debt-1")).amountPesewas, 1400);
  assert.equal((await db.customers.get(customerId)).totalDebtPesewas, 1400);
});

test("installment cap includes the initial payment and rejects without partial writes", async () => {
  const customerId = await addCustomer({ totalDebtPesewas: 1000 });
  await addDebt({ customerId, amountPesewas: 1000 });

  await assert.rejects(recordCreditSale({
    amountPesewas: 500,
    initialPaymentPesewas: 200,
    name: "Ama Mensah",
    installmentPlan: installmentPlan(1300, 1301),
    now: 300
  }), /cannot exceed/);

  assert.equal((await db.debts.get("debt-1")).amountPesewas, 1000);
  assert.equal((await db.customers.get(customerId)).totalDebtPesewas, 1000);
  assert.equal(await db.transactions.count(), 0);
  assert.equal(await db.payments.count(), 0);
});

test("a sale paid in full today can still schedule the customer's existing balance", async () => {
  const customerId = await addCustomer({ totalDebtPesewas: 10000 });
  await addDebt({ customerId, amountPesewas: 10000 });

  const result = await recordCreditSale({
    amountPesewas: 5000,
    initialPaymentPesewas: 5000,
    installmentPlan: installmentPlan(10000, 10000),
    name: "Ama Mensah",
    now: 350
  });

  const debt = await db.debts.get("debt-1");
  const [payment] = await db.payments.toArray();
  const [transaction] = await db.transactions.toArray();
  const totals = summarizeFinancialTransactions([transaction]);
  assert.equal(result.addedDebtPesewas, 5000);
  assert.equal(result.debtId, "debt-1");
  assert.equal(debt.amountPesewas, 10000);
  assert.equal(debt.isInstallmentPlan, true);
  assert.equal(debt.installmentAmount, 10000);
  assert.equal(payment.debtId, "debt-1");
  assert.equal(transaction.debtId, undefined);
  assert.equal(transaction.creditExtendedPesewas, 0);
  assert.equal(totals.cashReceived, 5000);
  assert.equal(totals.newCreditExtended, 0);
});

test("Start Today applies the full installment to existing debt and the new sale", async () => {
  const customerId = await addCustomer({ totalDebtPesewas: 92000 });
  await addDebt({ customerId, amountPesewas: 92000 });
  const prepared = prepareInstallmentPlan({
    amountPesewas: 93000,
    installmentAmountPesewas: 20000,
    frequency: "weekly",
    nextDueDate: "2026-11-02",
    startToday: true
  });

  const result = await recordCreditSale({
    amountPesewas: 1000,
    initialPaymentPesewas: prepared.initialPaymentPesewas,
    installmentPlan: prepared.plan,
    name: "Ama Mensah",
    now: 350
  });

  const debt = await db.debts.get("debt-1");
  const payments = await db.payments.toArray();
  const transactions = await db.transactions.toArray();
  const totals = summarizeFinancialTransactions(transactions);
  assert.equal(result.initialPaymentPesewas, 20000);
  assert.equal(result.addedDebtPesewas, 1000);
  assert.equal(result.totalDebtPesewas, 73000);
  assert.equal(debt.amountPesewas, 73000);
  assert.equal(debt.installmentAmount, 20000);
  assert.equal(debt.installmentsRemaining, 4);
  // Money: GH₵190.00 paid on the old debt (0 whole installments) + 4 left. Today's payment counts once.
  assert.equal(debt.totalInstallments, 4);
  assert.equal(debt.nextDueDate, "2026-11-09");
  assert.equal(payments.reduce((sum, payment) => sum + payment.amountPesewas, 0), 20000);
  assert.equal(totals.totalSales, 1000);
  assert.equal(totals.cashReceived, 20000);
  assert.equal(totals.debtPaymentsCollected, 19000);
  assert.equal(totals.newCreditExtended, 0);
});

test("credit sale payment applied to an existing installment advances its schedule by paid cycles", async () => {
  const customerId = await addCustomer({ totalDebtPesewas: 4000 });
  await addDebt({
    customerId,
    amountPesewas: 4000,
    installmentAmount: 500,
    installmentsRemaining: 8,
    isInstallmentPlan: true,
    nextDueDate: "2026-11-09"
  });
  const prepared = prepareInstallmentPlan({
    amountPesewas: 6000,
    installmentAmountPesewas: 500,
    frequency: "weekly",
    nextDueDate: "2026-11-02",
    startToday: true,
    initialPaymentLimitPesewas: 3000
  });
  assert.equal(prepared.initialPaymentPesewas, 3000);

  await recordCreditSale({
    amountPesewas: 2000,
    initialPaymentPesewas: prepared.initialPaymentPesewas,
    initialPaymentParts: [
      { paymentMethod: "cash", amountPesewas: 1000 },
      { paymentMethod: "momo", amountPesewas: 2000 }
    ],
    installmentPlan: {
      ...prepared.plan,
      nextDueDate: "2026-11-09"
    },
    name: "Ama Mensah",
    now: 352
  });

  const debt = await db.debts.get("debt-1");
  const transactions = await db.transactions.toArray();
  const totals = summarizeFinancialTransactions(transactions);
  assert.equal(debt.amountPesewas, 3000);
  assert.equal(debt.installmentAmount, 500);
  assert.equal(debt.installmentsRemaining, 6);
  // Money: GH₵10.00 paid on the old debt (2 installments) + 6 left. Today's payment counts once.
  assert.equal(debt.totalInstallments, 8);
  // The date chosen on 19 is the date saved (was moved 2 weeks by the cycles paid today).
  assert.equal(debt.nextDueDate, "2026-11-09");
  assert.equal((await db.payments.toArray()).reduce((total, payment) => total + payment.amountPesewas, 0), 3000);
  assert.equal(totals.totalSales, 2000);
  assert.equal(totals.cashReceived, 1000);
  assert.equal(totals.momoReceived, 2000);
  assert.equal(totals.debtPaymentsCollected, 1000);
});

test("credit sale payment below an existing installment carries forward without advancing the due date", async () => {
  const customerId = await addCustomer({ totalDebtPesewas: 4000 });
  await addDebt({
    customerId,
    amountPesewas: 4000,
    installmentAmount: 500,
    installmentsRemaining: 8,
    isInstallmentPlan: true,
    nextDueDate: "2026-11-09"
  });
  const prepared = prepareInstallmentPlan({
    amountPesewas: 6000,
    installmentAmountPesewas: 500,
    frequency: "weekly",
    nextDueDate: "2026-11-02",
    startToday: true,
    initialPaymentLimitPesewas: 2250
  });

  await recordCreditSale({
    amountPesewas: 2000,
    initialPaymentPesewas: prepared.initialPaymentPesewas,
    installmentPlan: { ...prepared.plan, nextDueDate: "2026-11-09" },
    name: "Ama Mensah",
    now: 353
  });

  const debt = await db.debts.get("debt-1");
  assert.equal(debt.amountPesewas, 3750);
  assert.equal(debt.nextDueDate, "2026-11-09");
  assert.equal(debt.installmentPaymentCarryPesewas, 250);
});

test("credit sale reconfiguration applies payment progress to the new installment terms", async () => {
  const customerId = await addCustomer({ totalDebtPesewas: 4000 });
  await addDebt({
    customerId,
    amountPesewas: 4000,
    installmentAmount: 500,
    installmentsRemaining: 8,
    isInstallmentPlan: true,
    nextDueDate: "2026-11-09",
    installmentPaymentCarryPesewas: 300
  });
  const prepared = prepareInstallmentPlan({
    amountPesewas: 6000,
    installmentAmountPesewas: 800,
    frequency: "bi-weekly",
    nextDueDate: "2026-11-09",
    startToday: true,
    initialPaymentLimitPesewas: 3000
  });

  await recordCreditSale({
    amountPesewas: 2000,
    initialPaymentPesewas: prepared.initialPaymentPesewas,
    installmentPlan: { ...prepared.plan, nextDueDate: "2026-11-09" },
    name: "Ama Mensah",
    now: 354
  });

  const debt = await db.debts.get("debt-1");
  assert.equal(debt.amountPesewas, 3000);
  assert.equal(debt.installmentAmount, 800);
  assert.equal(debt.frequency, "bi-weekly");
  // The date chosen on 19 is the date saved (was moved one cycle by the installment completed today).
  assert.equal(debt.nextDueDate, "2026-11-09");
  assert.equal(debt.installmentsRemaining, 4);
  // Carry GH₵3.00 + GH₵10.00 today = 1 installment of GH₵8.00 + 4 left. Today's payment counts once.
  assert.equal(debt.totalInstallments, 5);
  assert.equal(debt.installmentPaymentCarryPesewas, 500);
});

test("Start Today records cash and MoMo portions separately across sale and existing debt", async () => {
  const customerId = await addCustomer({ totalDebtPesewas: 92000 });
  await addDebt({ customerId, amountPesewas: 92000 });
  const prepared = prepareInstallmentPlan({
    amountPesewas: 93000,
    installmentAmountPesewas: 20000,
    frequency: "weekly",
    nextDueDate: "2026-11-02",
    startToday: true
  });

  await recordCreditSale({
    amountPesewas: 1000,
    initialPaymentPesewas: prepared.initialPaymentPesewas,
    initialPaymentParts: [
      { paymentMethod: "cash", amountPesewas: 5000 },
      { paymentMethod: "momo", amountPesewas: 15000 }
    ],
    installmentPlan: prepared.plan,
    name: "Ama Mensah",
    now: 355
  });

  const debt = await db.debts.get("debt-1");
  const payments = await db.payments.toArray();
  const transactions = await db.transactions.toArray();
  const sale = transactions.find((transaction) => transaction.type === "installment_sale");
  const totals = summarizeFinancialTransactions(transactions);
  assert.equal(debt.amountPesewas, 73000);
  assert.equal(sale.cashReceivedPesewas, 1000);
  assert.equal(sale.momoReceivedPesewas, 0);
  assert.deepEqual(
    payments.map(({ paymentMethod, amountPesewas }) => [paymentMethod, amountPesewas]).sort(),
    [["cash", 1000], ["cash", 4000], ["momo", 15000]].sort()
  );
  assert.equal(totals.cashReceived, 5000);
  assert.equal(totals.momoReceived, 15000);
  assert.equal(totals.debtPaymentsCollected, 19000);
});

test("Start Today rejects payments above the existing debt plus the current sale", async () => {
  const customerId = await addCustomer({ totalDebtPesewas: 92000 });
  await addDebt({ customerId, amountPesewas: 92000 });

  await assert.rejects(recordCreditSale({
    amountPesewas: 1000,
    initialPaymentPesewas: 93001,
    name: "Ama Mensah",
    now: 360
  }), /total credit balance/);

  assert.equal((await db.debts.get("debt-1")).amountPesewas, 92000);
  assert.equal((await db.customers.get(customerId)).totalDebtPesewas, 92000);
  assert.equal(await db.transactions.count(), 0);
  assert.equal(await db.payments.count(), 0);
});

test("split initial-payment parts must reconcile exactly before any writes", async () => {
  await assert.rejects(recordCreditSale({
    amountPesewas: 20000,
    initialPaymentPesewas: 20000,
    initialPaymentParts: [
      { paymentMethod: "cash", amountPesewas: 5000 },
      { paymentMethod: "momo", amountPesewas: 14000 }
    ],
    name: "Ama Mensah",
    now: 365
  }), /add up to the initial payment amount/);

  assert.equal(await db.debts.count(), 0);
  assert.equal(await db.transactions.count(), 0);
  assert.equal(await db.payments.count(), 0);
});

test("a failed initial-payment write rolls back the entire credit sale", async () => {
  const originalAdd = db.payments.add;
  db.payments.add = async () => { throw new Error("forced payment write failure"); };
  try {
    await assert.rejects(recordCreditSale({
      amountPesewas: 500,
      initialPaymentPesewas: 100,
      name: "Ama Mensah",
      now: 400
    }), /forced payment write failure/);
  } finally {
    db.payments.add = originalAdd;
  }

  assert.equal(await db.debts.count(), 0);
  assert.equal(await db.customers.count(), 0);
  assert.equal(await db.transactions.count(), 0);
  assert.equal(await db.payments.count(), 0);
});

test("browser storage quota errors roll back credit entry and preserve the original error", async () => {
  const customerId = await addCustomer({ totalDebtPesewas: 1000 });
  await addDebt({ customerId, amountPesewas: 1000 });
  const before = await Promise.all(tables.map((table) => table.toArray()));
  const quotaError = new DOMException("Storage quota exceeded", "QuotaExceededError");
  const originalAdd = db.transactions.add;
  db.transactions.add = async () => { throw quotaError; };
  try {
    await assert.rejects(recordCreditSale({
      amountPesewas: 500,
      initialPaymentPesewas: 100,
      name: "Ama Mensah",
      now: 405
    }), (error) => error.name === "QuotaExceededError" &&
      error.message.includes("Storage quota exceeded"));
  } finally {
    db.transactions.add = originalAdd;
  }

  assert.deepEqual(await Promise.all(tables.map((table) => table.toArray())), before);
});

test("split collections reconcile partial installment payments and all unpaid customer debt", async () => {
  const customerId = await addCustomer({ totalDebtPesewas: 9999 });
  await addDebt({
    id: "debt-1",
    customerId,
    amountPesewas: 5000,
    installmentAmount: 2000,
    installmentsRemaining: 3,
    isInstallmentPlan: true
  });
  await addDebt({ id: "debt-2", customerId, amountPesewas: 3000 });

  const collection = await recordDebtCollection({
    debtId: "debt-1",
    parts: [
      { paymentMethod: "cash", amountPesewas: 600 },
      { paymentMethod: "momo", amountPesewas: 400 }
    ],
    now: 500
  });

  const debt = await db.debts.get("debt-1");
  const customer = await db.customers.get(customerId);
  assert.equal(collection.remainingPesewas, 4000);
  assert.equal(debt.amountPesewas, 4000);
  // Payments left from the balance: 4000 ÷ 2000 = 2 (DRIFT fix, Batch 14).
  assert.equal(debt.installmentsRemaining, 2);
  assert.equal(debt.installmentPaymentCarryPesewas, 1000);
  assert.equal(debt.nextDueDate, "2026-05-01");
  assert.equal(customer.totalDebtPesewas, 7000);
  assert.equal(await db.payments.count(), 2);
  assert.equal(await db.transactions.toCollection().filter((transaction) => (
    transaction.collectionId === collection.collectionId
  )).count(), 2);

  await recordDebtCollection({
    debtId: "debt-1",
    parts: [{ paymentMethod: "cash", amountPesewas: 1000 }],
    now: 600
  });
  const paidTowardCycle = await db.debts.get("debt-1");
  assert.equal(paidTowardCycle.installmentsRemaining, 2);
  assert.equal(paidTowardCycle.installmentPaymentCarryPesewas, 0);
  assert.equal(paidTowardCycle.nextDueDate, "2026-05-08");

  await recordDebtCollection({
    debtId: "debt-1",
    parts: [{ paymentMethod: "momo", amountPesewas: 3000 }],
    now: 700
  });
  const settledDebt = await db.debts.get("debt-1");
  assert.equal(settledDebt.status, "paid");
  assert.equal(settledDebt.isInstallmentPlan, false);
  assert.equal(settledDebt.installmentsRemaining, 0);
  assert.equal(settledDebt.nextDueDate, "");
  assert.equal((await db.customers.get(customerId)).totalDebtPesewas, 3000);
});

test("over-collection and repeat payment against a paid debt leave records unchanged", async () => {
  const customerId = await addCustomer({ totalDebtPesewas: 500 });
  await addDebt({ customerId, amountPesewas: 500 });

  await assert.rejects(recordDebtCollection({
    debtId: "debt-1",
    parts: [{ paymentMethod: "cash", amountPesewas: 501 }],
    now: 700
  }), /debt changed/);
  assert.equal((await db.debts.get("debt-1")).amountPesewas, 500);
  assert.equal(await db.payments.count(), 0);

  const collection = await recordDebtCollection({
    debtId: "debt-1",
    parts: [{ paymentMethod: "momo", amountPesewas: 500 }],
    now: 701
  });
  assert.equal(collection.remainingPesewas, 0);
  assert.equal((await db.debts.get("debt-1")).status, "paid");
  assert.equal((await db.customers.get(customerId)).totalDebtPesewas, 0);
  await assert.rejects(recordDebtCollection({
    debtId: "debt-1",
    parts: [{ paymentMethod: "cash", amountPesewas: 1 }],
    now: 702
  }), /debt changed/);
});

test("concurrent collections cannot overpay a debt or double-subtract its balance", async () => {
  const customerId = await addCustomer({ totalDebtPesewas: 1000 });
  await addDebt({ customerId, amountPesewas: 1000 });

  const results = await Promise.allSettled([
    recordDebtCollection({
      debtId: "debt-1",
      parts: [{ paymentMethod: "cash", amountPesewas: 600 }],
      now: 750
    }),
    recordDebtCollection({
      debtId: "debt-1",
      parts: [{ paymentMethod: "momo", amountPesewas: 600 }],
      now: 751
    })
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal((await db.debts.get("debt-1")).amountPesewas, 400);
  assert.equal((await db.customers.get(customerId)).totalDebtPesewas, 400);
  assert.equal(await db.payments.count(), 1);
  assert.equal(await db.transactions.count(), 1);
});

test("a concurrent credit sale and collection preserve debt, customer, payment, and transaction totals", async () => {
  for (const saleFirst of [true, false]) {
    await Promise.all(tables.map((table) => table.clear()));
    const customerId = await addCustomer({ totalDebtPesewas: 10000 });
    await addDebt({
      customerId,
      amountPesewas: 10000,
      installmentAmount: 5000,
      installmentsRemaining: 2,
      isInstallmentPlan: true
    });

    const sale = () => recordCreditSale({
      amountPesewas: 2000,
      initialPaymentPesewas: 6000,
      installmentPlan: installmentPlan(6000, 3000),
      name: "Ama Mensah",
      now: saleFirst ? 775 : 776
    });
    const collection = () => recordDebtCollection({
      debtId: "debt-1",
      parts: [{ paymentMethod: "momo", amountPesewas: 6000 }],
      now: saleFirst ? 776 : 775
    });
    const results = await Promise.allSettled(
      saleFirst ? [sale(), collection()] : [collection(), sale()]
    );

    const saleResult = results[saleFirst ? 0 : 1];
    const collectionResult = results[saleFirst ? 1 : 0];
    assert.equal(collectionResult.status, "fulfilled");
    assert.equal(saleResult.status, saleFirst ? "fulfilled" : "rejected");
    if (saleResult.status === "rejected") {
      assert.match(saleResult.reason.message, /installment|schedule|credit balance/i);
    }

    const [debt] = await db.debts.toArray();
    const customer = await db.customers.get(customerId);
    const payments = await db.payments.toArray();
    const transactions = await db.transactions.toArray();
    const paymentTotal = payments.reduce((sum, payment) => sum + payment.amountPesewas, 0);
    const saleAmount = saleResult.status === "fulfilled" ? 2000 : 0;
    const expectedBalance = 10000 + saleAmount - paymentTotal;
    const transactionById = new Map(transactions.map((transaction) => [transaction.id, transaction]));

    assert.equal(debt.amountPesewas, expectedBalance);
    assert.equal(customer.totalDebtPesewas, expectedBalance);
    assert.equal(payments.length, transactions.length);
    for (const payment of payments) {
      assert.ok(transactionById.has(payment.transactionId));
    }

    const incomeTransactions = transactions.filter((transaction) => transaction.type === "income");
    const incomeTotal = incomeTransactions.reduce((sum, transaction) => sum + transaction.amountPesewas, 0);
    const incomePaymentTotal = payments
      .filter((payment) => transactionById.get(payment.transactionId)?.type === "income")
      .reduce((sum, payment) => sum + payment.amountPesewas, 0);
    assert.equal(incomeTotal, incomePaymentTotal);
    assert.equal(paymentTotal, incomePaymentTotal + (saleResult.status === "fulfilled" ? 2000 : 0));
  }
});

test("credit sale failures at each database write boundary roll back all affected tables", async () => {
  const cases = [
    { table: db.customers, method: "add", failOnCall: 1, useExistingDebt: false },
    { table: db.debts, method: "add", failOnCall: 1, useExistingDebt: false },
    { table: db.payments, method: "add", failOnCall: 1, useExistingDebt: false },
    { table: db.transactions, method: "add", failOnCall: 1, useExistingDebt: false },
    { table: db.customers, method: "update", failOnCall: 2, useExistingDebt: false },
    { table: db.debts, method: "update", failOnCall: 2, useExistingDebt: true }
  ];

  for (const [index, failure] of cases.entries()) {
    await Promise.all(tables.map((table) => table.clear()));
    if (failure.useExistingDebt) {
      const customerId = await addCustomer({ totalDebtPesewas: 1000 });
      await addDebt({ customerId, amountPesewas: 1000 });
    }
    const before = await Promise.all(tables.map((table) => table.toArray()));
    const original = failure.table[failure.method];
    let calls = 0;
    failure.table[failure.method] = async function (...args) {
      calls += 1;
      if (calls === failure.failOnCall) throw new Error("forced write failure");
      return original.apply(this, args);
    };
    try {
      await assert.rejects(recordCreditSale({
        amountPesewas: 500,
        initialPaymentPesewas: 100,
        name: "Ama Mensah",
        now: 810 + index
      }), /forced write failure/);
    } finally {
      failure.table[failure.method] = original;
    }

    assert.equal(calls, failure.failOnCall);
    assert.deepEqual(await Promise.all(tables.map((table) => table.toArray())), before);
  }
});

test("collection failures at each database write boundary roll back all affected tables", async () => {
  const cases = [
    { table: db.debts, method: "update" },
    { table: db.payments, method: "add" },
    { table: db.transactions, method: "add" },
    { table: db.customers, method: "update" }
  ];

  for (const [index, failure] of cases.entries()) {
    await Promise.all(tables.map((table) => table.clear()));
    const customerId = await addCustomer({ totalDebtPesewas: 1000 });
    await addDebt({ customerId, amountPesewas: 1000 });
    const before = await Promise.all(tables.map((table) => table.toArray()));
    const original = failure.table[failure.method];
    failure.table[failure.method] = async () => { throw new Error("forced write failure"); };
    try {
      await assert.rejects(recordDebtCollection({
        debtId: "debt-1",
        parts: [{ paymentMethod: "cash", amountPesewas: 300 }],
        now: 820 + index
      }), /forced write failure/);
    } finally {
      failure.table[failure.method] = original;
    }

    assert.deepEqual(await Promise.all(tables.map((table) => table.toArray())), before);
  }
});

test("a failed collection transaction rolls back debt, payments, and customer totals", async () => {
  const customerId = await addCustomer({ totalDebtPesewas: 1000 });
  await addDebt({ customerId, amountPesewas: 1000 });
  const originalAdd = db.transactions.add;
  db.transactions.add = async () => { throw new Error("forced transaction write failure"); };
  try {
    await assert.rejects(recordDebtCollection({
      debtId: "debt-1",
      parts: [{ paymentMethod: "cash", amountPesewas: 300 }],
      now: 800
    }), /forced transaction write failure/);
  } finally {
    db.transactions.add = originalAdd;
  }

  assert.equal((await db.debts.get("debt-1")).amountPesewas, 1000);
  assert.equal((await db.customers.get(customerId)).totalDebtPesewas, 1000);
  assert.equal(await db.payments.count(), 0);
  assert.equal(await db.transactions.count(), 0);
});

test("collection undo restores debt and customer balance once, only inside its time window", async () => {
  const customerId = await addCustomer({ totalDebtPesewas: 1000 });
  await addDebt({ customerId, amountPesewas: 1000 });
  const collection = await recordDebtCollection({
    debtId: "debt-1",
    parts: [
      { paymentMethod: "cash", amountPesewas: 100 },
      { paymentMethod: "momo", amountPesewas: 150 }
    ],
    now: 900
  });

  await undoDebtCollection({ collectionId: collection.collectionId, now: 901 });
  assert.equal((await db.debts.get("debt-1")).amountPesewas, 1000);
  assert.equal((await db.customers.get(customerId)).totalDebtPesewas, 1000);
  assert.equal(await db.transactions.toCollection().filter((transaction) => (
    transaction.type === "income_reversal" &&
    transaction.reversalOfCollectionId === collection.collectionId
  )).count(), 2);
  assert.equal(summarizeFinancialTransactions(await db.transactions.toArray()).debtPaymentsCollected, 0);
  await assert.rejects(
    undoDebtCollection({ collectionId: collection.collectionId, now: 902 }),
    /already been undone/
  );
  await assert.rejects(
    undoDebtCollection({ collectionId: collection.collectionId, now: 11_001 }),
    /can no longer be undone/
  );
});

test("balance correction succeeds after multiple credit sales with initial payments and manual debt additions", async () => {
  const customerId = await addCustomer({ name: "TEST6" });

  // 1. Initial credit sale of 100 GHS with 20 GHS initial cash payment (debt balance = 80 GHS)
  const firstSale = await recordCreditSale({
    customerId,
    name: "TEST6",
    amountPesewas: 10000,
    initialPaymentPesewas: 2000,
    initialPaymentParts: [{ paymentMethod: "cash", amountPesewas: 2000 }],
    installmentPlan: {
      isInstallmentPlan: true,
      installmentAmount: 2000,
      frequency: "weekly",
      nextDueDate: "2026-05-01",
      installmentsRemaining: 4,
      totalInstallments: 5
    },
    now: 100
  });

  // 2. Second credit sale (addon) of 50 GHS with 10 GHS initial payment
  await recordCreditSale({
    customerId,
    name: "TEST6",
    amountPesewas: 5000,
    initialPaymentPesewas: 1000,
    initialPaymentParts: [{ paymentMethod: "cash", amountPesewas: 1000 }],
    installmentPlan: {
      isInstallmentPlan: true,
      installmentAmount: 2000,
      frequency: "weekly",
      nextDueDate: "2026-05-01",
      installmentsRemaining: 6,
      totalInstallments: 7
    },
    now: 110
  });

  // 3. Collection payment of 30 GHS
  await recordDebtCollection({
    debtId: firstSale.debtId,
    parts: [{ paymentMethod: "cash", amountPesewas: 3000 }],
    now: 120
  });

  const debt = await db.debts.get(firstSale.debtId);
  // Current debt: (100 - 20) + (50 - 10) - 30 = 90 GHS (9000 pesewas)
  assert.equal(debt.amountPesewas, 9000);

  // 4. Correct balance downward to 50 GHS
  await correctDebtBalance({
    debtId: firstSale.debtId,
    expectedUpdatedAt: debt.updatedAt,
    newBalancePesewas: 5000,
    reasonCode: "customer_dispute",
    now: 130
  });

  const updatedDebt = await db.debts.get(firstSale.debtId);
  assert.equal(updatedDebt.amountPesewas, 5000);
});
