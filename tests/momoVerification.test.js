import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { db } from "../src/db/db.js";
import { recordCashSale } from "../src/db/sales.js";
import { recordCreditSale, recordDebtCollection } from "../src/db/debts.js";
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

test("C2: sale and collection receipts carry the MoMo label", () => {
  const sale = { amountPesewas: 2000, total_amount: 2000, payment_method: "momo", cashReceivedPesewas: 0, momoReceivedPesewas: 2000, momoVerification: "merchant_confirmed", items_json: "[]", timestamp: Date.now() };
  assert.match(buildSaleReceiptMessage(sale, "Shop"), /Payment: MoMo · you confirmed/);
  const split = { ...sale, payment_method: "split", cashReceivedPesewas: 500, momoReceivedPesewas: 1500 };
  assert.match(buildSaleReceiptMessage(split, "Shop"), /MoMo · you confirmed GH₵15\.00/);
  const collection = {
    customerName: "Kofi", createdAt: Date.now(), amountPesewas: 3000, remainingPesewas: 2000, momoVerification: "merchant_confirmed",
    parts: [{ paymentMethod: "cash", amountPesewas: 1000 }, { paymentMethod: "momo", amountPesewas: 2000 }]
  };
  assert.match(buildCollectionReceiptMessage(collection, "Shop"), /MoMo · you confirmed GH₵20\.00/);
});

test("C2: the receipt templates (VITE_ENABLE_POS_RECEIPTS on) carry the MoMo label too", () => {
  const sale = { amountPesewas: 2000, total_amount: 2000, payment_method: "split", paymentType: "split", cashReceivedPesewas: 500, momoReceivedPesewas: 1500, momoVerification: "merchant_confirmed", items_json: "[]", timestamp: Date.now() };
  assert.match(getSaleReceiptText(sale, "Shop", {}, true), /Paid: Cash GH₵5\.00, MoMo · you confirmed GH₵15\.00/);
  const collection = {
    customerName: "Kofi", createdAt: Date.now(), amountPesewas: 3000, remainingPesewas: 2000, momoVerification: "merchant_confirmed",
    parts: [{ paymentMethod: "cash", amountPesewas: 1000 }, { paymentMethod: "momo", amountPesewas: 2000 }]
  };
  assert.match(getCollectionReceiptText(collection, "Shop", true), /\(Cash GH₵10\.00, MoMo · you confirmed GH₵20\.00\)/);
  const credit = {
    amountPesewas: 3000, initialPaymentPesewas: 1000, totalDebtPesewas: 2000, debtAfter: null,
    initialPaymentParts: [{ paymentMethod: "momo", amountPesewas: 1000 }],
    saleTransaction: { timestamp: Date.now(), momoVerification: "merchant_confirmed" }
  };
  assert.match(buildCreditSaleReceipt(credit, "Shop"), /Paid today: GH₵10\.00 \(MoMo · you confirmed GH₵10\.00\)/);
  // Older records with no field keep the plain label.
  assert.match(getSaleReceiptText({ ...sale, momoVerification: undefined }, "Shop", {}, true), /MoMo GH₵15\.00/);
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