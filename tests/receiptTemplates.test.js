import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCustomerBalanceReceipt,
  buildCreditSaleReceipt,
  buildPaymentReceiptFromCollection,
  buildSaleReceiptFromTransaction,
  getCollectionReceiptText,
  getSaleReceiptText,
  isReceiptTemplatesEnabled
} from "../src/pos/receiptTemplates.js";
import { FEATURE_FLAGS } from "../src/config/features.js";

const PRIVATE_DETAILS = /0241234567|233241234567|024 123 4567|GHA-123456789-0|Ghana Card/i;
const timestamp = Date.parse("2026-11-02T09:30:00");

const cashSale = {
  type: "sale",
  amountPesewas: 1300,
  payment_method: "cash",
  timestamp,
  cashReceivedPesewas: 1300,
  momoReceivedPesewas: 0,
  customer_phone: "0241234567",
  items_json: JSON.stringify([
    { name: "Bread", quantity: 2, total_amount: 1000 },
    { name: "Water", quantity: 1, total_amount: 300 }
  ])
};

const splitCreditSale = {
  type: "installment_sale",
  paymentType: "credit",
  amountPesewas: 8000,
  payment_method: null,
  timestamp,
  cashReceivedPesewas: 2000,
  momoReceivedPesewas: 3000,
  creditExtendedPesewas: 3000,
  customer_name: "Ama Owusu",
  customer_phone: "0241234567",
  phone: "0241234567",
  ghanaCardNumber: "GHA-123456789-0",
  items_json: JSON.stringify([{ name: "Sale", quantity: 1, total_amount: 8000 }])
};

const collection = {
  amountPesewas: 1250,
  remainingPesewas: 875,
  customerName: "Ama Owusu",
  phone: "0241234567",
  ghanaCardNumber: "GHA-123456789-0",
  createdAt: Date.parse("2026-11-03T14:05:00"),
  parts: [
    { paymentMethod: "cash", amountPesewas: 500 },
    { paymentMethod: "momo", amountPesewas: 750 }
  ],
  debtAfter: { isInstallmentPlan: true, installmentAmount: 300, nextDueDate: "2026-11-10" }
};

test("sample 1: cash-only sale has no Owed line and no contact details", () => {
  const receipt = buildSaleReceiptFromTransaction(cashSale, "Ama's Shop");
  assert.equal(receipt, [
    "Receipt from Ama's Shop",
    "02/11/2026, 09:30",
    "Bread × 2: GH₵10.00",
    "Water × 1: GH₵3.00",
    "Total: GH₵13.00",
    "Paid: Cash GH₵13.00",
    "Thank you!"
  ].join("\n"));
  assert.doesNotMatch(receipt, /Owed|MoMo/);
  assert.doesNotMatch(receipt, PRIVATE_DETAILS);
});

test("sample 2: split credit sale shows paid parts and what is owed, without item lines in numbers mode", () => {
  const receipt = buildSaleReceiptFromTransaction(splitCreditSale, "Ama's Shop", { dueDate: "2026-11-15" });
  assert.equal(receipt, [
    "Receipt from Ama's Shop",
    "02/11/2026, 09:30",
    "Total: GH₵80.00",
    "Paid: Cash GH₵20.00, MoMo GH₵30.00",
    "Owed: GH₵30.00, pay by 15/11/2026",
    "Thank you!"
  ].join("\n"));
  assert.doesNotMatch(receipt, PRIVATE_DETAILS);
  assert.doesNotMatch(receipt, /Ama Owusu/);
});

// Changed 15 Nov 2026 (wiring 28 and 29/43 "Collection receipt"): one text, no comma after the date,
// no Next payment line.
test("sample 3: a split collection names both parts and the balance owed now", () => {
  const receipt = buildPaymentReceiptFromCollection(collection, "Ama's Shop");
  assert.equal(receipt, [
    "Receipt from Ama's Shop",
    "03/11/2026 14:05",
    "Received from Ama Owusu: GH₵12.50 (Cash GH₵5.00, MoMo GH₵7.50)",
    "Balance owed now: GH₵8.75",
    "Thank you!"
  ].join("\n"));
  assert.doesNotMatch(receipt, PRIVATE_DETAILS);
});

