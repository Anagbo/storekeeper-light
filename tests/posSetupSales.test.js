import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { getPreference, setPreference, shouldShowPosSetup } from "../src/db/preferences.js";
import { recordCashSale } from "../src/db/sales.js";

const tables = [
  db.products,
  db.transactions,
  db.debts,
  db.customers,
  db.suppliers,
  db.settings
];

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

test("first-run setup is offered only for a new shop that has not completed setup", async () => {
  assert.equal(await shouldShowPosSetup(), true);
  await setPreference("posSetupCompleted", true);
  assert.equal(await shouldShowPosSetup(), false);

  await db.settings.clear();
  await db.products.add({ name: "Rice", active: true });
  assert.equal(await shouldShowPosSetup(), false);
  assert.equal(await getPreference("missing", "fallback"), "fallback");
});

test("cash and MoMo sale persistence records split tender and item detail atomically", async () => {
  const transaction = await recordCashSale({
    amountPesewas: 1500,
    cashReceivedPesewas: 1000,
    momoReceivedPesewas: 500,
    saleItems: [{
      productId: 1,
      name: "Rice",
      quantity: 3,
      unitPricePesewas: 500
    }],
    now: 123
  });

  assert.equal(transaction.payment_method, "split");
  assert.equal(transaction.cashReceivedPesewas, 1000);
  assert.equal(transaction.momoReceivedPesewas, 500);
  assert.deepEqual(JSON.parse(transaction.items_json), [{
    productId: 1,
    name: "Rice",
    quantity: 3,
    unitPricePesewas: 500,
    total_amount: 1500
  }]);
  assert.deepEqual(await db.transactions.toArray(), [transaction]);
});

test("invalid cash and MoMo totals or item totals do not write sale transactions", async () => {
  await assert.rejects(recordCashSale({
    amountPesewas: 1000,
    cashReceivedPesewas: 400,
    momoReceivedPesewas: 500
  }), /add up to the sale amount/);
  await assert.rejects(recordCashSale({
    amountPesewas: 1000,
    saleItems: [{
      productId: 1,
      name: "Rice",
      quantity: 1,
      unitPricePesewas: 500
    }]
  }), /Item totals must match/);
  assert.equal(await db.transactions.count(), 0);
});
