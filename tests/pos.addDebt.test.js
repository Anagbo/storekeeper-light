import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { saveAddedDebt } from "../src/utils/addDebt.js";
import { POS_LINKS, POS_ROUTES } from "../src/pos/routes.js";

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

// The old AddDebt screen was removed in Batch 13 (it was unreachable); 32's Add debt opens 17.
// saveAddedDebt below is the legacy add-debt helper (utils/addDebt.js), kept with its money tests.
test("Owed list Add debt opens 17 (the add-debt flow), and Done on the saved screen returns to 32", () => {
  const owedSource = readFileSync(new URL("../src/pos/OwedScreens.jsx", import.meta.url), "utf8");
  const appSource = readFileSync(new URL("../src/pos/PosApp.jsx", import.meta.url), "utf8");

  assert.ok(POS_LINKS.some((link) => (
    link.from === POS_ROUTES.PeopleWhoOweYou &&
    link.action === "addDebtJourney" &&
    link.to === POS_ROUTES.WhoOwesYou
  )));
  assert.match(owedSource, /onNavigate\("WhoOwesYou", \{ manualDebt: true \}\)/);
  assert.match(appSource, /switchTab\(POS_ROUTES\.PeopleWhoOweYou\)/);
});

test("saves a standard POS debt and creates the customer", async () => {
  await saveAddedDebt({
    customerName: "Ama Mensah",
    amount: "12.50",
    phone: "024 123 4567",
    ghanaCardNumber: "GHA-123456789-0",
    note: "Rice"
  });

  const customer = await db.customers.where("nameLower").equals("ama mensah").first();
  const debt = await db.debts.where("customerId").equals(customer.id).first();
  const transaction = await db.transactions.where("customerId").equals(customer.id).first();

  assert.equal(customer.phone, "024 123 4567");
  assert.equal(debt.amountPesewas, 1250);
  assert.equal(debt.note, "Rice");
  assert.equal(transaction.itemDescription, "Rice");
  assert.equal(customer.totalDebtPesewas, 1250);
});

test("saves an installment POS debt with the requested schedule", async () => {
  await saveAddedDebt({
    customerName: "Kofi Mensah",
    amount: "100.00",
    ghanaCardNumber: "GHA-123456789-0",
    isInstallmentPlan: true,
    installmentAmount: "25.00",
    installmentFrequency: "weekly",
    installmentStartMode: "next-cycle",
    nextDueDate: "2026-11-10"
  });

  const customer = await db.customers.where("nameLower").equals("kofi mensah").first();
  const debt = await db.debts.where("customerId").equals(customer.id).first();

  assert.equal(debt.isInstallmentPlan, true);
  assert.equal(debt.installmentAmount, 2500);
  assert.equal(debt.frequency, "weekly");
  assert.equal(debt.nextDueDate, "2026-11-10");
  assert.equal(debt.installmentsRemaining, 4);
});

test("rejects invalid POS add-debt input before writing records", async () => {
  await assert.rejects(
    saveAddedDebt({
      customerName: "",
      amount: "12.50",
      ghanaCardNumber: "GHA-123456789-0"
    }),
    /customer name/
  );
  await assert.rejects(
    saveAddedDebt({
      customerName: "Ama Mensah",
      amount: "0",
      ghanaCardNumber: "GHA-123456789-0"
    }),
    /debt amount/
  );
  await assert.rejects(
    saveAddedDebt({
      customerName: "Ama Mensah",
      amount: "12.50",
      ghanaCardNumber: "invalid"
    }),
    /Ghana Card/
  );

  assert.equal(await db.customers.count(), 0);
  assert.equal(await db.debts.count(), 0);
  assert.equal(await db.transactions.count(), 0);
});

test("reuses one customer when POS debt is added again with a normalized name", async () => {
  await saveAddedDebt({
    customerName: "Ama Mensah",
    amount: "12.50",
    ghanaCardNumber: "GHA-123456789-0"
  });
  await saveAddedDebt({
    customerName: " ama mensah ",
    amount: "7.50",
    ghanaCardNumber: "GHA-123456789-0"
  });

  assert.equal(await db.customers.count(), 1);
  assert.equal(await db.debts.count(), 1);
  const customer = await db.customers.where("nameLower").equals("ama mensah").first();
  assert.equal(customer.totalDebtPesewas, 2000);
});
