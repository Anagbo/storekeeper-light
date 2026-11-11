import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSaleReceiptMessage, getSaleReceiptDetails } from "../src/pos/saleReceipt.js";
import { loadJsx, render, textOf } from "./helpers/renderJsx.js";

// The sale 30 was given in the owner's bug (copied from the record recordCreditSale wrote for
// GH₵8.00 owed in full on 16 by Juju, who already owed): nothing paid, so payment_method is null.
const JUJU_SALE = {
  id: "2b748889-44ed-410e-9344-f9d12be2297a",
  customerId: "64bd9ed1-dfee-49f1-8302-37a3cd7a1c39",
  debtId: "61537bac-fdf3-4f45-a5fa-5e150140954e",
  type: "installment_addon",
  amountPesewas: 800,
  total_amount: 800,
  payment_method: null,
  cashReceivedPesewas: 0,
  momoReceivedPesewas: 0,
  paymentType: "credit",
  customer_name: "Juju",
  customer_phone: "",
  ghanaCardNumber: "",
  customerName: "Juju",
  phone: "",
  items_json: JSON.stringify([{ name: "Sale", quantity: 1, total_amount: 800 }]),
  itemDescription: "Sale",
  quantity: 1,
  pricePesewas: 800,
  note: "Sale · Juju",
  addonAmountPesewas: 800,
  creditSaleGrossPesewas: 800,
  creditExtendedPesewas: 800,
  createdAt: Date.now(),
  timestamp: Date.now(),
  updatedAt: Date.now(),
  synced: false,
  syncStatus: "pending"
};

async function show(transaction) {
  const { default: SaleRecorded } = await loadJsx("src/pos/SaleRecorded.jsx");
  return textOf(render({ type: SaleRecorded, props: { transaction, shopName: "Shop", onDone() {}, onNewSale() {} } }).tree);
}

test("30 with the recorded sale from the bug: payment_method is null and the screen shows what is owed", async () => {
  assert.equal(JUJU_SALE.payment_method, null);
  assert.equal(getSaleReceiptDetails(JUJU_SALE).paymentMethod, "owe");
  const text = await show(JUJU_SALE);
  assert.match(text, /Sale recorded/);
  assert.match(text, /Juju still owesGH₵8\.00/);
  assert.doesNotMatch(text, /Cash|MoMo/, "no paid part is shown when nothing was paid");
});

test("30: a credit sale partly paid shows only the paid part and what is still owed", async () => {
  const text = await show({ ...JUJU_SALE, payment_method: "momo", momoReceivedPesewas: 300, creditExtendedPesewas: 500 });
  assert.match(text, /MoMoGH₵3\.00/);
  assert.match(text, /Juju still owesGH₵5\.00/);
  assert.doesNotMatch(text, /Cash/);
});

test("30: a plain cash sale and a Cash + MoMo split look as before", async () => {
  const cash = { id: "c1", amountPesewas: 800, payment_method: "cash", cashReceivedPesewas: 800, momoReceivedPesewas: 0, timestamp: Date.now(), items_json: "[]" };
  assert.match(await show(cash), /CashGH₵8\.00/);
  assert.doesNotMatch(await show(cash), /owe/i);
  const split = { ...cash, payment_method: "split", cashReceivedPesewas: 500, momoReceivedPesewas: 300 };
  assert.match(await show(split), /CashGH₵5\.00MoMoGH₵3\.00OwedGH₵0\.00/);
});

test("the owed method is only for a sale wholly on credit; other missing methods are still refused", () => {
  assert.throws(() => getSaleReceiptDetails({ ...JUJU_SALE, creditExtendedPesewas: 500 }), /payment method/);
  assert.throws(() => getSaleReceiptDetails({ ...JUJU_SALE, paymentType: undefined }), /payment method/);
  assert.throws(() => getSaleReceiptDetails({ ...JUJU_SALE, cashReceivedPesewas: 100 }), /payment method/);
});

test("the receipt text names the owed part and no payment for a sale wholly on credit", () => {
  const message = buildSaleReceiptMessage(JUJU_SALE, "Shop");
  assert.match(message, /Total: GH₵8\.00/);
  assert.match(message, /Owed: GH₵8\.00/);
  assert.doesNotMatch(message, /Payment:/);
  const partly = buildSaleReceiptMessage({ ...JUJU_SALE, payment_method: "cash", cashReceivedPesewas: 300, creditExtendedPesewas: 500 }, "Shop");
  assert.match(partly, /Payment: Cash\nOwed: GH₵5\.00/);
});