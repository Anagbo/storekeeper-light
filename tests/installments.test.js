import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDueCycles,
  assertInstallmentAmountWithinBalance,
  createInstallmentPlan,
  getCreditBalanceAfterSale,
  getMaximumInstallmentAmountPesewas,
  getInstallmentAlertStatus,
  getNextCycleDate,
  isValidInstallmentPlanForBalance,
  PAYMENT_FREQUENCIES,
  isInstallmentDue,
  isValidDateString,
  prepareInstallmentPlan,
  reconcileInstallmentPayment,
  reconcileInstallmentPlanChange
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

test("validates an inherited installment plan against the current balance", () => {
  const validPlan = {
    isInstallmentPlan: true,
    installmentAmount: 2000,
    frequency: "weekly",
    nextDueDate: "2026-11-09"
  };

  assert.equal(isValidInstallmentPlanForBalance(validPlan, 885), false);
  assert.equal(isValidInstallmentPlanForBalance(validPlan, 2000), true);
  assert.equal(isValidInstallmentPlanForBalance({ ...validPlan, installmentAmount: 20000000000 }, 885), false);
  assert.equal(isValidInstallmentPlanForBalance({ ...validPlan, frequency: "daily" }, 10000), false);
  assert.equal(isValidInstallmentPlanForBalance({ ...validPlan, nextDueDate: "2026-02-30" }, 10000), false);
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

test("a partial payment due today remains due until the full installment is paid", () => {
  const dueToday = {
    ...plan,
    amountPesewas: 10000,
    installmentAmount: 2000,
    installmentsRemaining: 5,
    totalInstallments: 5,
    nextDueDate: "2026-11-04"
  };
  const firstPayment = reconcileInstallmentPayment(dueToday, 500, 9500);
  assert.deepEqual(firstPayment, {
    isInstallmentPlan: true,
    installmentsRemaining: 5,
    nextDueDate: "2026-11-04",
    installmentPaymentCarryPesewas: 500
  });
  assert.deepEqual(reconcileInstallmentPayment({
    ...dueToday,
    ...firstPayment,
    amountPesewas: 9500
  }, 1500, 8000), {
    isInstallmentPlan: true,
    installmentsRemaining: 4,
    nextDueDate: "2026-11-11",
    installmentPaymentCarryPesewas: 0
  });
});

test("changing a plan preserves completed history and carries partial progress", () => {
  const changed = reconcileInstallmentPlanChange({
    ...plan,
    amountPesewas: 6000,
    installmentAmount: 2000,
    installmentsRemaining: 2,
    totalInstallments: 4,
    installmentPaymentCarryPesewas: 1500
  }, 8500, {
    isInstallmentPlan: true,
    installmentAmount: 1000,
    frequency: "monthly",
    nextDueDate: "2026-05-01"
  });

  assert.deepEqual(changed, {
    isInstallmentPlan: true,
    installmentAmount: 1000,
    frequency: "monthly",
    // The chosen date is saved; the carry no longer moves it a cycle.
    nextDueDate: "2026-05-01",
    installmentsRemaining: 9,
    totalInstallments: 12,
    installmentPaymentCarryPesewas: 500
  });
});

test("changing a plan can preserve the existing due date and accepts any frequency", () => {
  const changed = reconcileInstallmentPlanChange({
    ...plan,
    amountPesewas: 10000,
    installmentsRemaining: 4,
    totalInstallments: 4,
    installmentPaymentCarryPesewas: 0
  }, 12000, {
    isInstallmentPlan: true,
    installmentAmount: 3000,
    frequency: "bi-weekly",
    nextDueDate: "2026-05-01"
  });

  assert.equal(changed.frequency, "bi-weekly");
  assert.equal(changed.installmentsRemaining, 4);
  assert.equal(changed.totalInstallments, 4);
  assert.equal(changed.nextDueDate, "2026-05-01");
});

test("late completion advances only the completed cycles, not the elapsed calendar time", () => {
  const firstPayment = reconcileInstallmentPayment({
    ...plan,
    amountPesewas: 10000,
    installmentAmount: 2000,
    installmentsRemaining: 5,
    totalInstallments: 5,
    nextDueDate: "2026-11-04"
  }, 500, 9500);
  const lateCompletion = reconcileInstallmentPayment({
    ...plan,
    ...firstPayment,
    amountPesewas: 9500,
    installmentAmount: 2000,
    installmentsRemaining: 5,
    totalInstallments: 5,
    nextDueDate: "2026-11-04"
  }, 1500, 8000);

  assert.equal(lateCompletion.installmentsRemaining, 4);
  assert.equal(lateCompletion.nextDueDate, "2026-11-11");
  assert.equal(lateCompletion.installmentPaymentCarryPesewas, 0);
});

test("a payment covering several missed cycles advances by exactly those cycles", () => {
  const result = reconcileInstallmentPayment({
    ...plan,
    amountPesewas: 10000,
    installmentAmount: 2000,
    installmentsRemaining: 5,
    totalInstallments: 5,
    nextDueDate: "2026-11-04"
  }, 6000, 4000);

  assert.equal(result.installmentsRemaining, 2);
  assert.equal(result.nextDueDate, "2026-11-25");
  assert.equal(result.installmentPaymentCarryPesewas, 0);
});

test("all supported frequency transitions preserve the current due date", () => {
  for (const from of PAYMENT_FREQUENCIES.map(({ value }) => value)) {
    for (const to of PAYMENT_FREQUENCIES.map(({ value }) => value)) {
      const result = reconcileInstallmentPlanChange({
        ...plan,
        frequency: from,
        nextDueDate: "2026-11-04",
        amountPesewas: 10000,
        installmentAmount: 2000,
        installmentsRemaining: 4,
        totalInstallments: 6,
        installmentPaymentCarryPesewas: 500
      }, 12000, {
        isInstallmentPlan: true,
        installmentAmount: 3000,
        frequency: to,
        nextDueDate: "2026-11-04"
      });

      assert.equal(result.frequency, to);
      assert.equal(result.nextDueDate, "2026-11-04");
      assert.equal(result.installmentPaymentCarryPesewas, 500);
      assert.equal(result.totalInstallments, 6);
    }
  }
});

test("a smaller replacement amount converts carry into completed cycles and keeps the remainder", () => {
  const result = reconcileInstallmentPlanChange({
    ...plan,
    amountPesewas: 10000,
    installmentAmount: 2000,
    installmentsRemaining: 5,
    totalInstallments: 5,
    installmentPaymentCarryPesewas: 1900
  }, 8100, {
    isInstallmentPlan: true,
    installmentAmount: 1000,
    frequency: "weekly",
    nextDueDate: "2026-11-04"
  });

  assert.equal(result.installmentsRemaining, 9);
  assert.equal(result.totalInstallments, 10);
  // The chosen date is saved; the carry no longer moves it a cycle.
  assert.equal(result.nextDueDate, "2026-11-04");
  assert.equal(result.installmentPaymentCarryPesewas, 900);
});

test("replacement plans reject malformed dates, frequencies, carry, and unsafe payment totals", () => {
  const baseDebt = {
    ...plan,
    amountPesewas: 10000,
    installmentPaymentCarryPesewas: 500
  };
  const replacement = {
    isInstallmentPlan: true,
    installmentAmount: 2000,
    frequency: "weekly",
    nextDueDate: "2026-11-04"
  };

  assert.throws(() => reconcileInstallmentPlanChange(baseDebt, 10000, {
    ...replacement,
    nextDueDate: "2026-02-30"
  }), /replacement installment plan is invalid/);
  assert.throws(() => reconcileInstallmentPlanChange(baseDebt, 10000, {
    ...replacement,
    frequency: "daily"
  }), /replacement installment plan is invalid/);
  assert.throws(() => reconcileInstallmentPlanChange({
    ...baseDebt,
    installmentPaymentCarryPesewas: 2500
  }, 10000, replacement), /existing installment plan is invalid/);
  assert.throws(() => reconcileInstallmentPlanChange(
    baseDebt,
    10000,
    replacement,
    Number.MAX_SAFE_INTEGER
  ), /supported amount/);
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
    ["bi-weekly", "Every 2 weeks", 14],
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
});

// DRIFT fix (Batch 14): a stored counter that disagrees with the balance no longer blocks a
// collection; payments left is written from the balance.
test("installment reconciliation ignores a stored counter that disagrees with the balance", () => {
  for (const installmentsRemaining of [0, 1, 99]) {
    const result = reconcileInstallmentPayment({ ...plan, installmentsRemaining }, 1000, 9000);
    assert.equal(result.installmentsRemaining, 4);
    assert.equal(result.installmentPaymentCarryPesewas, 1000);
    assert.equal(result.nextDueDate, "2026-05-01");
  }
});

test("Start Next Cycle does not record an initial payment", () => {
  assert.equal(prepareInstallmentPlan({
    amountPesewas: 10000,
    installmentAmountPesewas: 2500,
    frequency: "weekly",
    nextDueDate: "2026-11-01"
  }).initialPaymentPesewas, 0);
});

test("due alerts compare normalized date strings", () => {
  assert.equal(isInstallmentDue({ ...plan, nextDueDate: "2026-05-01" }, "2026-05-01"), true);
  assert.equal(isInstallmentDue({ ...plan, nextDueDate: "2026-05-02" }, "2026-05-01"), false);
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
