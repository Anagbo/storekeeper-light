import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { buildCollectionReceiptMessage } from "../src/pos/collectionReceipt.js";
import { receiptDueLines } from "../src/pos/receiptDueLine.js";
import {
  buildCreditSaleReceipt,
  buildCustomerBalanceReceipt,
  buildLatestPaymentReceipt,
  buildPaymentReceipt,
  getCollectionReceiptText
} from "../src/pos/receiptTemplates.js";
import { getPlanPeriodFigures } from "../src/utils/installments.js";

// Wiring 28/30/31 "Collection receipt: next payment and due date" (decided 21 Nov 2026, item 4j).
// With a plan the line is "Next payment: GH₵x on dd/mm/yyyy", x = the plan card's Still needed
// (getPlanPeriodFigures), never more than the balance. A one-time debt with a due date gets
// "Due on dd/mm/yyyy" after the balance while something is owed. No plan and no date: neither line.
// The collection receipt (28, 29/43, flag on and off), the credit-sale receipt (31) and the customer
// balance receipt all use the one line. 30's sale receipt keeps "Owed: …, pay by …".

const AT = new Date(2026, 10, 21, 10, 15).getTime(); // 21/11/2026 10:15 local
// Laura: GH₵50.00 owed, GH₵20.00 weekly, GH₵16.00 already paid toward this week's payment.
const LAURA = {
  isInstallmentPlan: true,
  installmentAmount: 2000,
  frequency: "weekly",
  nextDueDate: "2026-11-24",
  installmentPaymentCarryPesewas: 1600,
  amountPesewas: 5000,
  total_owed: 5000,
  status: "unpaid"
};
const ONE_TIME = { isInstallmentPlan: false, dueDate: "2026-12-05", amountPesewas: 5000, status: "unpaid" };
const NO_DATE = { isInstallmentPlan: false, dueDate: "", amountPesewas: 5000, status: "unpaid" };

const collection = (debtAfter, remainingPesewas = 5000) => ({
  customerName: "Laura", createdAt: AT, amountPesewas: 1000, remainingPesewas,
  parts: [{ paymentMethod: "cash", amountPesewas: 1000 }], debtAfter
});
const lineOf = (text) => text.split("\n").filter((line) => /^(Next payment|Due on)/.test(line));

test("the Laura example: GH₵16.00 paid of GH₵20.00 weekly gives Next payment GH₵4.00", () => {
  assert.equal(getPlanPeriodFigures(LAURA).stillNeededPesewas, 400, "the plan card's Still needed");
  const expected = [
    "Receipt from Shop",
    "21/11/2026 10:15",
    "Received from Laura: GH₵10.00 (Cash)",
    "Balance owed now: GH₵50.00",
    "Next payment: GH₵4.00 on 24/11/2026",
    "Thank you!"
  ].join("\n");
  assert.equal(getCollectionReceiptText(collection(LAURA), "Shop", true), expected, "28");
  const payment = { type: "payment", timestamp: AT, amountPesewas: 1000, method: "Cash" };
  assert.equal(buildLatestPaymentReceipt({ shopName: "Shop", customerName: "Laura", payment, balancePesewas: 5000, plan: LAURA }), expected, "29/43");
});

test("nothing paid in the period: the full installment", () => {
  const debt = { ...LAURA, installmentPaymentCarryPesewas: 0 };
  assert.deepEqual(receiptDueLines(debt, 5000), ["Next payment: GH₵20.00 on 24/11/2026"]);
  assert.deepEqual(receiptDueLines({ ...LAURA, installmentPaymentCarryPesewas: undefined }, 5000), ["Next payment: GH₵20.00 on 24/11/2026"]);
});

test("fully paid period: the date has moved on, the full installment on the new date", () => {
  // After a GH₵20.00 payment the stored plan has the next date and no carry.
  const debt = { ...LAURA, nextDueDate: "2026-12-01", installmentPaymentCarryPesewas: 0, amountPesewas: 3000 };
  assert.match(buildPaymentReceipt({ shopName: "Shop", customerName: "Laura", timestamp: AT, cashPesewas: 2000, remainingPesewas: 3000, plan: debt }),
    /\nBalance owed now: GH₵30\.00\nNext payment: GH₵20\.00 on 01\/12\/2026\nThank you!$/);
});

test("the balance cap stays: the next payment is never more than what is owed", () => {
  assert.deepEqual(receiptDueLines(LAURA, 300), ["Next payment: GH₵3.00 on 24/11/2026"]);
  assert.deepEqual(receiptDueLines({ ...LAURA, installmentPaymentCarryPesewas: 0 }, 1250), ["Next payment: GH₵12.50 on 24/11/2026"]);
});

test("one-time debt: Due on after the balance with a date; no line without one, nor when nothing is owed", () => {
  const base = { shopName: "Shop", customerName: "Laura", timestamp: AT, cashPesewas: 1000, remainingPesewas: 5000 };
  assert.match(buildPaymentReceipt({ ...base, plan: ONE_TIME }), /\nBalance owed now: GH₵50\.00\nDue on 05\/12\/2026\nThank you!$/);
  assert.deepEqual(lineOf(buildPaymentReceipt({ ...base, plan: NO_DATE })), []);
  assert.deepEqual(lineOf(buildPaymentReceipt({ ...base, remainingPesewas: 0, plan: ONE_TIME })), []);
  assert.deepEqual(lineOf(buildPaymentReceipt({ ...base, remainingPesewas: 0, plan: LAURA })), []);
});

