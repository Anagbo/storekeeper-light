import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCashSale } from "../src/db/sales.js";
import { recordCreditSale, recordDebtCollection } from "../src/db/debts.js";
import { recordManualDebt } from "../src/db/debtLedger.js";
import * as momoMapping from "../src/pos/momoMapping.js";
import { buildSaleReceiptMessage } from "../src/pos/saleReceipt.js";
import { buildCollectionReceiptMessage } from "../src/pos/collectionReceipt.js";
import { buildCreditSaleReceipt, getCollectionReceiptText, getSaleReceiptText } from "../src/pos/receiptTemplates.js";

after(async () => {
  db.close();
  await db.delete();
});

const momoSource = readFileSync(new URL("../src/pos/MoMoScreens.jsx", import.meta.url), "utf8");
const saleRecordedSource = readFileSync(new URL("../src/pos/SaleRecorded.jsx", import.meta.url), "utf8");
const collectionSource = readFileSync(new URL("../src/pos/DebtCollection.jsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../src/pos/PosApp.jsx", import.meta.url), "utf8");

test("F1: a direct MoMo sale is stored as merchant_confirmed", async () => {
  const sale = await recordCashSale({
    amountPesewas: 2000,
    cashReceivedPesewas: 0,
    momoReceivedPesewas: 2000,
    parts: [{ paymentMethod: "momo", amountPesewas: 2000, momoMethod: "direct", verification: "merchant_confirmed" }]
  });
  assert.equal((await db.transactions.get(sale.id)).momoVerification, "merchant_confirmed");
});

test("F1: a MoMo part is never stored as verified without a Paystack reference", async () => {
  const sale = await recordCashSale({
    amountPesewas: 2000,
    cashReceivedPesewas: 500,
    momoReceivedPesewas: 1500,
    parts: [
      { paymentMethod: "cash", amountPesewas: 500 },
      { paymentMethod: "momo", amountPesewas: 1500, verification: "verified" }
    ]
  });
  assert.equal((await db.transactions.get(sale.id)).momoVerification, "merchant_confirmed");
});

test("F1: a MoMo sale saved with no parts at all (screen 15) is merchant_confirmed", async () => {
  const sale = await recordCashSale({ amountPesewas: 900, cashReceivedPesewas: 0, momoReceivedPesewas: 900 });
  assert.equal((await db.transactions.get(sale.id)).momoVerification, "merchant_confirmed");
});

test("F1: a cash-only sale has no MoMo verification field", async () => {
  const sale = await recordCashSale({ amountPesewas: 700 });
  assert.equal("momoVerification" in (await db.transactions.get(sale.id)), false);
});

test("F1: a credit sale with a MoMo payment today stores merchant_confirmed on the sale and the MoMo payment row", async () => {
  const result = await recordCreditSale({
    amountPesewas: 3000,
    name: "Ama Verify",
    initialPaymentPesewas: 1000,
    initialPaymentParts: [{ paymentMethod: "momo", amountPesewas: 1000, verification: "merchant_confirmed" }],
    paymentMethod: "momo"
  });
  assert.equal((await db.transactions.get(result.transactionId)).momoVerification, "merchant_confirmed");
  const rows = await db.payments.filter((row) => row.transactionId === result.transactionId).toArray();
  for (const row of rows) {
    assert.equal(row.momoVerification, row.paymentMethod === "momo" ? "merchant_confirmed" : undefined);
  }
});

test("F1: a collection stores merchant_confirmed on MoMo rows only, and returns it for screen 28", async () => {
  const credit = await recordCreditSale({ amountPesewas: 5000, name: "Kofi Verify" });
  const result = await recordDebtCollection({
    debtId: credit.debtId,
    parts: [
      { paymentMethod: "cash", amountPesewas: 1000 },
      { paymentMethod: "momo", amountPesewas: 2000, verification: "merchant_confirmed" }
    ]
  });
  assert.equal(result.momoVerification, "merchant_confirmed");
  const rows = await db.payments.filter((row) => row.collectionId === result.collectionId).toArray();
  const transactions = await db.transactions.filter((row) => row.collectionId === result.collectionId).toArray();
  for (const row of [...rows, ...transactions]) {
    const method = row.paymentMethod ?? row.payment_method;
    assert.equal(row.momoVerification, method === "momo" ? "merchant_confirmed" : undefined, `${method} row`);
  }
});

test("C2: the MoMo label reads MoMo · you confirmed, and plain MoMo for older records with no field", () => {
  assert.equal(typeof momoMapping.getMomoDisplayLabel, "function");
  assert.equal(momoMapping.getMomoDisplayLabel({ momoVerification: "merchant_confirmed" }), "MoMo · you confirmed");
  assert.equal(momoMapping.getMomoDisplayLabel({ momoVerification: "verified" }), "MoMo · verified");
  assert.equal(momoMapping.getMomoDisplayLabel({}), "MoMo");
  assert.equal(momoMapping.getMomoDisplayLabel({ momoVerification: "nonsense" }), "MoMo");
});

