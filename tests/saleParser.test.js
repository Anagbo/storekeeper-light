import assert from "node:assert/strict";
import test from "node:test";
import { parseSpokenExpense, parseSpokenSale } from "../src/lib/saleParser.js";

const expenseExamples = [
  ["paid 10 cedis for transport", "transport", "10"],
  ["I spent GHS 50 on electricity", "electricity", "50"],
  ["transport was 20 GHS", "transport was", "20"],
  ["20 GHS for lunch", "lunch", "20"],
  ["GHS 1,200.50 shop supplies", "shop supplies", "1200.50"],
  ["ten cedis for lunch", "lunch", "10"],
  ["paid twenty-five cedis for lunch", "lunch", "25"],
  ["spent one hundred and twenty cedis on stock", "stock", "120"],
  ["I paid for transport 10", "transport", "10"],
  ["transport cost 10", "transport", "10"],
  ["bought lunch for 20", "lunch", "20"],
  ["fuel twenty five", "fuel", "25"]
];

for (const [spoken, note, price] of expenseExamples) {
  test(`parses expense: ${spoken}`, () => {
    assert.deepEqual(parseSpokenExpense(spoken), {
      note,
      price,
      ambiguousAmount: false
    });
  });
}

test("uses the currency amount when the expense note also contains a quantity", () => {
  assert.deepEqual(parseSpokenExpense("spent 10 cedis on 2 bags of rice"), {
    note: "2 bags of rice",
    price: "10",
    ambiguousAmount: false
  });
});

test("flags a second amount even when only one has a currency", () => {
  assert.deepEqual(parseSpokenExpense("paid 10 cedis for transport and 15 for lunch"), {
    note: "paid 10 cedis for transport and 15 for lunch",
    price: "",
    ambiguousAmount: true
  });
});

test("does not treat item counts as ambiguous when no amount was spoken", () => {
  assert.deepEqual(parseSpokenExpense("bought two bottles and three bags"), {
    note: "two bottles and three bags",
    price: "",
    ambiguousAmount: false
  });
});

test("keeps the existing spoken credit-sale parsing behavior", () => {
  assert.deepEqual(parseSpokenSale("Afi bought 2 bags of cement for 180 GHS on credit"), {
    customerName: "Afi",
    itemDescription: "bags of cement",
    quantity: "2",
    price: "180",
    paymentType: "credit"
  });
});

const customerNameExamples = [
  ["Ama bought rice for 20 cedis", "Ama"],
  ["I sold 2 bags of rice to Ama for 40 cedis", "Ama"],
  ["customer Kofi bought rice for 20 cedis", "Kofi"],
  ["customer name is Ama Owusu, sold rice for 20 cedis", "Ama Owusu"],
  ["sale for Kofi: rice 20 cedis", "Kofi"],
  ["sold rice on credit to Ama for 20 cedis", "Ama"]
];

for (const [spoken, customerName] of customerNameExamples) {
  test(`extracts the customer from: ${spoken}`, () => {
    assert.equal(parseSpokenSale(spoken).customerName, customerName);
  });
}

const saleItemExamples = [
  ["Afi bought 2 bags of cement for 180 GHS on credit", "bags of cement"],
  ["I sold 2 bags of rice to Ama for 40 cedis", "bags of rice"],
  ["sold rice to Ama for GHS 40", "rice"],
  ["Ama bought rice for 20 cedis", "rice"],
  ["I bought a bottle of cooking oil for GHS 25", "bottle of cooking oil"],
  ["sold rice on credit to Ama for 20 cedis", "rice"],
  ["sale for Kofi: soft drinks 30 GHS", "soft drinks"],
  ["item description is cooking oil for 15 cedis", "cooking oil"]
];

for (const [spoken, itemDescription] of saleItemExamples) {
  test(`extracts the item from: ${spoken}`, () => {
    assert.equal(parseSpokenSale(spoken).itemDescription, itemDescription);
  });
}

test("normalizes comma-decimal and comma-grouped sale amounts", () => {
  assert.equal(parseSpokenSale("sold rice for 12,50 GHS").price, "12.50");
  assert.equal(parseSpokenSale("sold rice for GHS 1,200").price, "1200");
});
