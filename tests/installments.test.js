import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDueCycles,
  assertInstallmentAmountWithinBalance,
  createInstallmentPlan,
  createInstallmentReminderLink,
  getCreditBalanceAfterSale,
  getMaximumInstallmentAmountPesewas,
  getInstallmentAlertStatus,
  getNextCycleDate,
  PAYMENT_FREQUENCIES,
  isInstallmentDue,
  isValidDateString,
  prepareInstallmentPlan,
  reconcileInstallmentPayment
} from "../src/utils/installments.js";

const plan = {
  isInstallmentPlan: true,
  amountPesewas: 10000,
  installmentAmount: 2500,
  frequency: "weekly",
  nextDueDate: "2026-05-01",
  installmentsRemaining: 4,
  totalInstallments: 4
};

test("creates a plan using whole pesewas and rounds up the final installment", () => {
  assert.deepEqual(createInstallmentPlan({
    amountPesewas: 10001,
    installmentAmountPesewas: 3000,
    frequency: "monthly",
    nextDueDate: "2026-05-01"
  }), {
    isInstallmentPlan: true,
    installmentAmount: 3000,
    frequency: "monthly",
    nextDueDate: "2026-05-01",
    installmentsRemaining: 4,
    totalInstallments: 4
  });
});

test("installment amount cannot exceed the total debt", () => {
  assert.throws(() => createInstallmentPlan({
    amountPesewas: 2500,
    installmentAmountPesewas: 20000000000,
    frequency: "weekly",
    nextDueDate: "2026-05-01"
  }), /cannot exceed the debt amount/);
});

test("maximum credit balance includes existing debt plus the current sale", () => {
  assert.equal(getCreditBalanceAfterSale(13398, 2500), 15898);
  assert.throws(() => getCreditBalanceAfterSale(Number.MAX_SAFE_INTEGER, 1), /exceeds the supported amount/);
  assert.doesNotThrow(() => assertInstallmentAmountWithinBalance(15898, 15898));
  assert.throws(() => assertInstallmentAmountWithinBalance(20000000000, 15898), /total credit balance/);
});

test("maximum installment adapts to both the account balance and a payment starting today", () => {
  assert.equal(getMaximumInstallmentAmountPesewas(13398, 2500), 15898);
  assert.equal(getMaximumInstallmentAmountPesewas(13398, 2500, true), 15898);
  assert.equal(getMaximumInstallmentAmountPesewas(0, 10001, true), 10001);
  assert.equal(getMaximumInstallmentAmountPesewas(92000, 1000, true), 93000);
});

test("supports installment plans with at least 100 payments", () => {
  const hundredInstallments = createInstallmentPlan({
    amountPesewas: 10000,
    installmentAmountPesewas: 100,
    frequency: "weekly",
    nextDueDate: "2026-05-01"
  });

  assert.equal(hundredInstallments.totalInstallments, 100);
  assert.equal(hundredInstallments.installmentsRemaining, 100);
  assert.equal(reconcileInstallmentPayment(hundredInstallments, 100, 9900).installmentsRemaining, 99);
});

test("validates normalized date-only values", () => {
  assert.equal(isValidDateString("2024-02-29"), true);
  assert.equal(isValidDateString("2025-02-29"), false);
  assert.equal(isValidDateString("2026-5-01"), false);
});

test("exact payment advances one installment while underpayment keeps the due date", () => {
  assert.deepEqual(reconcileInstallmentPayment(plan, 2500, 7500), {
    isInstallmentPlan: true,
    installmentsRemaining: 3,
    nextDueDate: "2026-05-08",
    installmentPaymentCarryPesewas: 0
  });
  assert.deepEqual(reconcileInstallmentPayment(plan, 2499, 7501), {
    isInstallmentPlan: true,
    installmentsRemaining: 4,
    nextDueDate: "2026-05-01",
    installmentPaymentCarryPesewas: 2499
  });
});

test("two partial payments totaling an installment advance the due date", () => {
  const weeklyPlan = {
    ...plan,
    installmentAmount: 2000,
    installmentsRemaining: 5,
    totalInstallments: 5
  };
  const firstPayment = reconcileInstallmentPayment(weeklyPlan, 1000, 9000);
  assert.equal(firstPayment.nextDueDate, "2026-05-01");
  assert.equal(firstPayment.installmentPaymentCarryPesewas, 1000);

  assert.deepEqual(reconcileInstallmentPayment({
    ...weeklyPlan,
    ...firstPayment,
    amountPesewas: 9000
  }, 1000, 8000), {
    isInstallmentPlan: true,
    installmentsRemaining: 4,
    nextDueDate: "2026-05-08",
    installmentPaymentCarryPesewas: 0
  });
});