// Owner decision: customer receipts always say plain "MoMo", in both receipt systems,
// whatever the stored verification. "MoMo · you confirmed" is for merchant screens only.
const RECEIPT_VERIFICATIONS = ["merchant_confirmed", "verified", undefined];
function assertPlainMomo(text) {
  assert.doesNotMatch(text, /you confirmed|verified/i);
}

test("C2 (owner): default receipts (VITE_ENABLE_POS_RECEIPTS off) say plain MoMo", () => {
  for (const momoVerification of RECEIPT_VERIFICATIONS) {
    const sale = { amountPesewas: 2000, total_amount: 2000, payment_method: "momo", cashReceivedPesewas: 0, momoReceivedPesewas: 2000, momoVerification, items_json: "[]", timestamp: Date.now() };
    const single = buildSaleReceiptMessage(sale, "Shop");
    assert.match(single, /Payment: MoMo\n/);
    assertPlainMomo(single);
    const split = buildSaleReceiptMessage({ ...sale, payment_method: "split", cashReceivedPesewas: 500, momoReceivedPesewas: 1500 }, "Shop");
    assert.match(split, /· MoMo GH₵15\.00/);
    assertPlainMomo(split);
    const collection = buildCollectionReceiptMessage({
      customerName: "Kofi", createdAt: Date.now(), amountPesewas: 3000, remainingPesewas: 2000, momoVerification,
      parts: [{ paymentMethod: "cash", amountPesewas: 1000 }, { paymentMethod: "momo", amountPesewas: 2000 }]
    }, "Shop");
    assert.match(collection, /, MoMo GH₵20\.00\)/);
    assertPlainMomo(collection);
  }
});

test("C2 (owner): receipt templates (VITE_ENABLE_POS_RECEIPTS on) say plain MoMo", () => {
  for (const momoVerification of RECEIPT_VERIFICATIONS) {
    const sale = { amountPesewas: 2000, total_amount: 2000, payment_method: "split", paymentType: "split", cashReceivedPesewas: 500, momoReceivedPesewas: 1500, momoVerification, items_json: "[]", timestamp: Date.now() };
    const saleText = getSaleReceiptText(sale, "Shop", {}, true);
    assert.match(saleText, /Paid: Cash GH₵5\.00, MoMo GH₵15\.00/);
    assertPlainMomo(saleText);
    const collectionText = getCollectionReceiptText({
      customerName: "Kofi", createdAt: Date.now(), amountPesewas: 3000, remainingPesewas: 2000, momoVerification,
      parts: [{ paymentMethod: "cash", amountPesewas: 1000 }, { paymentMethod: "momo", amountPesewas: 2000 }]
    }, "Shop", true);
    assert.match(collectionText, /\(Cash GH₵10\.00, MoMo GH₵20\.00\)/);
    assertPlainMomo(collectionText);
    const creditText = buildCreditSaleReceipt({
      amountPesewas: 3000, initialPaymentPesewas: 1000, totalDebtPesewas: 2000, debtAfter: null,
      initialPaymentParts: [{ paymentMethod: "momo", amountPesewas: 1000 }],
      saleTransaction: { timestamp: Date.now(), momoVerification }
    }, "Shop");
    assert.match(creditText, /Paid today: GH₵10\.00 \(MoMo GH₵10\.00\)/);
    assertPlainMomo(creditText);
  }
});

