import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareAddDebt } from "../src/utils/addDebt.js";

test("prepares a standard added debt with normalized customer fields", () => {
  const prepared = prepareAddDebt({
    customerName: " Ama Mensah ",
    amount: "12.50",
    phone: " 024 123 4567 ",
    ghanaCardNumber: "gha-123456789-0",
    note: "Rice"
  });

  assert.equal(prepared.name, "Ama Mensah");
  assert.equal(prepared.amountPesewas, 1250);
  assert.equal(prepared.phone, "024 123 4567");
  assert.equal(prepared.ghanaCardNumber, "GHA-123456789-0");
  assert.equal(prepared.note, "Rice");
  assert.equal(prepared.itemDescription, "Rice");
  assert.equal(prepared.installmentPlan, null);
});

test("prepares an installment debt with an initial payment", () => {
  const prepared = prepareAddDebt({
    customerName: "Ama Mensah",
    amount: 10000,
    ghanaCardNumber: "GHA-123456789-0",
    isInstallmentPlan: true,
    installmentAmount: "25.00",
    installmentFrequency: "weekly",
    installmentStartMode: "next-cycle",
    now: 100
  });

  assert.equal(prepared.installmentPlan.isInstallmentPlan, true);
  assert.equal(prepared.installmentPlan.installmentAmount, 2500);
  assert.equal(prepared.initialPaymentPesewas, 0);
  assert.equal(prepared.paymentMethod, "cash");
});

test("rejects invalid add-debt identity and amount before persistence", () => {
  assert.throws(
    () => prepareAddDebt({
      customerName: "",
      amount: "12.50",
      ghanaCardNumber: "GHA-123456789-0"
    }),
    /customer name/
  );
  assert.throws(
    () => prepareAddDebt({
      customerName: "Ama",
      amount: "0",
      ghanaCardNumber: "GHA-123456789-0"
    }),
    /debt amount/
  );
  assert.throws(
    () => prepareAddDebt({
      customerName: "Ama",
      amount: "12.50",
      ghanaCardNumber: "invalid"
    }),
    /Ghana Card/
  );
});