test("overpayment reconciles complete cycles and clears a completed plan", () => {
  assert.deepEqual(reconcileInstallmentPayment(plan, 5000, 5000), {
    isInstallmentPlan: true,
    installmentsRemaining: 2,
    nextDueDate: "2026-05-15",
    installmentPaymentCarryPesewas: 0
  });
  assert.deepEqual(reconcileInstallmentPayment(plan, 10000, 0), {
    isInstallmentPlan: false,
    installmentsRemaining: 0,
    nextDueDate: "",
    installmentPaymentCarryPesewas: 0
  });
});

test("date advancement uses fixed weekly, bi-weekly, and 30-day monthly cycles", () => {
  assert.equal(addDueCycles("2026-01-31", "monthly", 1), "2026-03-02");
  assert.equal(addDueCycles("2026-05-01", "bi-weekly", 2), "2026-05-29");
  assert.equal(addDueCycles("2026-05-01", "weekly", 2), "2026-05-15");
  assert.equal(addDueCycles("2026-05-01", "monthly", 2), "2026-06-30");
  assert.throws(() => addDueCycles("2026-05-01", "monthly", Number.MAX_SAFE_INTEGER), /supported range/);
});

test("next-cycle dates calculate from today for every frequency", () => {
  assert.deepEqual(PAYMENT_FREQUENCIES.map(({ value, label, daysPerCycle }) => [value, label, daysPerCycle]), [
    ["weekly", "Weekly", 7],
    ["bi-weekly", "Bi-weekly", 14],
    ["monthly", "Monthly", 30]
  ]);
  assert.equal(getNextCycleDate("2026-10-25", "weekly"), "2026-11-01");
  assert.equal(getNextCycleDate("2026-10-25", "bi-weekly"), "2026-11-08");
  assert.equal(getNextCycleDate("2026-10-25", "monthly"), "2026-11-24");
});

test("Start Today records one installment and stores the following cycle as next due", () => {
  assert.deepEqual(prepareInstallmentPlan({
    amountPesewas: 10000,
    installmentAmountPesewas: 2500,
    frequency: "weekly",
    nextDueDate: "2026-10-25",
    startToday: true
  }), {
    initialPaymentPesewas: 2500,
    plan: {
      isInstallmentPlan: true,
      installmentAmount: 2500,
      frequency: "weekly",
      nextDueDate: "2026-11-01",
      installmentsRemaining: 3,
      totalInstallments: 4
    }
  });
});

test("Start Today caps the installment and initial payment at the debt amount", () => {
  assert.deepEqual(prepareInstallmentPlan({
    amountPesewas: 1000,
    installmentAmountPesewas: 2500,
    frequency: "monthly",
    nextDueDate: "2026-10-25",
    startToday: true
  }), {
    initialPaymentPesewas: 1000,
    plan: {
      isInstallmentPlan: false,
      installmentAmount: 1000,
      frequency: "monthly",
      nextDueDate: "",
      installmentsRemaining: 0,
      totalInstallments: 1
    }
  });
});

test("Start Today collects the selected installment against combined debt and sale balance", () => {
  const prepared = prepareInstallmentPlan({
    amountPesewas: 93000,
    installmentAmountPesewas: 20000,
    frequency: "weekly",
    nextDueDate: "2026-10-25",
    startToday: true
  });

  assert.equal(prepared.initialPaymentPesewas, 20000);
  assert.equal(93000 - prepared.initialPaymentPesewas, 73000);
  assert.equal(prepared.plan.installmentsRemaining, 4);
  assert.equal(prepared.plan.installmentAmount, 20000);
});

test("Start Today can take a different payment amount from the recurring installment", () => {
  const prepared = prepareInstallmentPlan({
    amountPesewas: 10000,
    installmentAmountPesewas: 2500,
    frequency: "weekly",
    nextDueDate: "2026-10-25",
    startToday: true,
    initialPaymentLimitPesewas: 3000
  });

  assert.equal(prepared.initialPaymentPesewas, 3000);
  assert.equal(prepared.plan.installmentAmount, 2500);
  assert.equal(prepared.plan.installmentsRemaining, 3);
  assert.equal(prepared.plan.totalInstallments, 4);
});

test("Start Today caps future installments at the balance left after today's payment", () => {
  const prepared = prepareInstallmentPlan({
    amountPesewas: 15000,
    installmentAmountPesewas: 12000,
    frequency: "weekly",
    nextDueDate: "2026-10-25",
    startToday: true,
    initialPaymentLimitPesewas: 5000
  });

  assert.equal(prepared.initialPaymentPesewas, 5000);
  assert.equal(prepared.plan.installmentAmount, 10000);
  assert.equal(prepared.plan.installmentsRemaining, 1);
  assert.equal(prepared.plan.totalInstallments, 2);
});