test("no plan and no debt: neither line", () => {
  const base = { shopName: "Shop", customerName: "Laura", timestamp: AT, cashPesewas: 1000, remainingPesewas: 5000 };
  assert.deepEqual(lineOf(buildPaymentReceipt(base)), []);
  assert.deepEqual(receiptDueLines(null, 5000), []);
  assert.deepEqual(receiptDueLines({ ...LAURA, nextDueDate: "" }, 5000), [], "a date that cannot be read gives no line");
  assert.deepEqual(receiptDueLines({ ...ONE_TIME, dueDate: "2026-02-31" }, 5000), []);
});

test("flag on and flag off give the same Next payment / Due on line for the same debt", () => {
  for (const [name, debt, remaining] of [
    ["Laura", LAURA, 5000], ["nothing paid", { ...LAURA, installmentPaymentCarryPesewas: 0 }, 5000],
    ["balance cap", LAURA, 300], ["one-time with date", ONE_TIME, 5000], ["one-time no date", NO_DATE, 5000],
    ["paid off", { ...LAURA, status: "paid", dueDate: "" }, 0], ["no debt", null, 5000]
  ]) {
    const on = getCollectionReceiptText(collection(debt, remaining), "Shop", true);
    const off = getCollectionReceiptText(collection(debt, remaining), "Shop", false);
    assert.deepEqual(lineOf(off), lineOf(on), name);
    assert.equal(off, buildCollectionReceiptMessage(collection(debt, remaining), "Shop"));
  }
  assert.match(buildCollectionReceiptMessage(collection(LAURA), "Shop"), /\nStill owed: GH₵50\.00\nNext payment: GH₵4\.00 on 24\/11\/2026\nThank you!$/);
});

test("31 credit sale: Still needed on a plan, Due on for a one-time debt, nothing without a date", () => {
  const sale = { amountPesewas: 5000, initialPaymentPesewas: 0, initialPaymentParts: [], totalDebtPesewas: 5000, saleTransaction: { timestamp: AT } };
  assert.match(buildCreditSaleReceipt({ ...sale, debtAfter: LAURA, installmentPlan: LAURA, dueDate: LAURA.nextDueDate }, "Shop"),
    /\nBalance owed as of 21\/11\/2026, 10:15: GH₵50\.00\nNext payment: GH₵4\.00 on 24\/11\/2026\nThank you!$/);
  assert.match(buildCreditSaleReceipt({ ...sale, debtAfter: null, installmentPlan: null, dueDate: "2026-12-05" }, "Shop"),
    /\nBalance owed as of 21\/11\/2026, 10:15: GH₵50\.00\nDue on 05\/12\/2026\nThank you!$/);
  assert.deepEqual(lineOf(buildCreditSaleReceipt({ ...sale, debtAfter: null, installmentPlan: null, dueDate: "" }, "Shop")), []);
});

test("customer balance receipt: Still needed on a plan, Due on for a one-time debt", () => {
  const base = { shopName: "Shop", customerName: "Laura", timestamp: AT, balancePesewas: 5000 };
  assert.deepEqual(lineOf(buildCustomerBalanceReceipt({ ...base, installmentPesewas: 2000, nextDueDate: "2026-11-24", paidThisPeriodPesewas: 1600 })),
    ["Next payment: GH₵4.00 on 24/11/2026"]);
  assert.deepEqual(lineOf(buildCustomerBalanceReceipt({ ...base, installmentPesewas: 2000, nextDueDate: "2026-11-24" })),
    ["Next payment: GH₵20.00 on 24/11/2026"]);
  assert.deepEqual(lineOf(buildCustomerBalanceReceipt({ ...base, dueDate: "2026-12-05" })), ["Due on 05/12/2026"]);
  assert.deepEqual(lineOf(buildCustomerBalanceReceipt(base)), []);
});

test("item 5 scan: no ' · ' joins two facts in these receipt texts", () => {
  const sale = { amountPesewas: 5000, initialPaymentPesewas: 0, initialPaymentParts: [], totalDebtPesewas: 5000, saleTransaction: { timestamp: AT } };
  const texts = [
    ...[LAURA, ONE_TIME, NO_DATE, null].flatMap((debt) => [true, false].map((on) => getCollectionReceiptText(collection(debt), "Shop", on))),
    buildCreditSaleReceipt({ ...sale, debtAfter: LAURA, installmentPlan: LAURA }, "Shop"),
    buildCreditSaleReceipt({ ...sale, debtAfter: null, installmentPlan: null, dueDate: "2026-12-05" }, "Shop"),
    buildCustomerBalanceReceipt({ shopName: "Shop", customerName: "Laura", timestamp: AT, balancePesewas: 5000, installmentPesewas: 2000, nextDueDate: "2026-11-24", paidThisPeriodPesewas: 1600 })
  ];
  for (const text of texts) assert.doesNotMatch(text, / · /, text);
});

test("the line's money goes through formatGhs and its date through formatDate", () => {
  const source = readFileSync(new URL("../src/pos/receiptDueLine.js", import.meta.url), "utf8");
  assert.match(source, /formatGhs\(/);
  assert.match(source, /formatDate\(/);
  assert.doesNotMatch(source, /toFixed|toLocale|GH₵\$\{/);
});