test("current customer balance receipt includes its as-of time and plan", () => {
  const receipt = buildCustomerBalanceReceipt({
    shopName: "Ama's Shop",
    customerName: "Ama Owusu",
    timestamp: Date.parse("2026-11-06T12:56:00"),
    balancePesewas: 3000,
    installmentPesewas: 2000,
    nextDueDate: "2026-11-13"
  });
  assert.equal(receipt, [
    "Receipt from Ama's Shop",
    "06/11/2026, 12:56",
    "For: Ama Owusu",
    "Balance owed as of 06/11/2026, 12:56: GH₵30.00",
    "Next payment: GH₵20.00 on 13/11/2026",
    "Thank you!"
  ].join("\n"));
});

test("credit sale receipt uses the full initial payment split when an older balance exists", () => {
  const receipt = buildCreditSaleReceipt({
    amountPesewas: 2500,
    initialPaymentPesewas: 10000,
    initialPaymentParts: [
      { paymentMethod: "cash", amountPesewas: 4000 },
      { paymentMethod: "momo", amountPesewas: 6000 }
    ],
    totalDebtPesewas: 14500,
    debtAfter: {
      isInstallmentPlan: true,
      installmentAmount: 5000,
      nextDueDate: "2026-12-01"
    },
    installmentPlan: {
      isInstallmentPlan: true,
      installmentAmount: 5000,
      nextDueDate: "2026-11-10"
    },
    saleTransaction: { timestamp }
  }, "My shop");

  assert.equal(receipt, [
    "Receipt from My shop",
    "02/11/2026, 09:30",
    "This sale: GH₵25.00",
    "Paid today: GH₵100.00 (Cash GH₵40.00, MoMo GH₵60.00)",
    "Balance owed as of 02/11/2026, 09:30: GH₵145.00",
    "Next payment: GH₵50.00 on 01/12/2026",
    "Thank you!"
  ].join("\n"));
  assert.doesNotMatch(receipt, PRIVATE_DETAILS);
});

test("only applicable lines appear", () => {
  const credit = { ...splitCreditSale, cashReceivedPesewas: 0, momoReceivedPesewas: 0, creditExtendedPesewas: 8000 };
  assert.doesNotMatch(buildSaleReceiptFromTransaction(credit, "Shop"), /Paid:/);
  assert.doesNotMatch(buildSaleReceiptFromTransaction(splitCreditSale, "Shop"), /pay by/);

  const cashOnly = buildPaymentReceiptFromCollection({
    ...collection,
    parts: [{ paymentMethod: "cash", amountPesewas: 1250 }],
    debtAfter: { isInstallmentPlan: false }
  }, "Shop");
  assert.match(cashOnly, /Received from Ama Owusu: GH₵12\.50 \(Cash\)\n/);
  assert.doesNotMatch(cashOnly, /MoMo|Next payment/);
});

test("receipts reject totals that do not reconcile", () => {
  assert.throws(() => buildSaleReceiptFromTransaction({ ...splitCreditSale, creditExtendedPesewas: 2900 }, "Shop"), /do not match/);
  assert.throws(() => buildPaymentReceiptFromCollection({ ...collection, amountPesewas: 1300 }, "Shop"), /do not match/);
  assert.throws(() => buildSaleReceiptFromTransaction(cashSale, "  "), /shop name/);
});

test("one flag chooses between the new templates and the existing receipts", () => {
  assert.equal(FEATURE_FLAGS.SHOW_POS_RECEIPTS, false);
  assert.deepEqual(
    Object.keys(FEATURE_FLAGS).filter((key) => key.includes("RECEIPT")),
    ["SHOW_POS_RECEIPTS"]
  );
  assert.equal(isReceiptTemplatesEnabled(), false);
  assert.match(getSaleReceiptText(cashSale, "Ama's Shop"), /^Sale recorded by Ama's Shop\n/);
  assert.match(getSaleReceiptText(cashSale, "Ama's Shop", {}, true), /^Receipt from Ama's Shop\n/);
  assert.match(getCollectionReceiptText(collection, "Ama's Shop"), /^Payment received by Ama's Shop\n/);
  assert.match(getCollectionReceiptText(collection, "Ama's Shop", true), /^Receipt from Ama's Shop\n03\/11\/2026 14:05\n/);
});
