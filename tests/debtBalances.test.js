import assert from "node:assert/strict";
import { test } from "node:test";
import { getLargestUnpaidBalances } from "../src/utils/debtBalances.js";

test("aggregates unpaid balances by trimmed case-insensitive customer name and returns only the top three", () => {
  const balances = getLargestUnpaidBalances([
    { id: "1", customer_name: " Kofi Abanga ", amountPesewas: 1000, phone: "", ghanaCardNumber: "GHA-123456789-0" },
    { id: "2", customerName: "kofi abanga", amountPesewas: 2500, phone: "0241234567" },
    { id: "3", customer_name: "Ama Mensah", amountPesewas: 2000 },
    { id: "4", customerName: "Yaw Boateng", amountPesewas: 1500 },
    { id: "5", customerName: "Esi Owusu", amountPesewas: 1000 }
  ]);

  assert.deepEqual(balances, [
    { id: "kofi abanga", customerName: "Kofi Abanga", phone: "0241234567", ghanaCardNumber: "GHA-123456789-0", amountPesewas: 3500 },
    { id: "ama mensah", customerName: "Ama Mensah", phone: "", ghanaCardNumber: "", amountPesewas: 2000 },
    { id: "yaw boateng", customerName: "Yaw Boateng", phone: "", ghanaCardNumber: "", amountPesewas: 1500 }
  ]);
});

test("keeps unnamed debt records separate and supports legacy debt fields", () => {
  const balances = getLargestUnpaidBalances([
    { id: "legacy-1", total_owed: 200 },
    { id: "legacy-2", total_owed: 300 }
  ]);

  assert.deepEqual(balances, [
    { id: "unnamed:legacy-2", customerName: "Unnamed customer", phone: "", ghanaCardNumber: "", amountPesewas: 300 },
    { id: "unnamed:legacy-1", customerName: "Unnamed customer", phone: "", ghanaCardNumber: "", amountPesewas: 200 }
  ]);
});