test("C2 (owner): receipt builders do not read the merchant-only MoMo label", () => {
  for (const file of ["saleReceipt.js", "collectionReceipt.js", "receiptTemplates.js"]) {
    const source = readFileSync(new URL(`../src/pos/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /getMomoDisplayLabel|you confirmed/, file);
  }
});

test("F1 (4b): Add debt with MoMo paid now stores merchant_confirmed on MoMo rows only", async () => {
  const result = await recordManualDebt({
    name: "Yaw Manual",
    ghanaCardNumber: "GHA-123456789-0",
    amountPesewas: 6000,
    initialPaymentPesewas: 3000,
    initialPaymentParts: [
      { paymentMethod: "cash", amountPesewas: 1000 },
      { paymentMethod: "momo", amountPesewas: 2000, verification: "merchant_confirmed" }
    ],
    paymentMethod: "cash"
  });
  const debtId = result.debt.id;
  const payments = await db.payments.filter((row) => row.debtId === debtId).toArray();
  const income = await db.transactions.filter((row) => row.debtId === debtId && row.type === "income").toArray();
  assert.equal(payments.length, 2);
  assert.equal(income.length, 2);
  for (const row of [...payments, ...income]) {
    const method = row.paymentMethod ?? row.payment_method;
    assert.equal(row.momoVerification, method === "momo" ? "merchant_confirmed" : undefined, `${method} row`);
  }
});

test("F1 (4b): Add debt never stores verified without a Paystack reference", async () => {
  const result = await recordManualDebt({
    name: "Efua Manual",
    ghanaCardNumber: "GHA-123456789-0",
    amountPesewas: 4000,
    initialPaymentPesewas: 1000,
    initialPaymentParts: [{ paymentMethod: "momo", amountPesewas: 1000, verification: "verified" }],
    paymentMethod: "momo"
  });
  const income = await db.transactions.filter((row) => row.debtId === result.debt.id && row.type === "income").toArray();
  assert.equal(income[0].momoVerification, "merchant_confirmed");
});

test("K13: screens 30 and 28 label the MoMo row with getMomoDisplayLabel", () => {
  assert.match(saleRecordedSource, /getMomoDisplayLabel\(transaction\)/);
  assert.match(collectionSource, /getMomoDisplayLabel\(result\)/);
});

test("PosApp passes the MoMo part, with its verification, when saving a direct MoMo sale or collection", () => {
  const sale = appSource.slice(appSource.indexOf("async function saveDirectMomoSale"), appSource.indexOf("async function saveDirectMomoCollection"));
  assert.match(sale, /parts: \[\{ paymentMethod: "momo", amountPesewas: details\.amountPesewas, verification: details\.verification \}\]/);
  const collection = appSource.slice(appSource.indexOf("async function saveDirectMomoCollection"), appSource.indexOf("async function saveExpense"));
  assert.match(collection, /verification: details\.verification/);
});

test("K8 and owner wording: 56 says MoMo · you confirmed; 62 asks to check the balance, not only the SMS", () => {
  const payment = momoSource.slice(momoSource.indexOf("export function MoMoPayment"), momoSource.indexOf("export function MoMoWaiting"));
  assert.doesNotMatch(payment, /Not verified/);
  assert.match(payment, /Saved as MoMo · you confirmed\./);
  const direct = momoSource.slice(momoSource.indexOf("export function MoMoDirect"), momoSource.indexOf("export function PaymentSettings"));
  assert.match(direct, /Check your MoMo balance, not only the SMS\./);
});
// momoMethod is stored next to momoVerification: "direct" now, "paystack" reserved for verified parts.
function assertMomoFields(rows, label) {
  assert.ok(rows.length > 0, `${label}: no rows`);
  for (const row of rows) {
    const method = row.paymentMethod ?? row.payment_method;
    const hasMomo = method === "momo" || method === "split" || (row.momoReceivedPesewas ?? 0) > 0;
    if (hasMomo) {
      assert.equal(row.momoMethod, row.momoVerification === "verified" ? "paystack" : "direct", `${label} ${method}`);
    } else {
      assert.equal("momoMethod" in row, false, `${label} ${method} must have no momoMethod`);
    }
  }
}

test("momoMethod: getMomoDetails gives direct for merchant_confirmed and paystack only for verified", () => {
  assert.equal(typeof momoMapping.getMomoDetails, "function");
  assert.deepEqual(momoMapping.getMomoDetails("merchant_confirmed"), { momoMethod: "direct", momoVerification: "merchant_confirmed" });
  assert.deepEqual(momoMapping.getMomoDetails("verified"), { momoMethod: "paystack", momoVerification: "verified" });
});

test("momoMethod: sales store direct; a verified part with a reference stores paystack (reserved)", async () => {
  const direct = await recordCashSale({ amountPesewas: 800, cashReceivedPesewas: 0, momoReceivedPesewas: 800 });
  const cash = await recordCashSale({ amountPesewas: 800 });
  const reserved = await recordCashSale({
    amountPesewas: 800, cashReceivedPesewas: 0, momoReceivedPesewas: 800,
    parts: [{ paymentMethod: "momo", amountPesewas: 800, verification: "verified", reference: "PSK_ref_1" }]
  });
  assertMomoFields([await db.transactions.get(direct.id), await db.transactions.get(cash.id)], "sale");
  assert.equal((await db.transactions.get(reserved.id)).momoMethod, "paystack");
});

test("momoMethod: credit sale, collection and Add debt store direct on MoMo rows only", async () => {
  const credit = await recordCreditSale({
    amountPesewas: 3000, name: "Ama Method", initialPaymentPesewas: 1000,
    initialPaymentParts: [{ paymentMethod: "momo", amountPesewas: 1000 }], paymentMethod: "momo"
  });
  assertMomoFields([await db.transactions.get(credit.transactionId), ...await db.payments.filter((row) => row.transactionId === credit.transactionId).toArray()], "credit sale");

  const collection = await recordDebtCollection({
    debtId: credit.debtId,
    parts: [{ paymentMethod: "cash", amountPesewas: 500 }, { paymentMethod: "momo", amountPesewas: 500 }]
  });
  assert.equal(collection.momoMethod, "direct");
  assertMomoFields([
    ...await db.payments.filter((row) => row.collectionId === collection.collectionId).toArray(),
    ...await db.transactions.filter((row) => row.collectionId === collection.collectionId).toArray()
  ], "collection");

  const manual = await recordManualDebt({
    name: "Kojo Method", ghanaCardNumber: "GHA-123456789-0", amountPesewas: 4000, initialPaymentPesewas: 1500,
    initialPaymentParts: [{ paymentMethod: "cash", amountPesewas: 500 }, { paymentMethod: "momo", amountPesewas: 1000 }], paymentMethod: "cash"
  });
  assertMomoFields([
    ...await db.payments.filter((row) => row.debtId === manual.debt.id).toArray(),
    ...await db.transactions.filter((row) => row.debtId === manual.debt.id && row.type === "income").toArray()
  ], "Add debt");
});