test("Start Today can fully settle the balance without leaving an empty active plan", () => {
  const prepared = prepareInstallmentPlan({
    amountPesewas: 5000,
    installmentAmountPesewas: 5000,
    frequency: "weekly",
    nextDueDate: "2026-10-25",
    startToday: true,
    initialPaymentLimitPesewas: 5000
  });

  assert.equal(prepared.initialPaymentPesewas, 5000);
  assert.equal(prepared.plan.isInstallmentPlan, false);
  assert.equal(prepared.plan.installmentsRemaining, 0);
  assert.equal(prepared.plan.nextDueDate, "");
});

test("installment reconciliation rejects invalid amounts and inconsistent balances", () => {
  for (const [payment, remaining] of [
    [0, 10000],
    [-1, 10001],
    [1.5, 9998.5],
    [10001, 0],
    [Number.MAX_SAFE_INTEGER, 1]
  ]) {
    assert.throws(() => reconcileInstallmentPayment(plan, payment, remaining), /valid payment/);
  }
  assert.throws(() => reconcileInstallmentPayment({
    ...plan,
    installmentsRemaining: 0
  }, 100, 9900), /remaining payments/);
  assert.throws(() => reconcileInstallmentPayment({
    ...plan,
    installmentsRemaining: 1
  }, 1000, 9000), /fewer payments/);
});

test("Start Next Cycle does not record an initial payment", () => {
  assert.equal(prepareInstallmentPlan({
    amountPesewas: 10000,
    installmentAmountPesewas: 2500,
    frequency: "weekly",
    nextDueDate: "2026-11-01"
  }).initialPaymentPesewas, 0);
});

test("due alerts compare normalized date strings and reminders use the requested wording", () => {
  assert.equal(isInstallmentDue({ ...plan, nextDueDate: "2026-05-01" }, "2026-05-01"), true);
  assert.equal(isInstallmentDue({ ...plan, nextDueDate: "2026-05-02" }, "2026-05-01"), false);
  const link = createInstallmentReminderLink("024 123 4567", "Ama Mensah", 2500);
  assert.ok(link.startsWith("https://wa.me/233241234567?text="));
  assert.equal(decodeURIComponent(link.split("text=")[1]), "Hi Ama Mensah, gentle reminder that your installment of GHS 25.00 is due today. Thank you!");
  assert.equal(createInstallmentReminderLink("invalid", "Ama Mensah", 2500), null);
});

test("installment alert windows follow frequency and distinguish overdue, today, and upcoming", () => {
  assert.deepEqual(getInstallmentAlertStatus("2026-05-02", "weekly", "2026-05-01"), {
    showAlert: true,
    type: "due_soon",
    days: 1
  });
  assert.deepEqual(getInstallmentAlertStatus("2026-05-04", "bi-weekly", "2026-05-01"), {
    showAlert: true,
    type: "due_soon",
    days: 3
  });
  assert.deepEqual(getInstallmentAlertStatus("2026-05-06", "monthly", "2026-05-01"), {
    showAlert: true,
    type: "due_soon",
    days: 5
  });
  assert.deepEqual(getInstallmentAlertStatus("2026-05-03", "weekly", "2026-05-01"), {
    showAlert: false,
    type: "upcoming",
    days: 2
  });
  assert.deepEqual(getInstallmentAlertStatus("2026-05-01", "weekly", "2026-05-01"), {
    showAlert: true,
    type: "due_today",
    days: 0
  });
  assert.deepEqual(getInstallmentAlertStatus("2026-04-30", "weekly", "2026-05-01"), {
    showAlert: true,
    type: "overdue",
    days: 1
  });
});

test("proactive installment reminder copy uses the accurate due interval", () => {
  const alert = getInstallmentAlertStatus("2026-05-04", "bi-weekly", "2026-05-01");
  const link = createInstallmentReminderLink("024 123 4567", "Ama Mensah", 2500, alert);
  assert.equal(
    decodeURIComponent(link.split("text=")[1]),
    "Hi Ama Mensah, gentle reminder that your installment of GHS 25.00 is due in 3 days. Thank you!"
  );
});

test("payment reconciliation advances the matching number of bi-weekly and monthly cycles", () => {
  assert.deepEqual(reconcileInstallmentPayment({
    ...plan,
    frequency: "bi-weekly"
  }, 5000, 5000), {
    isInstallmentPlan: true,
    installmentsRemaining: 2,
    nextDueDate: "2026-05-29",
    installmentPaymentCarryPesewas: 0
  });
  assert.deepEqual(reconcileInstallmentPayment({
    ...plan,
    frequency: "monthly",
    nextDueDate: "2026-05-01"
  }, 2500, 7500), {
    isInstallmentPlan: true,
    installmentsRemaining: 3,
    nextDueDate: "2026-05-31",
    installmentPaymentCarryPesewas: 0
  });
});
